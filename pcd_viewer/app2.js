import * as THREE from "https://esm.sh/three@0.160.0";
import { OrbitControls } from "https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js";

(() => {
  // ==== CONFIG ====
  const CFG = window.PCD_CONFIG || {};
  const DEFAULT_PCD_PATH = CFG.defaultPCD || "";

  // ===== DOM =====
  const container = document.getElementById("stage3d");
  const fileInput = document.getElementById("fileInput");
  const statusEl  = document.getElementById("status");
  const viewTopBtn= document.getElementById("viewTopBtn");
  const viewIsoBtn= document.getElementById("viewIsoBtn");

  const colorModeSel = document.getElementById("colorMode");
  const ptSizeInput  = document.getElementById("ptSize");
  const ptSizeVal    = document.getElementById("ptSizeVal");

  const legendCanvas = document.getElementById("legendCanvas");
  const legendTitle  = document.getElementById("legendTitle");
  const legendMin    = document.getElementById("legendMin");
  const legendMax    = document.getElementById("legendMax");

  const modeBadge = document.getElementById("modeBadge");
  function setBadge(mode){ // "2D" or "3D"
    if (!modeBadge) return;
    modeBadge.textContent = mode;
    modeBadge.classList.remove("two","three");
    modeBadge.classList.add("badge", mode === "2D" ? "two" : "three");
  }

  // ===== THREE setup =====
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth || 640, container.clientHeight || 480);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  renderer.domElement.classList.add("threejs"); // ensure only this canvas is full-size
  
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0d13);
  
  // ---- Cameras & Controls (2D/3D toggle) ----
  let camera;            // current active camera
  let controls;          // current active controls
  let is2D = false;      // spacebar toggles this
  let radius = 10;       // you already update this from bounds
  const center = new THREE.Vector3(); // you already have a center in your code
  
  function makePerspectiveCamera() {
    const w = container.clientWidth || 640, h = container.clientHeight || 480;
    const cam = new THREE.PerspectiveCamera(60, Math.max(1e-6, w/h), 0.1, 2000);
    cam.up.set(0, 0, 1); // Z-up so azimuth is around Z
    return cam;
  }
  
  function makeOrthoCamera() {
    const w = container.clientWidth || 640, h = container.clientHeight || 480;
    const aspect = Math.max(1e-6, w/h);
    const r = Math.max(1, radius); // view half-extent in meters
    // Frustum sized to data extents; X spans ±r*aspect, Y spans ±r
    const cam = new THREE.OrthographicCamera(-r*aspect, r*aspect, r, -r, -2000, 2000);
    cam.up.set(0, 0, 1);
    return cam;
  }
  
  function makeControls(cam) {
    const c = new OrbitControls(cam, renderer.domElement);
    c.enableDamping = true;
    c.minDistance = 0.1;
    c.maxDistance = 5000;
    return c;
  }
  
  // Initial: start in 3D
  camera = makePerspectiveCamera();
  controls = makeControls(camera);

  // Lights (soft)
  const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 0.4);
  const dir  = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(1, 1, 1);
  scene.add(hemi, dir);

  // Grid & axes
  const grid = new THREE.GridHelper(100, 20, 0x334, 0x223);
  grid.rotation.x = Math.PI / 2; // lie on XY plane (Z up)
  scene.add(grid);
  const axes = new THREE.AxesHelper(5); // X red, Y green, Z blue
  scene.add(axes);

  // ===== State =====
  let colorMode = colorModeSel?.value ?? "height";    // "height" | "intensity" | "distance" | "solid"
  let ptSize    = +(ptSizeInput?.value ?? 2);
  let maxPoints = (window.PCD_CONFIG?.maxPoints ?? 500000) | 0; // fixed cap
  let exposure  = 1.0; // fixed global exposure
  renderer.toneMappingExposure = exposure;

  // Apply config defaults (AFTER the lets above)
  if (CFG.pointSize) { ptSize = CFG.pointSize; if (ptSizeInput) ptSizeInput.value = CFG.pointSize; if (ptSizeVal) ptSizeVal.textContent = String(CFG.pointSize); }
  if (CFG.colorMode) { colorMode = CFG.colorMode; if (colorModeSel) colorModeSel.value = CFG.colorMode; }

  if (ptSizeVal) ptSizeVal.textContent = ptSize.toFixed(2) + " m";

  let cloud = null;                // THREE.Points
  let raw = null;                  // {points: Float32Array, fields, xyzIdx, count}
  let bounds = null;               // {xmin,xmax,ymin,ymax,zmin,zmax}

  let basePtSize = ptSize; // meters (slider/config value)
  
  function appliedPtSize() {
    // In 3D (perspective): use base size in meters
    // In 2D (ortho): compensate for zoom so on-screen size feels similar
    return is2D ? basePtSize * Math.max(1e-6, camera.zoom) : basePtSize;
  }
  function syncPointSize() {
    if (cloud) {
      const s = appliedPtSize();
      if (cloud.material.size !== s) {
        cloud.material.size = s;
        renderOnce();
      }
    }
  }

  // ===== Utils =====
  function status(msg){ if (statusEl) statusEl.textContent = msg; }
  function formatK(n){ return n >= 1000 ? Math.round(n/1000) + "k" : String(n); }

  // Simple color ramps (Turbo & Viridis approximations via THREE.Color.lerpColors)
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

  // ===== Build THREE geometry from raw data =====
  function buildCloud() {
    if (cloud) { scene.remove(cloud); cloud.geometry.dispose(); cloud.material.dispose(); cloud = null; }
    if (!raw) return;

    const hasI = raw.xyzIdx.i >= 0;
    const dim = hasI ? 4 : 3;
    const total = Math.min(raw.points.length / dim, maxPoints|0);
    console.log("Building cloud with", total, "points");
    if (total <= 0) { status("Parsed 0 points"); return; }

    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);

    // Color stats
    const zmin = bounds.zmin, zmax = bounds.zmax, zspan = Math.max(1e-6, zmax - zmin);

    // intensity normalization heuristic
    let imin=Infinity, imax=-Infinity;
    if (hasI) {
      for (let k=3, used=0; k<raw.points.length && used<total; k+=dim, used++){
        const v = raw.points[k]; if (v<imin) imin=v; if (v>imax) imax=v;
      }
      if (imax <= 1.0) { imin = 0; } // assume 0..1
      else if (imax <= 255) { imin = 0; imax = 255; } // assume 0..255
    }

    for (let p=0, k=0; p<total; p++, k+=dim) {
      const x = raw.points[k+0], y = raw.points[k+1], z = raw.points[k+2];
      pos[p*3+0] = x;
      pos[p*3+1] = y;
      pos[p*3+2] = z;

      let color;
      if (colorMode === "height") {
        const t = (z - zmin) / zspan;
        color = rampColor(turboStops, 1 - t); // high = warm
      } else if (colorMode === "intensity" && hasI) {
        const v = raw.points[k+3];
        let t;
        if (imax <= 1.0) t = v; else if (imax <= 255) t = v/255; else t = (v - imin) / Math.max(1e-6, (imax - imin));
        color = rampColor(viridisStops, t);
      } else if (colorMode === "distance") {
        const r = Math.sqrt(x*x + y*y + z*z);
        const t = Math.min(1, r / (radius || 1));
        color = rampColor(viridisStops, t);
      } else {
        color = new THREE.Color(0x9fb3ff);
      }
      col[p*3+0] = color.r;
      col[p*3+1] = color.g;
      col[p*3+2] = color.b;
    }

    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color",  new THREE.BufferAttribute(col,  3));
    geo.computeBoundingSphere();

    const mat = new THREE.PointsMaterial({
      size: appliedPtSize(),
      sizeAttenuation: true,
      vertexColors: true,
      transparent: false
    });

    cloud = new THREE.Points(geo, mat);
    scene.add(cloud);
    renderer.toneMappingExposure = exposure;
    renderOnce();
  }

  // ===== Fit / views =====
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

  function enter3D() {
    syncPointSize();
    // swap camera to perspective
    const oldControls = controls; oldControls?.dispose();
    camera = makePerspectiveCamera();
    controls = makeControls(camera);
  
    // rotation ON, right mouse pan
    controls.enableRotate = true;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN
    };
  
    // place camera to iso view around current center/radius
    camera.position.copy(center).add(new THREE.Vector3(radius*1.2, radius*1.2, radius*1.0));
    camera.lookAt(center);
    controls.target.copy(center);
    controls.update();
    renderer.render(scene, camera);

    setBadge("3D");
  }
  
  function enter2D() {
    syncPointSize();
    // swap camera to orthographic
    const oldControls = controls; oldControls?.dispose();
    camera = makeOrthoCamera();
    controls = makeControls(camera);

    // update size when zoom changes
    controls.addEventListener("change", syncPointSize);
  
    // 2D: disable rotation; pan with RIGHT; wheel zoom ok
    controls.enableRotate = false;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.NONE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN
    };
  
    // top-down: camera above looking straight down Z
    camera.position.set(center.x, center.y, center.z + radius*2.0);
    camera.lookAt(center);
    controls.target.copy(center);
    controls.update();
    renderer.render(scene, camera);

    setBadge("2D");
  }
  
  function toggle2D() {
    is2D = !is2D;
    if (is2D) enter2D(); else enter3D();
  }

  function autoFit() {
    if (!bounds) return;
    updateCenterAndRadius();
    camera.up.set(0, 0, 1);  // ← enforce Z-up
    camera.position.copy(center).add(new THREE.Vector3(radius*1.2, radius*1.2, radius*1.0));
    camera.lookAt(center);
    controls.target.copy(center);
    controls.update();
    renderOnce();
  }
  
  function setTopView() {
    if (!bounds) return;
    updateCenterAndRadius();
    camera.up.set(0, 0, 1);      // ← keep Z-up
    camera.position.set(center.x, center.y, center.z + radius*2.0); // above, looking down
    camera.lookAt(center);
    controls.target.copy(center);
    controls.update();
    renderOnce();
  }

  function setIsoView() { autoFit(); }

  function setTopPerspective3D(){
    // stay in 3D (perspective), just move camera above
    if (!camera.isPerspectiveCamera) enter3D(); // ensure perspective
    const oldControls = controls; oldControls?.dispose();
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enableRotate = true;              // rotation stays enabled in 3D
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN
    };
    // place camera straight above center with some distance
    const d = Math.max(1, radius*2.0);
    camera.up.set(0,0,1);
    camera.position.set(center.x, center.y, center.z + d);
    camera.lookAt(center);
    controls.target.copy(center);
    controls.update();
    setBadge("3D"); // still 3D
    renderOnce();
  }

  // ===== PCD parsing (ASCII + binary) =====
  async function readFileAsArrayBuffer(file) { return await file.arrayBuffer(); }

  function parsePCD(arrayBuffer) {
    const headText = new TextDecoder().decode(arrayBuffer.slice(0, Math.min(arrayBuffer.byteLength, 1<<20)));
    const lines = headText.split(/\r?\n/);
    let h = {}, headerLenBytes = 0, seenData = false;
    for (const line of lines) {
      headerLenBytes += line.length + 1;
      const ln = line.trim();
      if (!ln || ln.startsWith("#")) continue;
      const [k, ...rest] = ln.split(/\s+/);
      const key = k?.toUpperCase();
      const v = rest.join(" ");
      h[key] = v;
      if (key === "DATA") { seenData = true; break; }
    }
    if (!seenData) throw new Error("PCD: DATA line not found");

    const fields = (h.FIELDS || h.FIELD || "x y z").trim().split(/\s+/);
    const size = (h.SIZE || "").trim().split(/\s+/).map(Number);
    const type = (h.TYPE || "").trim().split(/\s+/);
    const count = (h.COUNT || "").trim() ? h.COUNT.trim().split(/\s+/).map(Number) : fields.map(_ => 1);
    const width = +(h.WIDTH || 0);
    const height = +(h.HEIGHT || 1);
    const pointsCount = +(h.POINTS || (width * height));
    const dataMode = (h.DATA || "").toLowerCase();

    const idx = {
      x: fields.indexOf("x"),
      y: fields.indexOf("y"),
      z: fields.indexOf("z"),
      i: fields.indexOf("intensity"),
    };
    if (idx.x < 0 || idx.y < 0 || idx.z < 0) {
      throw new Error(`PCD missing x/y/z fields. Found: ${fields.join(", ")}`);
    }

    if (dataMode.startsWith("ascii")) {
      const body = new TextDecoder().decode(arrayBuffer.slice(headerLenBytes)).trim();
      const linesB = body.split(/\r?\n/);
      const hasI = idx.i >= 0;
      const out = new Float32Array(pointsCount * (hasI ? 4 : 3));
      let k = 0;
      for (let li=0; li<linesB.length && k<out.length; li++) {
        const parts = linesB[li].trim().split(/\s+/);
        if (parts.length < fields.length) continue;
        out[k++] = parseFloat(parts[idx.x]);
        out[k++] = parseFloat(parts[idx.y]);
        out[k++] = parseFloat(parts[idx.z]);
        if (hasI) out[k++] = parseFloat(parts[idx.i]);
      }
      return { points: out, fields, xyzIdx: idx, count: Math.floor(k / (hasI?4:3)) };
    }

    if (dataMode.startsWith("binary")) {
      // offsets per field
      let fieldOffsets = [];
      let stride = 0;
      for (let fi=0; fi<fields.length; fi++) {
        fieldOffsets.push(stride);
        stride += (size[fi] * (count[fi] || 1));
      }
      const view = new DataView(arrayBuffer, headerLenBytes);
      const hasI = idx.i >= 0;
      const out = new Float32Array(pointsCount * (hasI?4:3));
      let k=0;
      for (let p=0; p<pointsCount; p++) {
        const base = p * stride;
        out[k++] = view.getFloat32(base + fieldOffsets[idx.x], true);
        out[k++] = view.getFloat32(base + fieldOffsets[idx.y], true);
        out[k++] = view.getFloat32(base + fieldOffsets[idx.z], true);
        if (hasI) {
          if (size[idx.i] === 4 && (type[idx.i]||'F').toUpperCase() === 'F') {
            out[k++] = view.getFloat32(base + fieldOffsets[idx.i], true);
          } else {
            out[k++] = view.getUint8(base + fieldOffsets[idx.i]); // basic fallback
          }
        }
      }
      return { points: out, fields, xyzIdx: idx, count: pointsCount };
    }

    if (dataMode.includes("binary_compressed")) {
      throw new Error("PCD DATA binary_compressed not supported yet.");
    }
    throw new Error(`Unsupported PCD DATA mode: ${dataMode}`);
  }

  // ===== Legend =====
  function updateLegend() {
    if (!legendCanvas) return; // guard
    const ctxL = legendCanvas.getContext("2d");
    if (!ctxL) return;
    const w = legendCanvas.width, h = legendCanvas.height;
    let min=0, max=1, stops = turboStops, flip = true;
    if (colorMode === "height") {
      legendTitle && (legendTitle.textContent = "Height (m)");
      if (bounds) { min = bounds.zmin; max = bounds.zmax; }
      stops = turboStops; flip = true;
    } else if (colorMode === "intensity") {
      legendTitle && (legendTitle.textContent = "Intensity");
      min = 0; max = 1; stops = viridisStops; flip = false;
    } else if (colorMode === "distance") {
      legendTitle && (legendTitle.textContent = "Range (m)");
      min = 0; max = radius*2 || 1; stops = viridisStops; flip = false;
    } else {
      legendTitle && (legendTitle.textContent = "Color"); min="—"; max="—";
    }
    ctxL.clearRect(0, 0, w, h);
    for (let y = 0; y < h; y++) {
      const t = y / (h - 1);
      const c = rampColor(stops, flip ? (1 - t) : t);
      ctxL.fillStyle = `rgb(${(c.r*255)|0},${(c.g*255)|0},${(c.b*255)|0})`;
      ctxL.fillRect(0, y, w, 1);
    }
    if (legendMin) legendMin.textContent = (typeof min === "number") ? min.toFixed(2) : String(min);
    if (legendMax) legendMax.textContent = (typeof max === "number") ? max.toFixed(2) : String(max);
  }

  // ===== Render loop =====
  function renderOnce(){ renderer.render(scene, camera); }
  function animate(){
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();
  renderOnce(); // draw grid/axes immediately

  // ===== Events =====
  new ResizeObserver(() => {
    const w = container.clientWidth || 640, h = container.clientHeight || 480;
    if (camera.isPerspectiveCamera) {
      camera.aspect = Math.max(1e-6, w/h);
      camera.updateProjectionMatrix();
    } else if (camera.isOrthographicCamera) {
      const aspect = Math.max(1e-6, w/h);
      const r = Math.max(1, radius);
      camera.left   = -r * aspect;
      camera.right  =  r * aspect;
      camera.top    =  r;
      camera.bottom = -r;
      camera.updateProjectionMatrix();
    }
    renderer.setSize(w, h);
    renderer.render(scene, camera);
    syncPointSize();
  }).observe(container);

  fileInput?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    status(`Reading ${file.name}…`);
    try {
      const buf = await readFileAsArrayBuffer(file);
      raw = parsePCD(buf);
      setBadge(is2D ? "2D" : "3D");
      bounds = computeBounds(raw.points, raw.xyzIdx);
      status(`Loaded ${file.name} — ${raw.count.toLocaleString()} points, fields: ${raw.fields.join(", ")}`);
      viewTopBtn && (viewTopBtn.disabled = false);
      viewIsoBtn && (viewIsoBtn.disabled = false);
      updateCenterAndRadius();
      updateLegend();
      buildCloud();
      if (is2D) enter2D(); else enter3D();
    } catch (err) {
      console.error(err);
      status(`Failed: ${err.message || err}`);
    }
  });

  viewTopBtn?.addEventListener("click", () => {
    if (is2D) {
      enter2D();              // stay in 2D, keep ortho top-down
    } else {
      setTopPerspective3D();  // 3D top view (perspective)
    }
  });
  viewIsoBtn?.addEventListener("click", () => {
    is2D = false;
    enter3D();                // iso perspective
  });

  colorModeSel?.addEventListener("change", () => {
    colorMode = colorModeSel.value;
    updateLegend();
    buildCloud();
  });

  ptSizeInput?.addEventListener("input", () => {
    basePtSize = +ptSizeInput.value;
    if (ptSizeVal) ptSizeVal.textContent = basePtSize.toFixed(2) + " m";
    syncPointSize();
  });

  // ===== Init legend once =====
  updateLegend();

  // ==== Optional auto-load default PCD ====
  (async () => {
    if (!DEFAULT_PCD_PATH) return;
    try {
      const resp = await fetch(DEFAULT_PCD_PATH);
      if (!resp.ok) { status("Default PCD not found. Use Load .pcd."); return; }
      const buf = await resp.arrayBuffer();
      raw = parsePCD(buf);
      setBadge(is2D ? "2D" : "3D");
      bounds = computeBounds(raw.points, raw.xyzIdx);
      status(`Loaded default PCD — ${DEFAULT_PCD_PATH}`);
      viewTopBtn && (viewTopBtn.disabled = false);
      viewIsoBtn && (viewIsoBtn.disabled = false);
      updateCenterAndRadius();
      updateLegend();
      buildCloud();
      setIsoView();
    } catch (err) {
      // fail silently but nudge status
      console.warn("Default PCD load skipped:", err);
      status("Default PCD not available. Use Load .pcd.");
    }
  })();

  // ===== Keyboard shortcuts =====
  window.addEventListener("keydown", (e) => {
    // ignore if typing in a form field
    if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) return;
  
    if (e.code === "Space") {
      e.preventDefault();
      toggle2D(); // toggle between 2D/3D
    }
  });

})();
