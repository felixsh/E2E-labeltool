// app.js (ESM) — requires an import map in index.html for "three" & "three/addons/"
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";

import { parsePointCloud } from "./src/pcdParser.js";
import { makeCharts } from "./src/charts.js";
import { makeSplineSystem } from "./src/splineCore.js";

// ---------- CONFIG ----------
const CFG = window.MERGED_CONFIG || {};
const DEFAULT_PCD = CFG.defaultPCD;
let basePtSize = +CFG.pointSize > 0 ? +CFG.pointSize : 0.08; // meters
let maxPoints  = +CFG.maxPoints > 0 ? +CFG.maxPoints : 500000;

// ---------- DOM ----------
const container   = document.getElementById("stage3d");
const statusEl    = document.getElementById("status");
const fileInput   = document.getElementById("fileInput");
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
const showSamplesChk = document.getElementById("showSamplesChk");
const optimizeBtn = document.getElementById("optimizeBtn");
const exportBtn   = document.getElementById("exportSamplesBtn");
const helpBtn     = document.getElementById("helpBtn");
const helpDlg     = document.getElementById("helpDlg");
const helpClose   = document.getElementById("helpClose");

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
grid.rotation.x = Math.PI / 2;
scene.add(grid);
const axes = new THREE.AxesHelper(5);
scene.add(axes);

// ---------- Cameras & controls glue (pcd_viewer-style 2D) ----------
let is2D = false;
let camera = null;
let controls = null;

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
  cam.zoom = 1;
  cam.updateProjectionMatrix();
  return cam;
}

function makeControls(cam) {
  const c = new OrbitControls(cam, renderer.domElement);
  c.enableDamping = true;
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
  zoom: 1
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
  if (!bounds) return;
  updateCenterAndRadius();
  const k = radius || 10;
  perspCam.up.set(0,0,1); // Z up
  perspCam.position.copy(center).add(new THREE.Vector3(-1.4*k, -1.4*k, 1.0*k));
  perspCam.lookAt(center);
  controls.target.copy(center);
  controls.update();
  snapshot3D();
}

function setTopView3D() {
  if (!bounds) return;
  updateCenterAndRadius();
  perspCam.up.set(0,0,1); // Z up
  perspCam.position.set(center.x, center.y, center.z + (radius || 10)*2.0);
  perspCam.lookAt(center);
  controls.target.copy(center);
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
  }
  controls.update();

  controls.addEventListener("change", () => { snapshot2D(); syncPointSize(); renderOnce(); });

  is2D = true;
  setBadge("2D");
  syncPointSize();

  // spline appears as 2D line in 2D mode
  spline?.rebuildCurveObject(true);
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

function status(msg){ if (statusEl) statusEl.textContent = msg; }
function formatK(n){ return n >= 1000 ? Math.round(n/1000) + "k" : String(n); }

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
  } else if (colorMode === "intensity") {
    legendTitle.textContent = "Intensity";
    min = 0; max = 1; stops = viridisStops; flip = false;
  } else if (colorMode === "distance") {
    legendTitle.textContent = "Range (m)";
    min = 0; max = radius*2 || 1; stops = viridisStops; flip = false;
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
  accLongChartSel: d3.select("#accLongChart"),
  accLatChartSel: d3.select("#accLatChart"),
  chartsDiv: document.getElementById("charts"),
  chartLimits: CFG.chartLimits || {},
  dt: +CFG.defaultDt > 0 ? +CFG.defaultDt : 0.20,
  d3
});

// ---------- Spline system ----------
const spline = makeSplineSystem({
  THREE, d3, scene,
  N_SAMPLES: Math.max(4, CFG.N_SAMPLES|0 || 16),
  defaultCurve: CFG.defaultCurve || "basis",
  defaultAlpha: +CFG.defaultAlpha || 0.5,
  defaultDt: +CFG.defaultDt > 0 ? +CFG.defaultDt : 0.20,
  chartLimits: CFG.chartLimits || {},
  optimizer: CFG.optimizer || {},
  requestRender: () => renderOnce(),
  onSamplesChanged: (samples) => charts.render(samples),
  getCamera: () => camera,
  is2D: () => is2D,
  canvasEl: renderer.domElement,
  setControlsEnabled: (v) => { if (controls) controls.enabled = v; }
});

// ---------- UI wiring (spline controls) ----------
function syncAlphaVisibility() {
  if (!alphaWrap) return;
  alphaWrap.hidden = (curveSel?.value !== "catmullrom");
}
syncAlphaVisibility();

curveSel?.addEventListener("change", e => {
  const v = e.target.value;
  syncAlphaVisibility();
  spline.setCurveType(v);
});
alphaInput?.addEventListener("input", e => {
  const a = +e.target.value || 0;
  if (alphaVal) alphaVal.textContent = a.toFixed(2);
  spline.setAlpha(a);
});
showSamplesChk?.addEventListener("change", e => {
  spline.setShowSamples(!!e.target.checked);
});
optimizeBtn?.addEventListener("click", () => spline.optimizeTs());

function exportAll() {
  // Nx2 in meters
  const controlPts = spline.getControlPoints();                  // [[x,y], ...]
  const samplePts  = spline.getSamples().map(s => [s.x, s.y]);   // [[x,y], ...]
  const weights    = spline.getOptimizerWeights();

  const payload = {
    control_points: controlPts,
    sample_points:  samplePts,
    optimizer:      weights
  };

  const base = (currentPCDName || "spline").replace(/\.[^.]+$/,"");
  const fname = `${base}.json`;

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = fname;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

exportBtn?.addEventListener("click", exportAll);
window.addEventListener("keydown", (e) => {
  if (["INPUT","TEXTAREA","SELECT"].includes(document.activeElement.tagName)) return;
  if (e.key.toLowerCase() === "e") { e.preventDefault(); exportAll(); }
});


// Help dialog
helpBtn?.addEventListener("click", () => { helpDlg?.showModal(); });
helpClose?.addEventListener("click", () => { helpDlg?.close(); });

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
  if (k === "delete" || k === "backspace") { e.preventDefault(); spline.deleteSelectedCtrl(); return; }
  if (k === "e") { e.preventDefault(); exportSamples(); return; }
});

// ---------- File/open ----------
fileInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  status(`Reading ${file.name}…`);
  try {
    const buf = await file.arrayBuffer();
    raw = parsePointCloud(buf, file.name);               // <— unified
    bounds = computeBounds(raw.points, raw.xyzIdx);
    status(`Loaded ${file.name} — ${raw.count.toLocaleString()} points, fields: ${raw.fields.join(", ")}`);

    updateCenterAndRadius();
    updateLegend();
    buildCloud();

    // keep your view logic; this sets a good 3D view
    setIsoView3D();

    // enable view buttons
    viewTopBtn.disabled = false; 
    viewIsoBtn.disabled = false;

    // notify spline so it can position/scale if needed
    spline.onCloudLoaded(center, radius);

    renderOnce();

    currentPCDName = file.name || "pointcloud.pcd";
  } catch (err) {
    console.error(err);
    status(`Failed: ${err.message || err}`);
  }
});

// ---------- Auto-load default point cloud (fail silently) ----------
(async () => {
  if (!DEFAULT_PCD) return;
  try {
    const resp = await fetch(DEFAULT_PCD);
    if (!resp.ok) return; // silent fail
    const buf = await resp.arrayBuffer();

    raw = parsePointCloud(buf, DEFAULT_PCD);            // <— unified
    bounds = computeBounds(raw.points, raw.xyzIdx);
    status(`Loaded default point cloud — ${DEFAULT_PCD}`);

    updateCenterAndRadius();
    updateLegend();
    buildCloud();

    setIsoView3D();

    viewTopBtn.disabled = false; 
    viewIsoBtn.disabled = false;

    spline.onCloudLoaded(center, radius);

    renderOnce();

    currentPCDName = (DEFAULT_PCD.split("/").pop()) || "pointcloud.pcd";
  } catch (_err) {
    // silent
  }
})();

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
