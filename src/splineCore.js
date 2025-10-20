// src/splineCore.js
export function makeSplineSystem({
  THREE, d3, scene,
  N_SAMPLES = 16,
  defaultCurve = "basis",
  defaultAlpha = 0.5,
  defaultDt = 0.20,
  chartLimits = {},
  optimizer = {},
  requestRender = () => {},
  onSamplesChanged = () => {},
  getCamera,            // () => camera
  is2D,                 // () => boolean
  canvasEl,             // renderer.domElement
  setControlsEnabled    // (bool) => void
}) {
  // ===== CSS var helpers =====
  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  function cssNumber(name, fallback) {
    const n = parseFloat(cssVar(name, fallback));
    return Number.isFinite(n) ? n : fallback;
  }
  function cssColor(name, fallback = "#ffffff") {
    return new THREE.Color(cssVar(name, fallback));
  }

  // ===== Visual params (from styles.css) =====
  const CTRL_RADIUS    = cssNumber("--ctrl-size", 0.12);
  const SAMPLE_RADIUS  = cssNumber("--sample-size", 0.10);
  const TUBE_RADIUS    = cssNumber("--spline-width", 0.06);

  const CTRL_COLOR        = cssColor("--ctrl-color", "#66ccff");
  const CTRL_COLOR_SEL    = cssColor("--ctrl-selected-color", "#ff6699");
  const SAMPLE_COLOR      = cssColor("--sample-color", "#ffffff");
  const SAMPLE_COLOR_SEL  = cssColor("--sample-selected-color", "#ffcc00");
  const SPLINE_COLOR      = cssColor("--spline-color", "#ffd480");

  // ===== Spline state =====
  let curveType = (defaultCurve === "natural" || defaultCurve === "catmullrom") ? defaultCurve : "basis";
  let alpha = +defaultAlpha || 0.5;
  const dt = +defaultDt > 0 ? +defaultDt : 0.20;

  let points = (Array.isArray((window.MERGED_CONFIG || {}).initCtrl) && (window.MERGED_CONFIG.initCtrl.length >= 2))
    ? window.MERGED_CONFIG.initCtrl.map(([x, y]) => new THREE.Vector3(x, y, 0))
    : [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 4, 0)];  // only two initial points

  const N = Math.max(4, (N_SAMPLES | 0));
  let Ts = d3.range(N).map(i => i / (N - 1));
  let selectedCtrl = points.length - 1; // select last control point by default
  let selectedSample = null;
  let showSamples = true;

  // ===== Visual objects =====
  let densePts = [];           // resampled polyline points (Vector3)
  let curveObject = null;      // Tube mesh (both 2D/3D)
  const ctrlSpheres = [];
  const sampleSpheres = [];

  // Sample index labels (sprites)
  const sampleLabels = [];
  const labelCache = new Map(); // text => Texture

  // Geometries
  const ctrlGeom = new THREE.SphereGeometry(CTRL_RADIUS, 24, 18);
  const smplGeom = new THREE.SphereGeometry(SAMPLE_RADIUS, 20, 16);

  // Materials
  const ctrlMat    = new THREE.MeshBasicMaterial({ color: CTRL_COLOR });
  const ctrlMatSel = new THREE.MeshBasicMaterial({ color: CTRL_COLOR_SEL });
  const smplMat    = new THREE.MeshBasicMaterial({ color: SAMPLE_COLOR });
  const smplMatSel = new THREE.MeshBasicMaterial({ color: SAMPLE_COLOR_SEL });

  // ===== d3 curve path context -> dense polyline =====
  function samplingPathContext({ curveSubdivisions = 18 } = {}) {
    let pts = []; let cx = 0, cy = 0;
    function push(x, y) { pts.push([x, y]); cx = x; cy = y; }
    function cubicPoint(t, x0, y0, x1, y1, x2, y2, x3, y3) {
      const u = 1 - t;
      const aX = u * x0 + t * x1, aY = u * y0 + t * y1;
      const bX = u * x1 + t * x2, bY = u * y1 + t * y2;
      const cX = u * x2 + t * x3, cY = u * y2 + t * y3;
      const dX = u * aX + t * bX, dY = u * aY + t * bY;
      const eX = u * bX + t * cX, eY = u * bY + t * cY;
      return [u * dX + t * eX, u * dY + t * eY];
    }
    function quadToCubic(x0, y0, qx, qy, x1, y1) {
      const c1x = x0 + (2 / 3) * (qx - x0), c1y = y0 + (2 / 3) * (qy - y0);
      const c2x = x1 + (2 / 3) * (qx - x1), c2y = y1 + (2 / 3) * (qy - y1);
      return [c1x, c1y, c2x, c2y, x1, y1];
    }
    return {
      beginPath() { pts = []; },
      moveTo(x, y) { push(x, y); },
      lineTo(x, y) { push(x, y); },
      bezierCurveTo(cx1, cy1, cx2, cy2, x, y) {
        const n = Math.max(2, curveSubdivisions | 0);
        const x0 = cx, y0 = cy;
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const [px, py] = cubicPoint(t, x0, y0, cx1, cy1, cx2, cy2, x, y);
          push(px, py);
        }
      },
      quadraticCurveTo(qx, qy, x, y) {
        const [c1x, c1y, c2x, c2y, x1, y1] = quadToCubic(cx, cy, qx, qy, x, y);
        this.bezierCurveTo(c1x, c1y, c2x, c2y, x1, y1);
      },
      closePath() {},
      _result() { return pts; }
    };
  }
  function d3Curve() {
    const { curveBasis, curveNatural, curveCatmullRom } = d3;
    if (curveType === "basis") return curveBasis;
    if (curveType === "natural") return curveNatural;
    return curveCatmullRom.alpha(alpha);
  }

  // Build dense polyline in XY plane (Z = 0)
  function rebuildDensePolyline() {
    const ctx = samplingPathContext({ curveSubdivisions: 18 });
    const raw2D = points.map(p => [p.x, p.y]);
    d3.line().x(d => d[0]).y(d => d[1]).curve(d3Curve()).context(ctx)(raw2D);

    const raw = ctx._result();
    if (raw.length < 2) { densePts = []; return; }

    const poly = raw.map(([x, y]) => new THREE.Vector3(x, y, 0));
    const lens = [0];
    for (let i = 1; i < poly.length; i++) lens[i] = lens[i - 1] + poly[i].distanceTo(poly[i - 1]);
    const L = lens[lens.length - 1] || 1, targetN = 240, out = [];
    for (let i = 0; i < targetN; i++) {
      const s = (i / (targetN - 1)) * L;
      let idx = d3.bisectLeft(lens, s);
      if (idx <= 0) { out.push(poly[0].clone()); continue; }
      if (idx >= lens.length) { out.push(poly[poly.length - 1].clone()); continue; }
      const s0 = lens[idx - 1], s1 = lens[idx], u = (s - s0) / Math.max(1e-9, s1 - s0);
      out.push(poly[idx - 1].clone().lerp(poly[idx], u));
    }
    densePts = out;
  }

  function paramToPoint(t) {
    if (densePts.length === 0) return new THREE.Vector3();
    const f = t * (densePts.length - 1), i = Math.floor(f), u = f - i;
    if (i >= densePts.length - 1) return densePts[densePts.length - 1].clone();
    return densePts[i].clone().lerp(densePts[i + 1], u);
  }
  function projectPointToParam(p) {
    if (densePts.length < 2) return 0;
    let bestI = 0, bestU = 0, best = Infinity;
    for (let i = 0; i < densePts.length - 1; i++) {
      const a = densePts[i], b = densePts[i + 1];
      const abx = b.x - a.x, aby = b.y - a.y;
      const apx = p.x - a.x, apy = p.y - a.y;
      const denom = abx * abx + aby * aby || 1e-9;
      let u = (apx * abx + apy * aby) / denom; u = Math.max(0, Math.min(1, u));
      const qx = a.x + u * abx, qy = a.y + u * aby;
      const d2 = (qx - p.x) * (qx - p.x) + (qy - p.y) * (qy - p.y);
      if (d2 < best) { best = d2; bestI = i; bestU = u; }
    }
    return (bestI + bestU) / (densePts.length - 1);
  }

  // ===== Spline object: TUBE in both 2D & 3D (for matching look) =====
  function rebuildCurveObject() {
    if (curveObject) { scene.remove(curveObject); curveObject.geometry.dispose(); curveObject.material.dispose(); curveObject = null; }
    if (densePts.length < 2) return;

    // 3D/2D: Tube for matching look
    class ParamCurve extends THREE.Curve {
      constructor(fn){ super(); this._fn = fn; }
      getPoint(t, target = new THREE.Vector3()){
        const p = this._fn(t); return target.set(p.x, p.y, p.z);
      }
      getTangent(t, target = new THREE.Vector3()){
        const eps = 1e-3, t1 = Math.max(0, t - eps), t2 = Math.min(1, t + eps);
        const p1 = this._fn(t1), p2 = this._fn(t2);
        return target.set(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z).normalize();
      }
    }
    const path = new ParamCurve(paramToPoint);
    const geo  = new THREE.TubeGeometry(path, 240, TUBE_RADIUS, 16, false);
    
    // ✅ Unlit material: always shows CSS color
    const mat  = new THREE.MeshBasicMaterial({ color: SPLINE_COLOR });
    
    curveObject = new THREE.Mesh(geo, mat);
    scene.add(curveObject);
  }

  // ===== Sample index labels =====
  function getLabelTexture(text) {
    if (labelCache.has(text)) return labelCache.get(text);
    const size = 64;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    ctx.clearRect(0,0,size,size);

    // rounded bg
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    const r = 10;
    ctx.beginPath();
    ctx.moveTo(r,0); ctx.lineTo(size-r,0); ctx.quadraticCurveTo(size,0,size,r);
    ctx.lineTo(size,size-r); ctx.quadraticCurveTo(size,size,size-r,size);
    ctx.lineTo(r,size); ctx.quadraticCurveTo(0,size,0,size-r);
    ctx.lineTo(0,r); ctx.quadraticCurveTo(0,0,r,0);
    ctx.closePath(); ctx.fill();

    // text
    ctx.fillStyle = "#e6e8ef";
    ctx.font = "bold 32px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, size/2, size/2);

    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    labelCache.set(text, tex);
    return tex;
  }
  function ensureSampleLabels(count) {
    while (sampleLabels.length < count) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: getLabelTexture(String(sampleLabels.length)),
        depthTest: true,
        transparent: true
      }));
      sprite.scale.set(0.35, 0.35, 1);
      scene.add(sprite);
      sampleLabels.push(sprite);
    }
    while (sampleLabels.length > count) {
      const s = sampleLabels.pop();
      scene.remove(s);
      s.material.map?.dispose();
      s.material.dispose();
    }
  }

  // ===== Control & sample mesh sync =====
  function ensureCtrlMeshes() {
    while (ctrlSpheres.length < points.length) {
      const m = new THREE.Mesh(ctrlGeom, ctrlMat);
      m.userData.kind = "ctrl"; m.userData.i = ctrlSpheres.length;
      scene.add(m); ctrlSpheres.push(m);
    }
    while (ctrlSpheres.length > points.length) {
      const m = ctrlSpheres.pop(); scene.remove(m); m.geometry.dispose();
    }
  }
  function syncCtrlMeshes() {
    ensureCtrlMeshes();
    ctrlSpheres.forEach((m, i) => {
      m.position.copy(points[i]);
      m.material = (i === selectedCtrl) ? ctrlMatSel : ctrlMat;
      m.visible = true;
    });
  }
  function getSamples() { return Ts.map((t, i) => { const p = paramToPoint(t); return { i, x: p.x, y: p.y }; }); }
  function syncSampleMeshes(samples) {
    // spheres
    while (sampleSpheres.length < samples.length) {
      const m = new THREE.Mesh(smplGeom, smplMat);
      m.userData.kind = "sample"; m.userData.i = sampleSpheres.length;
      scene.add(m); sampleSpheres.push(m);
    }
    while (sampleSpheres.length > samples.length) {
      const m = sampleSpheres.pop(); scene.remove(m); m.geometry.dispose();
    }
    // labels
    ensureSampleLabels(samples.length);

    // positions & visibility
    sampleSpheres.forEach((m, i) => {
      const s = samples[i];
      m.position.set(s.x, s.y, 0);
      m.material = (i === selectedSample) ? smplMatSel : smplMat;
      m.userData.i = i;
      m.visible = !!showSamples;

      const lab = sampleLabels[i];
      lab.material.map = getLabelTexture(String(i));
      lab.material.needsUpdate = true;
      lab.visible = !!showSamples;
      lab.position.set(s.x + 0.16, s.y + 0.16, 0.02);
    });
  }

  // ===== Optimizer (jerk + limits) =====
  const OPT = Object.assign({
    steps: [0.05, 0.02, 0.01, 0.005, 0.002],
    maxPassesPerStep: 8,
    monotonicEps: 1e-4,
    wJerk: 1.0, wVel: 0.10, wAcc: 0.10,
    vMaxKmh: 120, aLongMax: 3.0, aLatMax: 3.0
  }, optimizer || {});

  function totalCost(Tarr) {
    const P = Tarr.map(t => { const p = paramToPoint(t); return [p.x, p.y]; });

    // jerk (discrete 3rd diff)
    let jerk = 0;
    for (let i = 0; i <= P.length - 4; i++) {
      const jx = (P[i + 3][0] - 3 * P[i + 2][0] + 3 * P[i + 1][0] - P[i][0]);
      const jy = (P[i + 3][1] - 3 * P[i + 2][1] + 3 * P[i + 1][1] - P[i][1]);
      jerk += jx * jx + jy * jy;
    }

    const dt2 = dt * dt;
    const v_ms = d3.range(P.length - 1).map(i => {
      const dx = (P[i + 1][0] - P[i][0]) / dt, dy = (P[i + 1][1] - P[i][1]) / dt; return Math.hypot(dx, dy);
    });
    const v_kmh = v_ms.map(v => v * 3.6);

    const a = d3.range(P.length - 2).map(i => {
      const ax = (P[i + 2][0] - 2 * P[i + 1][0] + P[i][0]) / dt2;
      const ay = (P[i + 2][1] - 2 * P[i + 1][1] + P[i][1]) / dt2;
      return [ax, ay];
    });
    const tHat = d3.range(P.length - 2).map(i => {
      const tx = P[i + 2][0] - P[i][0], ty = P[i + 2][1] - P[i][1]; const n = Math.hypot(tx, ty) || 1; return [tx / n, ty / n];
    });
    const aLong = a.map(([ax, ay], i) => ax * tHat[i][0] + ay * tHat[i][1]);
    const aLat = a.map(([ax, ay], i) => {
      const al = aLong[i];
      const axp = ax - al * tHat[i][0], ayp = ay - al * tHat[i][1];
      const mag = Math.hypot(axp, ayp);
      const sign = Math.sign(tHat[i][0] * ay - tHat[i][1] * ax) || 1;
      return sign * mag;
    });

    let penV = 0; for (const v of v_kmh) { const d = v - OPT.vMaxKmh; if (d > 0) penV += d * d; }
    let penA = 0;
    for (const al of aLong) { const d = Math.abs(al) - OPT.aLongMax; if (d > 0) penA += d * d; }
    for (const at of aLat)  { const d = Math.abs(at) - OPT.aLatMax;  if (d > 0) penA += d * d; }

    return OPT.wJerk * jerk + OPT.wVel * penV + OPT.wAcc * penA;
  }

  function optimizeTs() {
    if (densePts.length < 2) {
      console.warn("[optimizeTs] Not enough sample points to optimize (need ≥2).");
      return;
    }
  
    const eps = OPT.monotonicEps;
    const T = Ts.slice(); 
    T[0] = 0; 
    T[N - 1] = 1;
    let best = totalCost(T);
  
    console.groupCollapsed("%c[optimizeTs] Optimization started", "color:#6cf");
    console.log("Initial cost:", best.toFixed(6));
    console.log("Steps:", OPT.steps);
    console.log("Max passes/step:", OPT.maxPassesPerStep);
  
    let totalPasses = 0;
    let anyImprovement = false;
  
    for (const h0 of OPT.steps) {
      let improved = true;
      let passes = 0;
      console.groupCollapsed(`Step size h0=${h0}`);
      while (improved && passes < OPT.maxPassesPerStep) {
        improved = false;
        passes++;
        totalPasses++;
  
        for (let j = 1; j < N - 1; j++) {
          const L = T[j - 1] + eps, R = T[j + 1] - eps;
          let tj = Math.min(R, Math.max(L, T[j]));
          let bestLocal = best, bestTj = tj;
  
          for (const dir of [-1, +1]) {
            const cand = Math.min(R, Math.max(L, tj + dir * h0));
            if (Math.abs(cand - tj) < 1e-12) continue;
            const old = T[j]; 
            T[j] = cand; 
            const c = totalCost(T); 
            T[j] = old;
            if (c + 1e-12 < bestLocal) { 
              bestLocal = c; 
              bestTj = cand; 
            }
          }
  
          if (bestTj !== tj) { 
            T[j] = bestTj; 
            best = bestLocal; 
            improved = true; 
            anyImprovement = true;
          }
        }
  
        if (!improved) {
          console.log(`↳ Step ${h0}: converged after ${passes} passes (no further improvement).`);
          break;
        }
        if (passes >= OPT.maxPassesPerStep) {
          console.warn(`↳ Step ${h0}: reached max passes (${OPT.maxPassesPerStep}) before convergence.`);
        }
      }
      console.groupEnd();
    }
  
    if (!anyImprovement) {
      console.info("[optimizeTs] Terminated: no improvement across all steps.");
    } else {
      console.info("[optimizeTs] Optimization complete.");
    }
    console.log("Final cost:", best.toFixed(6));
    console.log("Total passes:", totalPasses);
    console.groupEnd();
  
    Ts = T;
    updateSamplesAndCharts();
  }

  // ===== Redraw plumbing =====
  function updateSamplesAndCharts() {
    const samples = getSamples();
    syncSampleMeshes(samples);
    onSamplesChanged(samples);
    requestRender();
  }
  function rebuildEverything() {
    rebuildDensePolyline();
    rebuildCurveObject();      // tube in both modes
    syncCtrlMeshes();
    updateSamplesAndCharts();
  }

  // ===== Picking & interactions =====
  const raycaster = new THREE.Raycaster();
  const planeZ0 = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

  function canvasRect() {
    const r = canvasEl.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }
  function screenToGround(clientX, clientY) {
    const cam = getCamera(); if (!cam) return new THREE.Vector3();
    const rect = canvasRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera({ x, y }, cam);
    const p = new THREE.Vector3(); raycaster.ray.intersectPlane(planeZ0, p);
    return p;
  }
  function pickNearestVec(arr, p, r) {
    let best = -1, d2min = r * r;
    for (let i = 0; i < arr.length; i++) {
      const a = arr[i]; const dx = a.x - p.x, dy = a.y - p.y; const d2 = dx * dx + dy * dy;
      if (d2 <= d2min) { d2min = d2; best = i; }
    }
    return best;
  }

  let dragging = null; // {kind:"ctrl"|"sample", i}
  function setCursor(c) {
    if (c) { canvasEl.style.cursor = c; return; }
    canvasEl.style.cursor = is2D() ? "crosshair" : "";
  }

  // Hover → pointer cursor near points
  canvasEl.addEventListener("pointermove", (e) => {
    if (dragging) return;
    const p = screenToGround(e.clientX, e.clientY);
    const samples = getSamples();
    const hitCtrl = pickNearestVec(points, p, CTRL_RADIUS * 2.0);
    const hitSample = showSamples ? pickNearestVec(samples.map(s => new THREE.Vector3(s.x, s.y, 0)), p, SAMPLE_RADIUS * 2.0) : -1;
    setCursor((hitCtrl >= 0 || hitSample >= 0) ? "pointer" : null);
  });

  // Down → start drag or add point (2D)
  canvasEl.addEventListener("pointerdown", (e) => {
    if (e.button === 2) return; // right button used by OrbitControls to pan
    const p = screenToGround(e.clientX, e.clientY);
    const samples = getSamples();
    const hitCtrl = pickNearestVec(points, p, CTRL_RADIUS * 2.0);
    const hitSample = showSamples ? pickNearestVec(samples.map(s => new THREE.Vector3(s.x, s.y, 0)), p, SAMPLE_RADIUS * 2.0) : -1;

    if (hitCtrl >= 0) {
      selectedCtrl = hitCtrl; selectedSample = null;
      dragging = { kind: "ctrl", i: hitCtrl };
      setControlsEnabled(false);
      setCursor("grabbing");
      syncCtrlMeshes(); requestRender();
    } else if (hitSample >= 0) {
      selectedSample = hitSample; selectedCtrl = null;
      dragging = { kind: "sample", i: hitSample };
      setControlsEnabled(false);
      setCursor("grabbing");
      syncSampleMeshes(samples); requestRender();
    } else {
      // 2D left click adds a control point
      if (is2D() && e.button === 0) {
        const v = new THREE.Vector3(p.x, p.y, 0);
        if (selectedCtrl != null) { points.splice(selectedCtrl + 1, 0, v); selectedCtrl = selectedCtrl + 1; }
        else { points.push(v); selectedCtrl = points.length - 1; }
        rebuildEverything();
        setCursor(null);
      }
      dragging = null;
    }
  });

  // Move → drag
  window.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const p = screenToGround(e.clientX, e.clientY);
    if (dragging.kind === "ctrl") {
      points[dragging.i].set(p.x, p.y, 0);
      rebuildEverything();
    } else {
      const i = dragging.i, eps = OPT.monotonicEps ?? 1e-4;
      const left = i > 0 ? Ts[i - 1] + eps : 0;
      const right = i < N - 1 ? Ts[i + 1] - eps : 1;
      Ts[i] = Math.min(right, Math.max(left, projectPointToParam(p)));
      selectedSample = i;
      updateSamplesAndCharts();
    }
  });

  // Up → end drag
  window.addEventListener("pointerup", () => {
    if (!dragging) return;
    dragging = null;
    setControlsEnabled(true);
    setCursor(null);
  });

  // ===== Public helpers =====
  function addAfterSelected() {
    const i = (selectedCtrl ?? 0);
    const base = points[i];
    const next = points[i + 1] || base.clone().add(new THREE.Vector3(0.5, 0, 0));
    const p = base.clone().lerp(next, 0.5);
    points.splice(i + 1, 0, p);
    selectedCtrl = i + 1;
    rebuildEverything();
  }
  function deleteSelectedCtrl() {
    if (selectedCtrl == null) return;
    if (points.length <= 2) return;
    points.splice(selectedCtrl, 1);
    if (selectedCtrl >= points.length) selectedCtrl = points.length - 1;
    rebuildEverything();
  }

  // ===== Init =====
  rebuildEverything();

  function getControlPoints() {
    // Nx2 in meters (x,y)
    return points.map(p => [p.x, p.y]);
  }
  function getOptimizerWeights() {
    const {
      wJerk, wVel, wAcc,
      vMaxKmh, aLongMax, aLatMax,
      steps, maxPassesPerStep, monotonicEps
    } = OPT;
    return { wJerk, wVel, wAcc, vMaxKmh, aLongMax, aLatMax, steps, maxPassesPerStep, monotonicEps };
  }

  return {
    setCurveType: (t) => { curveType = t; rebuildEverything(); },
    setAlpha: (a) => { alpha = a; if (curveType === "catmullrom") rebuildEverything(); },
    setShowSamples: (v) => { showSamples = v; updateSamplesAndCharts(); },
    getSamples: () => getSamples(),
    getControlPoints,                 // <-- add
    getOptimizerWeights,              // <-- add
    optimizeTs,
    onCloudLoaded: () => {},
    rebuildCurveObject: () => rebuildCurveObject(),
    addAfterSelected,
    deleteSelectedCtrl
  };
}
