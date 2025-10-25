// app.js (ESM) — requires an import map in index.html for "three" & "three/addons/"
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";
import {
  loadPointCloudFromFile,
  loadTrajectoryFromFile,
  loadDemoDataset
} from "./src/dataLoader.js";
import { makeCharts } from "./src/charts.js";
import { makeSplineSystem } from "./src/splineCore.js";
import { createExporter } from "./src/exporter.js";

// ---------- CONFIG ----------
const CFG = window.CONFIG || {};
const DEMO_PCD = CFG.demoPCD;
const DEMO_TRAJECTORY = CFG.demoTrajectory;
const HISTORY_COUNT = Math.max(1, (CFG.N_PAST | 0) || 1);
let basePtSize = +CFG.pointSize > 0 ? +CFG.pointSize : 0.08; // meters
let maxPoints  = +CFG.maxPoints > 0 ? +CFG.maxPoints : 500000;

// ---------- DOM ----------
const container   = document.getElementById("stage3d");
const statusEl    = document.getElementById("status");
const statusExtra = document.getElementById("statusExtra");
const fileInput   = document.getElementById("fileInput");
const demoBtn     = document.getElementById("demoBtn");
const colorModeSel= document.getElementById("colorMode");
const ptSizeInput = document.getElementById("ptSize");
const ptSizeVal   = document.getElementById("ptSizeVal");
const viewTopBtn  = document.getElementById("viewTopBtn");
const viewIsoBtn  = document.getElementById("viewIsoBtn");
const modeBadge   = document.getElementById("modeBadge");

const legendCanvas= document.getElementById("legendCanvas");
const legendTitle = document.getElementById("legendTitle");
const legendMin   = document.getElementById("legendMin");
const legendMax   = document.getElementById("legendMax");

// Spline-side UI
const curveSel    = document.getElementById("curveType");
const alphaWrap   = document.getElementById("alphaWrap");
const alphaInput  = document.getElementById("alpha");
const alphaVal    = document.getElementById("alphaVal");
const samplesBtn  = document.getElementById("samplesBtn");
const optimizeBtn = document.getElementById("optimizeBtn");
const weightsBtn  = document.getElementById("weightsBtn");
const exportBtn   = document.getElementById("exportSamplesBtn");
const manouverDlg = document.getElementById("manouverDlg");
const manouverForm = document.getElementById("manouverForm");
const manouverCloseBtn = document.getElementById("manouverClose");
const manouverOptionsEl = document.getElementById("manouverOptions");
const manouverConfirmBtn = document.getElementById("manouverConfirm");
const helpBtn     = document.getElementById("helpBtn");
const helpDlg     = document.getElementById("helpDlg");
const helpCloseBtn   = document.getElementById("helpCloseBtn");
const weightsPanel = document.getElementById("weightsPanel");
const weightJerkInput = document.getElementById("weightJerk");
const weightVelInput  = document.getElementById("weightVel");
const weightAccInput  = document.getElementById("weightAcc");
const weightJerkNumber = document.getElementById("weightJerkNumber");
const weightVelNumber  = document.getElementById("weightVelNumber");
const weightAccNumber  = document.getElementById("weightAccNumber");
const scenarioInfoBox = document.getElementById("scenarioInfo");
const exportWarnDlg = document.getElementById("exportWarnDlg");
const exportWarnForm = document.getElementById("exportWarnForm");
const exportWarnOptimizeBtn = document.getElementById("exportWarnOptimize");
const exportWarnSkipBtn = document.getElementById("exportWarnSkip");
const exportWarnCloseBtn = document.getElementById("exportWarnClose");

function finiteOr(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

const optimizerDefaults = CFG.optimizer || {};
const weightState = {
  wJerk: finiteOr(optimizerDefaults.wJerk, 1.0),
  wVel: finiteOr(optimizerDefaults.wVel, 0.10),
  wAcc: finiteOr(optimizerDefaults.wAcc, 0.10)
};
let weightsVisible = false;

const manouverTypes = CFG.manouverTypes || {};

const SCENARIO_METADATA_PATH = "e2e_scenarios.csv";
let scenarioMetadataById = null;
let scenarioMetadataPromise = null;
let currentScenarioMetadata = null;

function normalizeScenarioPath(path) {
  if (typeof path !== "string") return "";
  return path.replace(/\\/g, "/");
}

function extractScenarioNameFromPath(path) {
  const normalized = normalizeScenarioPath(path);
  if (!normalized) return null;
  const match = normalized.match(/(e2e_[^/]+|3d_perception_recording_adenauer_[^/]+)/i);
  if (!match) return null;
  let scenario = match[1];
  scenario = scenario.replace(/^trajectory_/i, "");
  scenario = scenario.replace(/\.npy$/i, "");
  scenario = scenario.replace(/\.bin$/i, "");
  return scenario;
}

function recomputeScenarioName() {
  currentScenarioName = trajectoryScenarioName || pointCloudScenarioName || null;
  updateScenarioMetadata(currentScenarioName);
}

function sanitizeFileStem(name, fallback = "export") {
  if (!name || typeof name !== "string") return fallback;
  const cleaned = name.replace(/[^\w.-]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || fallback;
}

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatWeight(val) {
  return Number.isFinite(val) ? val.toFixed(2) : "0.00";
}

const weightControls = {
  wJerk: { slider: weightJerkInput, number: weightJerkNumber },
  wVel:  { slider: weightVelInput,  number: weightVelNumber },
  wAcc:  { slider: weightAccInput,  number: weightAccNumber }
};

async function ensureScenarioMetadata() {
  if (scenarioMetadataById) return scenarioMetadataById;
  if (!scenarioMetadataPromise) {
    scenarioMetadataPromise = d3
      .csv(SCENARIO_METADATA_PATH)
      .then((rows) => {
        const map = {};
        if (rows && Array.isArray(rows)) {
          for (const row of rows) {
            const id = row?.ID ?? row?.id;
            if (!id) continue;
            let note = row?.["special note"] ?? row?.specialNote ?? null;
            if (!note || /^nan$/i.test(String(note))) note = null;
            map[id] = {
              id,
              instruction: row?.["high-level instruction"] ?? row?.instruction ?? "",
              specialNote: note
            };
          }
        }
        scenarioMetadataById = map;
        return scenarioMetadataById;
      })
      .catch((err) => {
        console.error("Unable to load scenario metadata:", err);
        scenarioMetadataById = {};
        return scenarioMetadataById;
      });
  }
  return scenarioMetadataPromise;
}

function updateScenarioMetadata(name) {
  if (!name) {
    currentScenarioMetadata = null;
    renderScenarioInfo();
    return;
  }
  void ensureScenarioMetadata().then((metadata) => {
    currentScenarioMetadata = metadata ? metadata[name] || null : null;
    renderScenarioInfo();
  });
}

function renderScenarioInfo() {
  if (!scenarioInfoBox) return;
  const name = currentScenarioName;
  const metadata = currentScenarioMetadata;
  if (!name || !metadata) {
    scenarioInfoBox.style.display = "none";
    scenarioInfoBox.textContent = "";
    return;
  }

  const instruction = metadata.instruction ? escapeHtml(metadata.instruction) : "";
  const note = metadata.specialNote ? escapeHtml(metadata.specialNote) : "";

  if (!instruction && !note) {
    scenarioInfoBox.style.display = "none";
    scenarioInfoBox.textContent = "";
    return;
  }

  const lines = [];
  if (instruction) {
    lines.push(
      `<span class="scenario-info-line"><span class="scenario-info-label">Instruction:</span><span class="scenario-info-text">${instruction}</span></span>`
    );
  }
  if (note) {
    lines.push(
      `<span class="scenario-info-line"><span class="scenario-info-label">Note:</span><span class="scenario-info-text">${note}</span></span>`
    );
  }
  scenarioInfoBox.innerHTML = lines.join("");
  scenarioInfoBox.style.display = "inline-block";
}

function clampToInput(value, inputEl) {
  if (!inputEl) return value;
  let next = value;
  const min = Number.parseFloat(inputEl.min);
  const max = Number.parseFloat(inputEl.max);
  if (Number.isFinite(min)) next = Math.max(min, next);
  if (Number.isFinite(max)) next = Math.min(max, next);
  const step = Number.parseFloat(inputEl.step);
  if (Number.isFinite(step) && step > 0) {
    next = Math.round(next / step) * step;
    next = Number(next.toFixed(6));
  }
  return next;
}

function applyWeightValue(kind, rawValue, sourceEl, { updateSpline = true } = {}) {
  const ctrls = weightControls[kind];
  if (!ctrls) return;
  let val = Number(rawValue);
  if (!Number.isFinite(val)) return;
  val = clampToInput(val, ctrls.slider);
  val = clampToInput(val, ctrls.number);
  weightState[kind] = val;
  if (ctrls.slider && sourceEl !== ctrls.slider) {
    ctrls.slider.value = String(val);
  }
  if (ctrls.number && sourceEl !== ctrls.number) {
    ctrls.number.value = formatWeight(val);
  }
  if (updateSpline) applyWeightsToSpline();
}

function syncWeightControls() {
  for (const kind of Object.keys(weightControls)) {
    const val = weightState[kind];
    if (Number.isFinite(val)) {
      applyWeightValue(kind, val, null, { updateSpline: false });
    }
  }
}

function applyWeightsToSpline() {
  if (spline?.setOptimizerWeights) {
    spline.setOptimizerWeights({ ...weightState });
  }
}

function setWeightsVisible(v) {
  weightsVisible = !!v;
  if (weightsPanel) {
    weightsPanel.classList.toggle("open", weightsVisible);
    weightsPanel.setAttribute("aria-hidden", weightsVisible ? "false" : "true");
  }
  if (weightsBtn) {
    weightsBtn.setAttribute("aria-pressed", weightsVisible ? "true" : "false");
  }
  if (weightsVisible) {
    syncWeightControls();
  }
}

function toggleWeightsPanel() {
  setWeightsVisible(!weightsVisible);
  if (weightsVisible) {
    applyWeightsToSpline();
  }
}

syncWeightControls();
setWeightsVisible(false);

function hookWeightControl(kind) {
  const ctrls = weightControls[kind];
  if (!ctrls) return;
  const { slider, number } = ctrls;
  if (slider) {
    slider.addEventListener("input", () => {
      applyWeightValue(kind, slider.value, slider);
    });
    slider.addEventListener("change", () => {
      applyWeightValue(kind, slider.value, slider);
    });
  }
  if (number) {
    number.addEventListener("input", () => {
      const raw = number.value;
      if (!raw || raw.trim() === "" || raw === "-" || raw === "." || raw === "-.") return;
      applyWeightValue(kind, raw, number, { updateSpline: false });
    });
    const commit = () => {
      const raw = number.value;
      const trimmed = raw?.trim() ?? "";
      const value = trimmed !== "" ? raw : weightState[kind];
      applyWeightValue(kind, value, number);
    };
    number.addEventListener("change", commit);
    number.addEventListener("blur", commit);
    number.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        commit();
        number.blur();
      }
    });
  }
}

["wJerk", "wVel", "wAcc"].forEach(hookWeightControl);
weightsBtn?.addEventListener("click", toggleWeightsPanel);

// ---------- THREE setup ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.domElement.classList.add("threejs");
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d13);

// Grid & axes (X/Y plane, Z up)
const grid = new THREE.GridHelper(100, 20, 0x334, 0x223);
grid.renderOrder = -100;
grid.rotation.x = Math.PI / 2;
scene.add(grid);
const axes = new THREE.AxesHelper(5);
scene.add(axes);

// ---------- Cameras & controls glue (pcd_viewer-style 2D) ----------
let is2D = false;
let camera = null;
let controls = null;
const DEFAULT_ORTHO_ZOOM = 15;

const perspCam = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 5000);
perspCam.position.set(30, 30, 30);

function makeOrthoCamera() {
  const w = container.clientWidth, h = container.clientHeight;
  const aspect = Math.max(1e-6, w / h);
  const worldHalfH = (radius || 10) * 1.2;
  const worldHalfW = worldHalfH * aspect;
  const c = center || new THREE.Vector3(0,0,0);

  const cam = new THREE.OrthographicCamera(-worldHalfW, worldHalfW, worldHalfH, -worldHalfH, 0.1, 5000);
  cam.position.set(c.x, c.y, c.z + 200); // top-down
  cam.up.set(0, 1, 0);
  cam.lookAt(c.x, c.y, c.z);
  cam.zoom = DEFAULT_ORTHO_ZOOM;
  cam.updateProjectionMatrix();
  return cam;
}

function makeControls(cam) {
  const c = new OrbitControls(cam, renderer.domElement);
  c.minDistance = 1;
  c.maxDistance = 2000;
  return c;
}

// Keep last camera states to restore when toggling
const lastState3D = {
  pos: new THREE.Vector3(30,30,30),
  target: new THREE.Vector3(0,0,0),
  up: new THREE.Vector3(0,0,1)
};
const lastState2D = {
  pos: new THREE.Vector3(0,0,200),
  target: new THREE.Vector3(0,0,0),
  zoom: DEFAULT_ORTHO_ZOOM
};

function snapshot3D() {
  lastState3D.pos.copy(perspCam.position);
  lastState3D.target.copy(controls.target);
  lastState3D.up.copy(perspCam.up);
}
function snapshot2D() {
  if (!(camera && camera.isOrthographicCamera)) return;
  lastState2D.pos.copy(camera.position);
  lastState2D.target.copy(controls.target);
  lastState2D.zoom = camera.zoom;
}

function syncPointSize() {
  if (!cloudMat) return;
  cloudMat.size = is2D ? (basePtSize * camera.zoom) : basePtSize;
}

function setBadge(label) {
  if (!modeBadge) return;
  modeBadge.textContent = label;
  modeBadge.classList.toggle("two", label === "2D");
  modeBadge.classList.toggle("three", label === "3D");
}

// Initialize 3D camera + controls
camera = perspCam;
controls = makeControls(camera);
controls.addEventListener("change", () => { snapshot3D(); renderOnce(); });

// KITTI-friendly ISO (rear-right-up, Z-up)
function setIsoView3D() {
  perspCam.up.set(0,0,1); // Z up
  perspCam.position.set(-20, -20, 15);
  controls.target.set(0, 0, 0);
  perspCam.lookAt(controls.target);
  controls.update();
  snapshot3D();
}

function setTopView3D() {
  perspCam.up.set(0,1,0); // Y up
  perspCam.position.set(0, 0, 32);
  controls.target.set(0, 0, 0);
  perspCam.lookAt(controls.target);
  perspCam.up.set(0,0.001,0.999); // Z up, dirty hack
  controls.update();
  snapshot3D();
}

// Enter 2D mode using OrbitControls (no rotate, right=pan, middle=zoom)
function enter2D(state = lastState2D) {
  controls?.dispose();

  camera = makeOrthoCamera();
  controls = makeControls(camera);

  controls.enableRotate = false;
  controls.enableDamping = false;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.NONE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN
  };

  if (state) {
    camera.position.copy(state.pos);
    controls.target.copy(state.target);
    camera.zoom = Math.max(1e-6, state.zoom);
    camera.updateProjectionMatrix();
    camera.lookAt(controls.target);
  } else {
    updateCenterAndRadius();
    camera.position.set(center.x, center.y, center.z + Math.max(1, radius*2.0));
    controls.target.copy(center);
    camera.lookAt(center);
    camera.zoom = DEFAULT_ORTHO_ZOOM;
    camera.updateProjectionMatrix();
  }
  controls.update();

  controls.addEventListener("change", () => { snapshot2D(); syncPointSize(); renderOnce(); });

  is2D = true;
  setBadge("2D");
  syncPointSize();

  // spline appears as 2D line in 2D mode
  spline?.rebuildCurveObject(true);
  rebuildTrajectoryObject(true);
  renderOnce();
}

// Back to 3D
function enter3D(state = lastState3D) {
  controls?.dispose();

  camera = perspCam;
  controls = makeControls(camera);

  controls.enableRotate = true;
  controls.enableDamping = false;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN
  };

  if (state) {
    perspCam.position.copy(state.pos);
    perspCam.up.copy(state.up);
    controls.target.copy(state.target);
    perspCam.lookAt(controls.target);
  } else {
    setIsoView3D();
  }
  controls.update();
  controls.addEventListener("change", () => { snapshot3D(); renderOnce(); });

  is2D = false;
  setBadge("3D");
  syncPointSize();

  // spline appears as tube in 3D mode
  spline?.rebuildCurveObject(false);
  rebuildTrajectoryObject(false);
  renderOnce();
}

// Spacebar toggles modes
function toggle2D3D() { if (is2D) enter3D(); else enter2D(); }

// ---------- State for PCD ----------
let cloud = null;
let cloudMat = null;
let raw = null;
let bounds = null;
let center = new THREE.Vector3();
let radius = 10;
let currentPCDName = ""; // used for export filename
let currentPCDPath = null;
let currentTrajectoryName = "";
let currentTrajectoryPath = null;
let currentScenarioName = null;
let pointCloudScenarioName = null;
let trajectoryScenarioName = null;

let trajectoryPoints = null;
let trajectoryLine = null;
let cloudBoundsCache = null;
const trajectorySpheres = [];
let trajectorySphereGeom = null;
let trajectorySphereRadius = 0;
let trajectorySphereMat = null;
let trajectoryPastPoints = null;
let trajectoryFuturePoints = null;
let trajectoryFutureLine = null;
const trajectoryFutureSpheres = [];
let trajectoryFutureSphereGeom = null;
let trajectoryFutureSphereRadius = 0;
let trajectoryFutureSphereMat = null;
let trajectoryHistoryRaw = [];
let trajectoryRawPoints = [];

function status(msg){ if (statusEl) statusEl.textContent = msg; }
function statusOptim(msg){ if (statusExtra) statusExtra.textContent = msg || ""; }
function formatK(n){ return n >= 1000 ? Math.round(n/1000) + "k" : String(n); }
function updateStatus() {
  const cloudLabel = currentPCDName ? currentPCDName : "no point cloud";
  const trajLabel = currentTrajectoryName ? currentTrajectoryName : "no trajectory";
  status(`Loaded ${cloudLabel}, ${trajLabel}`);
}

function cssVar(name) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name);
  return v ? v.trim() : "";
}
function cssNumber(name, fallback) {
  const raw = cssVar(name);
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}
function cssColor(name, fallback = "#ffffff") {
  const raw = cssVar(name) || fallback;
  try {
    return new THREE.Color(raw);
  } catch {
    return new THREE.Color(fallback);
  }
}

// ---------- Color ramps ----------
const turboStops = [
  {t:0.0, c:new THREE.Color(0x30123b)},
  {t:0.2, c:new THREE.Color(0x4145ab)},
  {t:0.4, c:new THREE.Color(0x2ab7ff)},
  {t:0.6, c:new THREE.Color(0x50e991)},
  {t:0.8, c:new THREE.Color(0xf5d643)},
  {t:1.0, c:new THREE.Color(0xf1731d)},
];
const viridisStops = [
  {t:0.0, c:new THREE.Color(0x440154)},
  {t:0.25,c:new THREE.Color(0x3b528b)},
  {t:0.5, c:new THREE.Color(0x21918c)},
  {t:0.75,c:new THREE.Color(0x5ec962)},
  {t:1.0, c:new THREE.Color(0xfde725)},
];
function rampColor(stops, t){
  t = Math.min(1, Math.max(0, t));
  for (let i=0; i<stops.length-1; i++){
    const a = stops[i], b = stops[i+1];
    if (t >= a.t && t <= b.t){
      const lt = (t - a.t) / (b.t - a.t);
      return a.c.clone().lerp(b.c, lt);
    }
  }
  return stops[stops.length-1].c.clone();
}

// ---------- Build THREE geometry from raw ----------
function computeBounds(arr, idx) {
  const hasI = idx.i >= 0;
  const dim = hasI ? 4 : 3;
  let xmin= Infinity, xmax=-Infinity, ymin=Infinity, ymax=-Infinity, zmin=Infinity, zmax=-Infinity;
  for (let k=0; k < arr.length; k += dim) {
    const x = arr[k+0], y = arr[k+1], z = arr[k+2];
    if (x < xmin) xmin = x; if (x > xmax) xmax = x;
    if (y < ymin) ymin = y; if (y > ymax) ymax = y;
    if (z < zmin) zmin = z; if (z > zmax) zmax = z;
  }
  return { xmin,xmax,ymin,ymax,zmin,zmax };
}
function updateCenterAndRadius() {
  if (!bounds) return;
  center.set(
    (bounds.xmin + bounds.xmax)/2,
    (bounds.ymin + bounds.ymax)/2,
    (bounds.zmin + bounds.zmax)/2
  );
  const dx = (bounds.xmax - bounds.xmin);
  const dy = (bounds.ymax - bounds.ymin);
  const dz = (bounds.zmax - bounds.zmin);
  radius = Math.max(dx, dy, dz) * 0.5 || 10;
}

let colorMode = (CFG.colorMode || "height");
function buildCloud() {
  if (cloud) { scene.remove(cloud); cloud.geometry.dispose(); cloud.material.dispose(); cloud = cloudMat = null; }
  if (!raw) return;

  const hasI = raw.xyzIdx.i >= 0;
  const dim = hasI ? 4 : 3;
  const total = Math.min(Math.floor(raw.points.length / dim), maxPoints|0);

  const pos = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);

  const zmin = bounds.zmin, zmax = bounds.zmax, zspan = Math.max(1e-6, zmax - zmin);
  let imin=Infinity, imax=-Infinity;
  if (hasI) {
    for (let k=3, used=0; k<raw.points.length && used<total; k+=dim, used++){
      const v = raw.points[k]; if (v<imin) imin=v; if (v>imax) imax=v;
    }
    if (imax <= 1.0) { imin = 0; }
    else if (imax <= 255) { imin = 0; imax=255; }
  }

  for (let p=0, k=0; p<total; p++, k+=dim) {
    const x = raw.points[k+0], y = raw.points[k+1], z = raw.points[k+2];
    pos[p*3+0] = x; pos[p*3+1] = y; pos[p*3+2] = z;

    let c;
    if (colorMode === "height") {
      // Map z ∈ [-1, 5] to turbo t ∈ [0.40, 1.00]
      //  - z = -1  → t = 0.40 (light blue: ~0x2ab7ff in our stops)
      //  - z = 5   → t = 1.00 (red)
      //  - clamp outside that range
      const zMinFixed = -3, zMaxFixed = 3;
      const u = Math.min(1, Math.max(0, (z - zMinFixed) / (zMaxFixed - zMinFixed)));
      const t = 0.50 + 0.50 * u;
      c = rampColor(turboStops, t);
    } else if (colorMode === "intensity" && hasI) {
      const v = raw.points[k+3];
      let t;
      if (imax <= 1.0) t = v;
      else if (imax <= 255) t = v/255;
      else t = (v - imin) / Math.max(1e-6, (imax - imin));
      c = rampColor(viridisStops, t);
    } else if (colorMode === "distance") {
      const r = Math.sqrt(x*x + y*y + z*z);
      const t = Math.min(1, r / (radius || 1));
      c = rampColor(viridisStops, t);
    } else {
      c = new THREE.Color(0x9fb3ff);
    }
    col[p*3+0] = c.r; col[p*3+1] = c.g; col[p*3+2] = c.b;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color",    new THREE.BufferAttribute(col, 3));
  geo.computeBoundingSphere();

  cloudMat = new THREE.PointsMaterial({
    size: basePtSize,            // meters
    sizeAttenuation: true,       // perspective attenuation in 3D
    vertexColors: true
  });

  cloud = new THREE.Points(geo, cloudMat);
  scene.add(cloud);
  syncPointSize();
  renderOnce();
}

function computeTrajectoryBounds(points) {
  if (!points || points.length === 0) return null;
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const p of points) {
    if (p.x < xmin) xmin = p.x;
    if (p.x > xmax) xmax = p.x;
    if (p.y < ymin) ymin = p.y;
    if (p.y > ymax) ymax = p.y;
  }
  return { xmin, xmax, ymin, ymax, zmin: 0, zmax: 0 };
}

function mergeBounds(a, b) {
  if (!a) return b;
  if (!b) return a;
  return {
    xmin: Math.min(a.xmin, b.xmin),
    xmax: Math.max(a.xmax, b.xmax),
    ymin: Math.min(a.ymin, b.ymin),
    ymax: Math.max(a.ymax, b.ymax),
    zmin: Math.min(a.zmin, b.zmin),
    zmax: Math.max(a.zmax, b.zmax)
  };
}

function disposeTrajectoryLine() {
  if (trajectoryLine) {
    scene.remove(trajectoryLine);
    trajectoryLine.geometry.dispose();
    trajectoryLine.material.dispose();
    trajectoryLine = null;
  }
  if (trajectoryFutureLine) {
    scene.remove(trajectoryFutureLine);
    trajectoryFutureLine.geometry.dispose();
    trajectoryFutureLine.material.dispose();
    trajectoryFutureLine = null;
  }
}

function clearTrajectorySpheres() {
  while (trajectorySpheres.length) {
    const mesh = trajectorySpheres.pop();
    scene.remove(mesh);
  }
  while (trajectoryFutureSpheres.length) {
    const mesh = trajectoryFutureSpheres.pop();
    scene.remove(mesh);
  }
}

function ensureTrajectorySphereResources(radius, color) {
  const r = Math.max(1e-3, radius);
  if (!trajectorySphereGeom || Math.abs(trajectorySphereRadius - r) > 1e-6) {
    trajectorySphereGeom?.dispose();
    trajectorySphereGeom = new THREE.SphereGeometry(r, 20, 16);
    trajectorySphereRadius = r;
    trajectorySpheres.forEach(mesh => { mesh.geometry = trajectorySphereGeom; });
  }

  if (!trajectorySphereMat) {
    trajectorySphereMat = new THREE.MeshBasicMaterial({ color: color.clone(), depthTest: false, depthWrite: false });
  } else {
    trajectorySphereMat.color.copy(color);
  }
}

function ensureFutureTrajectorySphereResources(radius, color) {
  const r = Math.max(1e-3, radius);
  if (!trajectoryFutureSphereGeom || Math.abs(trajectoryFutureSphereRadius - r) > 1e-6) {
    trajectoryFutureSphereGeom?.dispose();
    trajectoryFutureSphereGeom = new THREE.SphereGeometry(r, 20, 16);
    trajectoryFutureSphereRadius = r;
    trajectoryFutureSpheres.forEach(mesh => { mesh.geometry = trajectoryFutureSphereGeom; });
  }

  if (!trajectoryFutureSphereMat) {
    trajectoryFutureSphereMat = new THREE.MeshBasicMaterial({ color: color.clone(), depthTest: false, depthWrite: false, transparent: false, opacity: 1 });
  } else {
    trajectoryFutureSphereMat.color.copy(color);
    trajectoryFutureSphereMat.depthTest = false;
    trajectoryFutureSphereMat.depthWrite = false;
    trajectoryFutureSphereMat.transparent = false;
    trajectoryFutureSphereMat.opacity = 1;
  }
}

function rebuildTrajectoryObject(force2D = is2D) {
  disposeTrajectoryLine();

  const pointRadius = Math.max(1e-3, cssNumber("--trajectory-point-size", 0.2));
  const tubeRadius = Math.max(1e-3, cssNumber("--trajectory-tube-radius", pointRadius * 0.6));
  const zOffset = 0;

  const hasPast = Array.isArray(trajectoryPastPoints) && trajectoryPastPoints.length > 0;
  const hasFuture = Array.isArray(trajectoryFuturePoints) && trajectoryFuturePoints.length > 0;

  if (!hasPast) {
    while (trajectorySpheres.length) {
      const mesh = trajectorySpheres.pop();
      scene.remove(mesh);
    }
  }
  if (!hasFuture) {
    while (trajectoryFutureSpheres.length) {
      const mesh = trajectoryFutureSpheres.pop();
      scene.remove(mesh);
    }
  }

  if (!hasPast && !hasFuture) {
    return;
  }

  if (hasPast) {
    const trajColor = cssColor("--trajectory-color", "#ff4d8d");
    ensureTrajectorySphereResources(pointRadius, trajColor);

    while (trajectorySpheres.length < trajectoryPastPoints.length) {
      const mesh = new THREE.Mesh(trajectorySphereGeom, trajectorySphereMat);
      mesh.renderOrder = force2D ? 2402 : 8;
      scene.add(mesh);
      trajectorySpheres.push(mesh);
    }
    while (trajectorySpheres.length > trajectoryPastPoints.length) {
      const mesh = trajectorySpheres.pop();
      scene.remove(mesh);
    }

    for (let i = 0; i < trajectoryPastPoints.length; i++) {
      const mesh = trajectorySpheres[i];
      const p = trajectoryPastPoints[i];
      mesh.position.set(p.x, p.y, zOffset);
      mesh.visible = true;
      mesh.geometry = trajectorySphereGeom;
      mesh.material = trajectorySphereMat;
      mesh.renderOrder = force2D ? 2402 : 8;
    }

    if (trajectoryPastPoints.length >= 2) {
      const pathPoints = trajectoryPastPoints.map(p => new THREE.Vector3(p.x, p.y, 0));
      const curve = new THREE.CatmullRomCurve3(pathPoints, false, "catmullrom", 0.1);
      const tubularSegments = Math.max(32, trajectoryPastPoints.length * 8);
      const radialSegments = 16;
      const tubeGeometry = new THREE.TubeGeometry(curve, tubularSegments, tubeRadius, radialSegments, false);
      const material = new THREE.MeshBasicMaterial({ color: trajColor.clone(), transparent: true, opacity: 0.96 });
      material.depthTest = false;
      material.depthWrite = false;
      trajectoryLine = new THREE.Mesh(tubeGeometry, material);
      trajectoryLine.renderOrder = force2D ? 2400 : 6;
      scene.add(trajectoryLine);
    }
  }
  if (hasFuture) {
    const gtColor = cssColor("--trajectory-groundtruth-color", "#4dff88");
    ensureFutureTrajectorySphereResources(pointRadius, gtColor);

    while (trajectoryFutureSpheres.length < trajectoryFuturePoints.length) {
      const mesh = new THREE.Mesh(trajectoryFutureSphereGeom, trajectoryFutureSphereMat);
      mesh.renderOrder = force2D ? -50 : -50;
      scene.add(mesh);
      trajectoryFutureSpheres.push(mesh);
    }
    while (trajectoryFutureSpheres.length > trajectoryFuturePoints.length) {
      const mesh = trajectoryFutureSpheres.pop();
      scene.remove(mesh);
    }

    for (let i = 0; i < trajectoryFuturePoints.length; i++) {
      const mesh = trajectoryFutureSpheres[i];
      const p = trajectoryFuturePoints[i];
      mesh.position.set(p.x, p.y, zOffset);
      mesh.visible = true;
      mesh.geometry = trajectoryFutureSphereGeom;
      mesh.material = trajectoryFutureSphereMat;
      mesh.renderOrder = force2D ? -50 : -50;
    }

    if (trajectoryFuturePoints.length >= 2) {
      const pathPoints = trajectoryFuturePoints.map(p => new THREE.Vector3(p.x, p.y, 0));
      const curve = new THREE.CatmullRomCurve3(pathPoints, false, "catmullrom", 0.1);
      const tubularSegments = Math.max(32, trajectoryFuturePoints.length * 8);
      const radialSegments = 16;
      const tubeGeometry = new THREE.TubeGeometry(curve, tubularSegments, tubeRadius, radialSegments, false);
      const material = new THREE.MeshBasicMaterial({ color: gtColor.clone(), transparent: false, opacity: 1 });
      material.depthTest = false;
      material.depthWrite = false;
      trajectoryFutureLine = new THREE.Mesh(tubeGeometry, material);
      trajectoryFutureLine.renderOrder = force2D ? -60 : -60;
      scene.add(trajectoryFutureLine);
    }
  }
}

function applyPointCloud(rawData, name, path) {
  trajectoryHistoryRaw = [];
  initializeSpline();
  spline?.setTrajectoryHistory?.(trajectoryHistoryRaw);
  raw = rawData;
  cloudBoundsCache = computeBounds(raw.points, raw.xyzIdx);
  const cloudBounds = cloudBoundsCache;
  const trajBounds = trajectoryPoints ? computeTrajectoryBounds(trajectoryPoints) : null;
  bounds = mergeBounds(cloudBounds, trajBounds);

  updateCenterAndRadius();
  updateLegend();
  buildCloud();

  if (is2D) {
    enter2D();
  } else {
    setIsoView3D();
  }

  viewTopBtn.disabled = false;
  viewIsoBtn.disabled = false;

  spline?.onCloudLoaded?.(center, radius);
  rebuildTrajectoryObject(is2D);

  renderOnce();

  currentPCDName = name;
  currentPCDPath = path || null;
  pointCloudScenarioName = null;
  recomputeScenarioName();
  updateStatus();
  spline?.markSamplesOptimized?.(false);
}

function applyTrajectoryPoints(pointPairs, sourceName, sourcePath) {
  if (!Array.isArray(pointPairs) || pointPairs.length === 0) return;

  let closestIdx = -1;
  let minDistSq = Infinity;
  for (let i = 0; i < pointPairs.length; i++) {
    const [x, y] = pointPairs[i];
    const distSq = x * x + y * y;
    if (!Number.isFinite(distSq)) continue;
    if (distSq < minDistSq) {
      minDistSq = distSq;
      closestIdx = i;
    }
  }

  if (closestIdx < 0) {
    closestIdx = pointPairs.length - 1;
  }

  const pastPairs = pointPairs.slice(0, Math.max(0, closestIdx) + 1);
  const futurePairs = pointPairs.slice(Math.max(0, closestIdx) + 1);

  trajectoryPastPoints = pastPairs.map(([x, y]) => new THREE.Vector3(x, y, 0));
  trajectoryFuturePoints = futurePairs.map(([x, y]) => new THREE.Vector3(x, y, 0));
  trajectoryPoints = [...trajectoryPastPoints, ...trajectoryFuturePoints];

  trajectoryRawPoints = pointPairs.map(([x, y]) => [x, y]);

  const historySource = pastPairs.length ? pastPairs : pointPairs;
  const usableCount = Math.min(HISTORY_COUNT, historySource.length);
  const histStart = Math.max(0, historySource.length - usableCount);
  trajectoryHistoryRaw = historySource.slice(histStart).map(([x, y]) => [x, y]);

  initializeSpline();
  spline?.setTrajectoryHistory?.(trajectoryHistoryRaw);

  const trajBounds = computeTrajectoryBounds(trajectoryPoints);
  const cloudBounds = cloudBoundsCache;
  bounds = mergeBounds(cloudBounds, trajBounds);
  updateCenterAndRadius();

  viewTopBtn.disabled = false;
  viewIsoBtn.disabled = false;

  if (is2D) {
    controls.target.copy(center);
    camera.position.set(center.x, center.y, camera.position.z);
    controls.update();
    syncPointSize();
    rebuildTrajectoryObject(true);
  } else {
    setIsoView3D();
    rebuildTrajectoryObject(false);
  }

  renderOnce();
  currentTrajectoryName = sourceName || "trajectory";
  currentTrajectoryPath = sourcePath || null;
  const scenarioFromName = extractScenarioNameFromPath(currentTrajectoryName);
  trajectoryScenarioName = scenarioFromName || null;
  recomputeScenarioName();
  updateStatus();
  spline?.markSamplesOptimized?.(false);
}

// ---------- Legend ----------
function updateLegend() {
  const ctxL = legendCanvas.getContext("2d");
  const w = legendCanvas.width, h = legendCanvas.height;
  let min=0, max=1, stops = turboStops, flip = true;
  if (colorMode === "height") {
    legendTitle.textContent = "Height (m)";
    const zMinFixed = -3, zMaxFixed = 3;
    let min = zMinFixed, max = zMaxFixed;
    const stops = turboStops;
  
    ctxL.clearRect(0, 0, w, h);
    for (let y = 0; y < h; y++) {
      // y=0 is top → z near max (red), y=h-1 bottom → z near min (light blue)
      const u = 1 - (y / (h - 1));        // 1 at top, 0 at bottom
      const t = 0.50 + 0.50 * u;          // match the point color mapping
      const c = rampColor(stops, t);
      ctxL.fillStyle = `rgb(${(c.r * 255) | 0},${(c.g * 255) | 0},${(c.b * 255) | 0})`;
      ctxL.fillRect(0, y, w, 1);
    }
    legendMin.textContent = min.toFixed(2);
    legendMax.textContent = max.toFixed(2);
    return;
  } else   if (colorMode === "intensity") {
    legendTitle.textContent = "Intensity";
    min = 0; max = 1; stops = viridisStops; flip = true;
  } else if (colorMode === "distance") {
    legendTitle.textContent = "Range (m)";
    min = 0; max = radius*2 || 1; stops = viridisStops; flip = true;
  } else {
    legendTitle.textContent = "Color"; min="—"; max="—";
  }
  ctxL.clearRect(0,0,w,h);
  for (let i=0;i<h;i++){
    const t = i/(h-1);
    const c = rampColor(stops, flip ? (1 - t) : t);
    ctxL.fillStyle = `rgb(${(c.r*255)|0},${(c.g*255)|0},${(c.b*255)|0})`;
    ctxL.fillRect(0, i, w, 1);
  }
  legendMin.textContent = (typeof min === "number") ? min.toFixed(2) : String(min);
  legendMax.textContent = (typeof max === "number") ? max.toFixed(2) : String(max);
}

// ---------- Charts (create BEFORE spline) ----------
const charts = makeCharts({
  velChartSel: d3.select("#velChart"),
  accChartSel: d3.select("#accTotalChart"),
  jerkChartSel: d3.select("#jerkChart"),
  chartsDiv: document.getElementById("charts"),
  dt: +CFG.defaultDt > 0 ? +CFG.defaultDt : 0.20,
  d3,
  limits: CFG.kinematicLimits || {}
});

// ---------- Spline system ----------
let spline = null;

let samplesVisible = true;
function setSamplesVisible(v) {
  const next = !!v;
  samplesVisible = next;
  if (samplesBtn) {
    samplesBtn.setAttribute("aria-pressed", next ? "true" : "false");
  }
  spline?.setShowSamples?.(next);
}

function initializeSpline() {
  if (spline) return;
  spline = makeSplineSystem({
    THREE, d3, scene,
    N_FUTURE: Math.max(4, CFG.N_FUTURE|0 || 16),
    defaultCurve: CFG.defaultCurve || "basis",
    defaultAlpha: +CFG.defaultAlpha || 0.5,
    defaultDt: +CFG.defaultDt > 0 ? +CFG.defaultDt : 0.20,
    optimizer: CFG.optimizer || {},
    requestRender: () => renderOnce(),
    onSamplesChanged: (samples) => charts.render(samples),
    getCamera: () => camera,
    is2D: () => is2D,
    canvasEl: renderer.domElement,
    setControlsEnabled: (v) => { if (controls) controls.enabled = v; },
    N_PAST: HISTORY_COUNT
  });
  spline.setTrajectoryHistory?.(trajectoryHistoryRaw);
  setSamplesVisible(samplesVisible);
  applyWeightsToSpline();
}

setSamplesVisible(samplesVisible);

let optimizeInFlight = false;
let optimizeFlashTimeout = null;
const OPTIMIZE_FLASH_MS = 700;
let prevBodyCursor = null;
let prevCanvasCursor = null;

function setOptimizationCursor(active) {
  const canvas = renderer?.domElement;
  if (active) {
    if (prevBodyCursor !== null) return;
    prevBodyCursor = document.body.style.cursor;
    prevCanvasCursor = canvas ? canvas.style.cursor : null;
    document.body.classList.add("optimizing-cursor");
    if (container) container.classList.add("optimizing-cursor");
    document.body.style.cursor = "progress";
    if (canvas) canvas.style.cursor = "progress";
  } else {
    if (prevBodyCursor === null) return;
    document.body.style.cursor = prevBodyCursor || "";
    document.body.classList.remove("optimizing-cursor");
    if (container) container.classList.remove("optimizing-cursor");
    if (canvas) canvas.style.cursor = prevCanvasCursor ?? "";
    prevBodyCursor = null;
    prevCanvasCursor = null;
  }
}

async function runOptimization() {
  if (!spline) {
    statusOptim("Load a point cloud or trajectory before optimizing.");
    return false;
  }
  if (optimizeInFlight) return false;

  optimizeInFlight = true;
  setOptimizationCursor(true);
  statusOptim("Running optimization...");

  if (optimizeFlashTimeout) {
    clearTimeout(optimizeFlashTimeout);
    optimizeFlashTimeout = null;
  }
  let succeeded = false;

  if (optimizeBtn) {
    optimizeBtn.classList.remove("optimized-flash");
    optimizeBtn.classList.add("optimizing");
    optimizeBtn.setAttribute("aria-busy", "true");
    optimizeBtn.setAttribute("disabled", "true");
  }

  try {
    await Promise.resolve(spline.optimizeTs?.());
    succeeded = true;
    if (optimizeBtn) {
      optimizeBtn.classList.add("optimized-flash");
      optimizeFlashTimeout = window.setTimeout(() => {
        optimizeBtn.classList.remove("optimized-flash");
        optimizeFlashTimeout = null;
      }, OPTIMIZE_FLASH_MS);
    }
    statusOptim("Optimization complete.");
  } catch (err) {
    console.error("Optimization failed", err);
    statusOptim("Optimization failed.");
  } finally {
    if (optimizeBtn) {
      optimizeBtn.classList.remove("optimizing");
      optimizeBtn.removeAttribute("aria-busy");
      optimizeBtn.removeAttribute("disabled");
    }
    setOptimizationCursor(false);
    optimizeInFlight = false;
  }

  return succeeded;
}

// ---------- UI wiring (spline controls) ----------
function syncAlphaVisibility() {
  if (!alphaWrap) return;
  alphaWrap.hidden = (curveSel?.value !== "catmullrom");
}
syncAlphaVisibility();

curveSel?.addEventListener("change", e => {
  const v = e.target.value;
  syncAlphaVisibility();
  spline?.setCurveType?.(v);
});
alphaInput?.addEventListener("input", e => {
  const a = +e.target.value || 0;
  if (alphaVal) alphaVal.textContent = a.toFixed(2);
  spline?.setAlpha?.(a);
});
samplesBtn?.addEventListener("click", () => {
  setSamplesVisible(!samplesVisible);
});
optimizeBtn?.addEventListener("click", () => { runOptimization(); });

function collectExportSnapshot() {
  if (!spline) {
    status("Nothing to export yet.");
    return null;
  }
  // Nx2 in meters
  const controlPts = spline?.getControlPoints ? spline.getControlPoints() : [];
  const samplesArr = spline?.getSamples ? spline.getSamples() : [];
  const samplePtsFull = samplesArr.filter(s => !s.fixed).map(s => [s.t ?? 0, s.x, s.y]);
  const trajectoryRaw = trajectoryRawPoints.slice();
  const weights    = spline?.getOptimizerWeights ? spline.getOptimizerWeights() : {};
  const samplesOptimized = spline?.getSamplesOptimized ? spline.getSamplesOptimized() : false;
  const pointCloudPath = currentPCDPath || null;
  const trajectoryPath = currentTrajectoryPath || null;
  const curveType = spline?.getCurveType ? spline.getCurveType() : null;
  const deltaT = spline?.getDeltaT ? spline.getDeltaT() : null;
  const alpha = spline?.getAlpha ? spline.getAlpha() : null;

  const payload = {
    pointcloud_path: pointCloudPath,
    trajectory_path: trajectoryPath,
    curve_type: curveType,
    delta_t: deltaT,
    samples_optimized: samplesOptimized,
    optimizer:      weights,
    control_points: controlPts,
    sample_points:  samplePtsFull,
    trajectory_raw: trajectoryRaw
  };

  const scenarioName = currentScenarioName || null;
  if (scenarioName) {
    payload.scenario_name = scenarioName;
  }

  if (curveType === "catmullrom" && alpha != null) {
    payload.alpha = alpha;
  }

  const base = scenarioName
    ? `labels_${sanitizeFileStem(scenarioName, "scenario")}`
    : "labels";
  const fname = `${base}.json`;

  return { payload, filename: fname };
}

let pendingExportWarning = null;
let resolveExportWarning = null;
let exportWarningOpen = false;

function resolveExportWarningDecision(value, message) {
  if (message) status(message);
  if (resolveExportWarning) {
    resolveExportWarning(value);
    resolveExportWarning = null;
    pendingExportWarning = null;
  }
  exportWarningOpen = false;
}

function ensureOptimizedBeforeExport(snapshot) {
  const optimized = snapshot?.payload?.samples_optimized;
  if (optimized) return true;

  if (pendingExportWarning) return pendingExportWarning;

  pendingExportWarning = new Promise((resolve) => {
    resolveExportWarning = resolve;
    try {
      exportWarningOpen = true;
      exportWarnDlg?.showModal?.();
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (active && exportWarnDlg?.contains(active)) {
          active.blur?.();
        }
      });
    } catch (err) {
      console.error("Failed to open export warning dialog", err);
      resolveExportWarningDecision(false);
    }
  });

  return pendingExportWarning;
}

const exportController = createExporter({
  manouverTypes,
  dialog: manouverDlg,
  form: manouverForm,
  optionsContainer: manouverOptionsEl,
  cancelButton: manouverCloseBtn,
  confirmButton: manouverConfirmBtn,
  exportButton: exportBtn,
  beforePrompt: ensureOptimizedBeforeExport,
  onCollectData: collectExportSnapshot,
  onStatus: status
});

window.addEventListener("keydown", (e) => {
  if (exportWarningOpen) return;
  if (["INPUT","TEXTAREA","SELECT"].includes(document.activeElement.tagName)) return;
  if (e.key.toLowerCase() === "e") {
    e.preventDefault();
    void exportController?.exportAll?.();
  }
});

function handleExportWarnSkip() {
  exportWarnDlg?.close?.();
  resolveExportWarningDecision(true);
}

exportWarnSkipBtn?.addEventListener("click", handleExportWarnSkip);

async function handleExportWarnOptimize() {
  exportWarnOptimizeBtn.disabled = true;
  try {
    exportWarnDlg?.close?.();
    const optimized = await runOptimization();
    if (optimized) {
      resolveExportWarningDecision(null);
      window.setTimeout(() => {
        void exportController?.exportAll?.();
      }, 0);
    } else {
      resolveExportWarningDecision(false, "Optimization failed; export canceled.");
    }
  } catch (err) {
    console.error("Optimization before export failed", err);
    resolveExportWarningDecision(false, "Optimization failed; export canceled.");
  } finally {
    exportWarnOptimizeBtn.disabled = false;
  }
}

exportWarnOptimizeBtn?.addEventListener("click", handleExportWarnOptimize);

exportWarnCloseBtn?.addEventListener("click", () => {
  exportWarnDlg?.close?.();
  resolveExportWarningDecision(false, "Export canceled.");
});

exportWarnForm?.addEventListener("submit", (evt) => {
  evt.preventDefault();
});

document.addEventListener("keydown", (evt) => {
  if (!exportWarningOpen) return;
  const key = evt.key.toLowerCase();
  if (key === "o") {
    evt.preventDefault();
    evt.stopImmediatePropagation();
    void handleExportWarnOptimize();
  } else if (key === "e") {
    evt.preventDefault();
    evt.stopImmediatePropagation();
    handleExportWarnSkip();
  }
}, true);

manouverCloseBtn?.addEventListener("click", () => {
  manouverDlg?.close();
});


// Help dialog
helpBtn?.addEventListener("click", () => { helpDlg?.showModal(); });
helpCloseBtn?.addEventListener("click", () => { helpDlg?.close(); });

// ---------- UI wiring (PCD) ----------
colorModeSel.addEventListener("change", () => { colorMode = colorModeSel.value; updateLegend(); buildCloud(); });
ptSizeInput.addEventListener("input", () => {
  basePtSize = +ptSizeInput.value;
  ptSizeVal.textContent = `${basePtSize.toFixed(2)} m`;
  syncPointSize();
});
ptSizeInput.value = basePtSize.toFixed(2);
ptSizeVal.textContent = `${basePtSize.toFixed(2)} m`;

viewTopBtn.addEventListener("click", () => { if (!is2D) setTopView3D(); renderOnce(); });
viewIsoBtn.addEventListener("click", () => { if (!is2D) setIsoView3D(); renderOnce(); });

// ---------- Keyboard ----------
window.addEventListener("keydown", (e) => {
  if (["INPUT","TEXTAREA","SELECT"].includes(document.activeElement.tagName)) return;
  const k = e.key.toLowerCase();

  if (k === " ") { e.preventDefault(); toggle2D3D(); return; } // space toggles 2D/3D
  if (k === "z") { if (!spline) return; e.preventDefault(); spline.undoLastAction?.(); return; }
  if (k === "y") { if (!spline) return; e.preventDefault(); spline.redoLastAction?.(); return; }
  if (k === "s") { e.preventDefault(); setSamplesVisible(!samplesVisible); return; }
  if (k === "w") { e.preventDefault(); toggleWeightsPanel(); return; }
  if (k === "delete" || k === "backspace") { if (!spline) return; e.preventDefault(); spline.deleteSelectedCtrl?.(); return; }
  if (k === "o") { e.preventDefault(); runOptimization(); return; }
  if (k === "l") {
    e.preventDefault();
    fileInput?.focus?.();
    fileInput?.click?.();
    statusOptim("Select a point cloud or trajectory to load.");
    return;
  }
  if (k === "e") { e.preventDefault(); void exportController?.exportAll?.(); return; }
});

// ---------- File/open ----------
fileInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const lower = (file.name || "").toLowerCase();
    if (lower.endsWith(".npy")) {
      const { points, name, path: sourcePath } = await loadTrajectoryFromFile(file);
      applyTrajectoryPoints(points, name, sourcePath);
    } else {
      const { raw: rawData, name, path: sourcePath } = await loadPointCloudFromFile(file);
      applyPointCloud(rawData, name, sourcePath);
    }
  } catch (err) {
    console.error(err);
    status(`Failed to load ${file.name}: ${err.message || err}`);
  } finally {
    e.target.value = "";
  }
});

demoBtn?.addEventListener("click", async () => {
  if (!DEMO_PCD && !DEMO_TRAJECTORY) {
    status("Demo paths are not configured in config.js.");
    return;
  }
  demoBtn.disabled = true;
  try {
    const result = await loadDemoDataset({ cloudUrl: DEMO_PCD, trajectoryUrl: DEMO_TRAJECTORY });
    if (result.cloud) {
      applyPointCloud(result.cloud.raw, result.cloud.name, result.cloud.path);
    }
    if (result.trajectory) {
      applyTrajectoryPoints(result.trajectory.points, result.trajectory.name, result.trajectory.path);
    }
    pointCloudScenarioName = "demo";
    trajectoryScenarioName = "demo";
    recomputeScenarioName();
    updateStatus();
  } catch (err) {
    console.error(err);
    status(`Failed to load demo: ${err.message || err}`);
  } finally {
    demoBtn.disabled = false;
  }
});

// ---------- Resize & render loop ----------
new ResizeObserver(() => {
  const w = container.clientWidth, h = container.clientHeight;

  // Perspective
  perspCam.aspect = Math.max(1e-6, w/h);
  perspCam.updateProjectionMatrix();

  // Ortho: rebuild frustum around current center/zoom when in 2D
  if (is2D && camera && camera.isOrthographicCamera) {
    const aspect = Math.max(1e-6, w/h);
    const halfH = (radius || 10) * 1.2 / camera.zoom;
    const halfW = halfH * aspect;
    const cx = controls?.target?.x ?? center.x;
    const cy = controls?.target?.y ?? center.y;
    camera.left = cx - halfW;
    camera.right= cx + halfW;
    camera.top  = cy + halfH;
    camera.bottom=cy - halfH;
    camera.updateProjectionMatrix();
    syncPointSize();
  }

  renderer.setSize(w, h);
  renderOnce();
}).observe(container);

function renderOnce(){ renderer.render(scene, camera); }
(function animate(){
  requestAnimationFrame(animate);
  controls?.update();
  renderer.render(scene, camera);
})();

// ---------- Helper: update legend initially ----------
updateLegend();
setBadge("3D");
setIsoView3D();
renderOnce();
exportWarnDlg?.addEventListener("cancel", (evt) => {
  evt.preventDefault();
  exportWarnDlg?.close?.();
  resolveExportWarningDecision(false, "Export canceled.");
});
