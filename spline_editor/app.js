(() => {
  // ==== CONFIG ====
  const CFG = window.SPLINE_CONFIG || {};
  const metersPerPixel = +CFG.metersPerPixel > 0 ? +CFG.metersPerPixel : 0.05;
  let curveType = (CFG.defaultCurve === "catmullrom" || CFG.defaultCurve === "natural" || CFG.defaultCurve === "basis")
    ? CFG.defaultCurve : "basis";
  let dt = +CFG.defaultDt > 0 ? +CFG.defaultDt : 0.20;

  const OPT = Object.assign({
    steps: [0.05, 0.02, 0.01, 0.005, 0.002],
    maxPassesPerStep: 8,
    monotonicEps: 1e-4,
    wJerk: 1.0, wVel: 0.10, wAcc: 0.10,
    vMaxKmh: 120, aLongMax: 3.0, aLatMax: 3.0
  }, CFG.optimizer || {});

  const CLIM = Object.assign({
    velocityKmh: null,
    accelMS2: null
  }, (CFG.chartLimits || {}));

  const CTRL = Object.assign({
    moveStepPx: 1,
    moveStepPxFast: 5,
    sampleStepT: 0.01,
    sampleStepTFast: 0.05
  }, CFG.controls || {});

  // ==== SVG + groups ====
  const svg = d3.select("#svg");
  const g = svg.append("g");
  const ctrl = g.append("path").attr("class","ctrl-poly");
  const path = g.append("path").attr("class","spline");
  const gSamples = g.append("g").attr("class","samples");

  // Panels
  const chartsDiv = document.getElementById("charts");
  const weightsDiv = document.getElementById("weights"); // may not exist if you didn't add sliders
  const velChart = d3.select("#velChart");
  const accLongChart = d3.select("#accLongChart");
  const accLatChart = d3.select("#accLatChart");

  // Gradient
  const defs = svg.append("defs");
  const grad = defs.append("linearGradient").attr("id","grad").attr("x1","0%").attr("x2","100%").attr("y1","0%").attr("y2","0%");
  grad.append("stop").attr("offset","0%").attr("stop-color","#6fd3ff");
  grad.append("stop").attr("offset","100%").attr("stop-color","#b993ff");

  // ==== State ====
  let points = [];
  let selectedCtrl = null;     // index of selected control point (or null)
  let selectedSample = null;   // index of selected sample point (or null)
  let alpha = 0.5;
  const N_SAMPLES = +CFG.numSamples > 2 ? +CFG.numSamples : 16;
  let Ts = d3.range(N_SAMPLES).map(i => i / (N_SAMPLES - 1));
  let showSamples = true;
  let showWeights = false; // hidden by default

  // ==== Seed & resize ====
  function seed() {
    const {width, height} = svg.node().getBoundingClientRect();
    const cx = width * 0.5, cy = height * 0.5, r = Math.min(width, height) * 0.22;
    points = [
      [cx - r, cy + r * 0.3],
      [cx,     cy - r * 0.8],
      [cx + r, cy + r * 0.3],
    ];
    selectedCtrl = points.length - 1;  // default: last control point selected
    selectedSample = null;
  }
  function resize() {
    const bbox = svg.node().getBoundingClientRect();
    svg.attr("viewBox", `0 0 ${bbox.width} ${bbox.height}`);
    redraw();
  }
  new ResizeObserver(resize).observe(svg.node());

  // ==== Curve factory ====
  function makeCurve() {
    if (curveType === "basis")   return d3.curveBasis;
    if (curveType === "natural") return d3.curveNatural;
    return d3.curveCatmullRom.alpha(alpha);
  }
  const lineCtrl = d3.line().x(d=>d[0]).y(d=>d[1]);
  const makeLine  = () => d3.line().curve(makeCurve()).x(d=>d[0]).y(d=>d[1]);

  // ==== Helpers ====
  function projectToPath(px, py) {
    const node = path.node();
    const L = node.getTotalLength();
    let bestS = 0, bestD2 = Infinity;
    const STEPS = 100;
    for (let i=0;i<=STEPS;i++) {
      const s = (i/STEPS)*L;
      const p = node.getPointAtLength(s);
      const d2 = (p.x-px)*(p.x-px) + (p.y-py)*(p.y-py);
      if (d2 < bestD2) { bestD2 = d2; bestS = s; }
    }
    let left = Math.max(0,bestS - L/STEPS), right = Math.min(L,bestS + L/STEPS);
    for (let k=0;k<20;k++) {
      const s1 = left + (right-left)/3, s2 = right - (right-left)/3;
      const p1 = node.getPointAtLength(s1), p2 = node.getPointAtLength(s2);
      const d1 = (p1.x-px)**2 + (p1.y-py)**2, d2 = (p2.x-px)**2 + (p2.y-py)**2;
      if (d1 < d2) right = s2; else left = s1;
    }
    return (left+right)/2;
  }
  function getSamples() {
    const node = path.node();
    const L = node.getTotalLength();
    return Ts.map((t,i) => {
      const p = node.getPointAtLength(Math.max(0, Math.min(L, t*L)));
      return { i, x: p.x, y: p.y };
    });
  }
  function updatePanelsVisibility() {
  if (weightsDiv) {
    weightsDiv.style.display = (showSamples && showWeights) ? "" : "none";
  }
  if (chartsDiv) {
    chartsDiv.style.display = showSamples ? "" : "none";
  }
}


  // Kinematics (meters + units)
  function computeKinematics(samplePts) {
    const N = samplePts.length;
    const pos = samplePts.map(p => [p.x * metersPerPixel, p.y * metersPerPixel]);
    const v_ms = d3.range(N-1).map(i => {
      const dx = (pos[i+1][0] - pos[i][0]) / dt;
      const dy = (pos[i+1][1] - pos[i][1]) / dt;
      return Math.hypot(dx, dy);
    });
    const v_kmh = v_ms.map(v => v * 3.6);
    const iVel = d3.range(N-1).map(i => i + 0.5);

    const a = d3.range(N-2).map(i => {
      const ax = (pos[i+2][0] - 2*pos[i+1][0] + pos[i][0]) / (dt*dt);
      const ay = (pos[i+2][1] - 2*pos[i+1][1] + pos[i][1]) / (dt*dt);
      return [ax, ay];
    });
    const tHat = d3.range(N-2).map(i => {
      const tx = pos[i+2][0] - pos[i][0];
      const ty = pos[i+2][1] - pos[i][1];
      const n = Math.hypot(tx,ty) || 1;
      return [tx/n, ty/n];
    });
    const aLong = a.map(([ax,ay],i) => ax*tHat[i][0] + ay*tHat[i][1]);
    const aLat  = a.map(([ax,ay],i) => {
      const along = aLong[i];
      const axp = ax - along*tHat[i][0];
      const ayp = ay - along*tHat[i][1];
      const mag = Math.hypot(axp, ayp);
      const sign = Math.sign(tHat[i][0]*ay - tHat[i][1]*ax) || 1;
      return sign * mag;
    });
    const iAcc = d3.range(N-2).map(i => i + 1);

    return { iVel, v_kmh, iAcc, aLong, aLat };
  }

  // ==== Optimizer (unchanged from last version, uses OPT) ====
  function totalCost(Tarr) {
    const node = path.node();
    const L = node.getTotalLength();
    const P = Tarr.map(t => {
      const p = node.getPointAtLength(Math.max(0, Math.min(L, t*L)));
      return [p.x * metersPerPixel, p.y * metersPerPixel];
    });

    let jerkSum = 0;
    for (let i=0; i<=P.length-4; i++) {
      const jx = (P[i+3][0] - 3*P[i+2][0] + 3*P[i+1][0] - P[i][0]);
      const jy = (P[i+3][1] - 3*P[i+2][1] + 3*P[i+1][1] - P[i][1]);
      jerkSum += jx*jx + jy*jy;
    }

    const N = Tarr.length;
    const v_ms = d3.range(N-1).map(i => {
      const dx = (P[i+1][0] - P[i][0]) / dt;
      const dy = (P[i+1][1] - P[i][1]) / dt;
      return Math.hypot(dx, dy);
    });
    const v_kmh = v_ms.map(v => v * 3.6);

    const a = d3.range(N-2).map(i => {
      const ax = (P[i+2][0] - 2*P[i+1][0] + P[i][0]) / (dt*dt);
      const ay = (P[i+2][1] - 2*P[i+1][1] + P[i][1]) / (dt*dt);
      return [ax, ay];
    });
    const tHat = d3.range(N-2).map(i => {
      const tx = P[i+2][0] - P[i][0];
      const ty = P[i+2][1] - P[i][1];
      const n = Math.hypot(tx,ty) || 1;
      return [tx/n, ty/n];
    });
    const aLong = a.map(([ax,ay],i) => ax*tHat[i][0] + ay*tHat[i][1]);
    const aLat  = a.map(([ax,ay],i) => {
      const along = aLong[i];
      const axp = ax - along*tHat[i][0];
      const ayp = ay - along*tHat[i][1];
      const mag = Math.hypot(axp, ayp);
      const sign = Math.sign(tHat[i][0]*ay - tHat[i][1]*ax) || 1;
      return sign * mag;
    });

    let penV = 0;
    for (const v of v_kmh) { const d = v - OPT.vMaxKmh; if (d > 0) penV += d*d; }
    let penA = 0;
    for (const al of aLong) { const d = Math.abs(al) - OPT.aLongMax; if (d > 0) penA += d*d; }
    for (const at of aLat)  { const d = Math.abs(at)  - OPT.aLatMax;  if (d > 0) penA += d*d; }

    return OPT.wJerk * jerkSum + OPT.wVel * penV + OPT.wAcc * penA;
  }
  function optimizeTs() {
    if (!path.node()) return;
    const eps = OPT.monotonicEps;
    const T = Ts.slice();
    T[0] = 0; T[N_SAMPLES-1] = 1;
    let best = totalCost(T);

    for (const h0 of OPT.steps) {
      let improved = true, passes = 0;
      while (improved && passes < OPT.maxPassesPerStep) {
        improved = false; passes++;
        for (let j=1; j<N_SAMPLES-1; j++) {
          const left  = T[j-1] + eps;
          const right = T[j+1] - eps;
          let tj = Math.min(right, Math.max(left, T[j]));
          let bestLocal = best, bestTj = tj;

          for (const dir of [-1, +1]) {
            const cand = Math.min(right, Math.max(left, tj + dir*h0));
            if (Math.abs(cand - tj) < 1e-9) continue;
            const old = T[j]; T[j] = cand;
            const c = totalCost(T);
            if (c + 1e-12 < bestLocal) { bestLocal = c; bestTj = cand; }
            T[j] = old;
          }

          if (bestTj !== tj) { T[j] = bestTj; best = bestLocal; improved = true; }
        }
      }
    }
    Ts = T;
    redraw();
  }

  // ==== Mini chart ====
  function drawMiniChart(svgSel, dataX, dataY, title, opts={absMax:false, units:"", yLimit:null}) {
    const svgNode = svgSel.node();
    const w = svgNode.clientWidth || 220;
    const h = svgNode.clientHeight || 100;
    svgSel.attr("viewBox", `0 0 ${w} ${h}`);
    const xy = dataX.map((x,i)=>[x, dataY[i]]).filter(d=>Number.isFinite(d[1]));

    svgSel.selectAll("*").remove();
    svgSel.append("text").attr("class","chart-title").attr("x",8).attr("y",14).text(title);
    if (xy.length < 2) return;

    const xMin = d3.min(xy, d=>d[0]), xMax = d3.max(xy, d=>d[0]);
    let yMin = d3.min(xy, d=>d[1]),   yMax = d3.max(xy, d=>d[1]);
    if (opts.yLimit && Number.isFinite(opts.yLimit)) {
      if (title.startsWith("velocity")) { yMin = 0; yMax = opts.yLimit; }
      else { yMin = -opts.yLimit; yMax = opts.yLimit; }
    } else {
      const yPad = (yMax - yMin) * 0.15 || 1;
      yMin -= yPad; yMax += yPad;
    }

    const x = d3.scaleLinear().domain([xMin, xMax]).range([8, w-8]);
    const y = d3.scaleLinear().domain([yMin, yMax]).range([h-18, 8]);

    if (y.domain()[0] < 0 && y.domain()[1] > 0) {
      svgSel.append("line").attr("class","chart-zero")
        .attr("x1",x(xMin)).attr("x2",x(xMax)).attr("y1",y(0)).attr("y2",y(0));
    }

    const line = d3.line().x(d=>x(d[0])).y(d=>y(d[1]));
    svgSel.append("path").attr("class","chart-path").attr("d", line(xy));

    const gTicks = svgSel.append("g").attr("pointer-events","none");
    const iStart = Math.ceil(xMin - 1e-9);
    const iEnd   = Math.floor(xMax + 1e-9);
    for (let i=iStart; i<=iEnd; i++) {
      const xi = x(i);
      gTicks.append("line").attr("x1",xi).attr("x2",xi).attr("y1",h-18).attr("y2",h-14)
        .attr("class","chart-zero");
      gTicks.append("text").attr("class","chart-title").attr("x",xi).attr("y",h-2)
        .attr("text-anchor","middle").text(i);
    }

    const vals = xy.map(d => opts.absMax ? Math.abs(d[1]) : d[1]);
    let k = 0, vmax = -Infinity;
    for (let i=0;i<vals.length;i++) if (vals[i] > vmax) { vmax = vals[i]; k = i; }
    const xmax = xy[k][0], ymaxv = xy[k][1];
    svgSel.append("circle").attr("cx", x(xmax)).attr("cy", y(ymaxv)).attr("r", 3).attr("fill", "#cfd3dc");
    const label = (opts.absMax ? Math.abs(ymaxv) : ymaxv).toFixed(2) + (opts.units ? ` ${opts.units}` : "");
    svgSel.append("text").attr("class","chart-title").attr("x", w-8).attr("y",14)
      .attr("text-anchor","end").text(`max ${label}`);
  }

  // ===== RENDER STEPS =====
  function renderGeometry() {
    ctrl.attr("d", lineCtrl(points));
    path.attr("d", makeLine()(points));
  
    const handles = g.selectAll("circle.handle").data(points, (_, i) => i);
  
    const handlesEnter = handles.enter()
      .append("circle")
      .attr("class","handle")
      .attr("r",6)
      .on("pointerdown", (event, d) => {
        event.stopPropagation();
        const i = points.indexOf(d);
        if (selectedCtrl === i) {
            // toggle off
            selectedCtrl = null;
        } else {
            selectedCtrl = i;
            selectedSample = null;
        }
        renderGeometry();        // refresh classes
        renderSamples(false);    // keep current sample DOM, just classes
      })
      .on("mouseover", function(){ d3.select(this).classed("hover", true); })
      .on("mouseout",  function(){ d3.select(this).classed("hover", false); })
      .call(
        d3.drag()
          .on("start", function(event, d){
            d3.select(this).classed("dragging", true);
            selectedCtrl = points.indexOf(d);
            selectedSample = null;
            renderGeometry(); renderSamples(false);
          })
          .on("drag", function(event, d){
            d[0] = event.x; d[1] = event.y;
            renderGeometry(); renderSamples(false); renderCharts(getSamples());
          })
          .on("end", function(){
            d3.select(this).classed("dragging", false);
            redraw();
          })
      );
  
    const handlesAll = handlesEnter.merge(handles);
    handlesAll
      .attr("cx", d=>d[0]).attr("cy", d=>d[1])
      .classed("selected", (_, i) => i === selectedCtrl);
  
    handles.exit().remove();
  }


  function renderSamples(fullJoin = true) {
    gSamples.attr("display", showSamples ? null : "none");
    updatePanelsVisibility();
    if (!showSamples) return;

    const node = path.node();
    const L = node.getTotalLength();
    const data = Ts.map((t,i) => {
      const p = node.getPointAtLength(Math.max(0, Math.min(L, t*L)));
      return { i, t, x:p.x, y:p.y, L };
    });

    if (fullJoin) {
    const samplesSel = gSamples.selectAll("g.sample-g").data(data, d=>d.i);

    const samplesEnter = samplesSel.enter()
        .append("g")
        .attr("class","sample-g")
        .on("pointerdown", (event, d) => {
          event.stopPropagation();
          if (selectedSample === d.i) {
              // toggle off
              selectedSample = null;
          } else {
              selectedSample = d.i;
              selectedCtrl = null;
          }
          renderSamples(false);    // update selected styling
        })
        .on("mouseover", function(){ d3.select(this).select("circle.sample").classed("hover", true); })
        .on("mouseout",  function(){ d3.select(this).select("circle.sample").classed("hover", false); })
        .call(
        d3.drag()
            .on("start", function(){
            d3.select(this).select("circle.sample").classed("dragging", true);
            })
            .on("drag", function(event, d){
            const [px,py] = d3.pointer(event, svg.node());
            const s = projectToPath(px, py);
            const tNew = s / d.L;
            const eps = OPT.monotonicEps;
            const left  = d.i > 0 ? Ts[d.i-1] + eps : 0;
            const right = d.i < N_SAMPLES-1 ? Ts[d.i+1] - eps : 1;
            Ts[d.i] = Math.min(right, Math.max(left, tNew));
            selectedSample = d.i;

            const node = path.node();
            const Lnow = node.getTotalLength();
            const pNow = node.getPointAtLength(Ts[d.i] * Lnow);
            const gThis = d3.select(this);
            gThis.select("circle.sample").attr("cx", pNow.x).attr("cy", pNow.y);
            gThis.select("text.sample-label").attr("x", pNow.x).attr("y", pNow.y).text(d.i);
            renderCharts(getSamples());
            })
            .on("end", function(){
            d3.select(this).select("circle.sample").classed("dragging", false);
            redraw();
            })
        );

    samplesEnter.append("circle").attr("class","sample").attr("r",4);
    samplesEnter.append("text").attr("class","sample-label").attr("dy",-8).attr("text-anchor","middle");

    const samplesAll = samplesEnter.merge(samplesSel)
        .classed("selected", d => d.i === selectedSample);

    samplesAll.select("circle.sample").attr("cx", d=>d.x).attr("cy", d=>d.y);
    samplesAll.select("text.sample-label").attr("x", d=>d.x).attr("y", d=>d.y).text(d=>d.i);

    samplesSel.exit().remove();
    } else {
    const samplesAll = gSamples.selectAll("g.sample-g")
        .classed("selected", (_,i) => i === selectedSample);
    samplesAll.each(function(d,i){
        const sel = d3.select(this);
        const P = data[i];
        sel.select("circle.sample").attr("cx", P.x).attr("cy", P.y);
        sel.select("text.sample-label").attr("x", P.x).attr("y", P.y).text(P.i);
    });
    }
  }

  function renderCharts(samples) {
    if (!showSamples) return;
    const { iVel, v_kmh, iAcc, aLong, aLat } = computeKinematics(samples);
    drawMiniChart(velChart,     iVel, v_kmh, "velocity (km/h)",      {absMax:false, units:"km/h", yLimit: CLIM.velocityKmh});
    drawMiniChart(accLongChart, iAcc, aLong, "longitudinal a (m/s²)", {absMax:true,  units:"m/s²", yLimit: CLIM.accelMS2});
    drawMiniChart(accLatChart,  iAcc, aLat,  "lateral a (m/s²)",      {absMax:true,  units:"m/s²", yLimit: CLIM.accelMS2});
  }

  function redraw() {
    renderGeometry();
    renderSamples(true);
    renderCharts(getSamples());
  }

  // ==== Control-point interactions ====
  function dragStartCtrl(event, d) {
    selectedCtrl = points.indexOf(d);
    selectedSample = null;
    redraw();
  }
  function dragCtrl(event, d) {
    d[0] = event.x; d[1] = event.y;
    renderGeometry(); renderSamples(false); renderCharts(getSamples());
  }
  function dragEndCtrl() { redraw(); }

  // ==== SVG click: add after selected control point, else default add ====
  svg.on("click", function(event) {
    const tgt = event.target;
    if (tgt.closest && (tgt.closest(".sample-g") || tgt.closest("circle.handle"))) return;
    const tag = event.target.tagName.toLowerCase();
    if (tag === "circle" || tag === "text") return; // skip if clicking a point/label
    const p = d3.pointer(event, this);
    if (selectedCtrl != null) {
      // insert right after selected control point
      points.splice(selectedCtrl + 1, 0, p);
      selectedCtrl = selectedCtrl + 1;
    } else {
      // fallback: append
      points.push(p);
      selectedCtrl = points.length - 1;
      selectedSample = null;
    }
    redraw();
  });

  // ==== Add/Delete control points via toolbar (if present) ====
  function deleteSelectedCtrl() {
    if (selectedCtrl == null) return;
    if (points.length <= 2) return;
    points.splice(selectedCtrl, 1);
    if (selectedCtrl >= points.length) selectedCtrl = points.length - 1;
    redraw();
  }

  // ==== Keyboard ====
  window.addEventListener("keydown", e => {
    // ignore when typing in inputs
    if (["INPUT","TEXTAREA","SELECT"].includes(document.activeElement.tagName)) return;
    const key = e.key.toLowerCase();

    // Delete removes selected control point
    if ((key === "delete" || key === "backspace") && selectedCtrl != null) {
      e.preventDefault(); deleteSelectedCtrl(); return;
    }

    // Arrow keys
    if (["arrowleft","arrowright","arrowup","arrowdown"].includes(key)) {
      e.preventDefault();
      const fast = e.shiftKey;
      const stepPx = fast ? CTRL.moveStepPxFast : CTRL.moveStepPx;
      const stepT  = fast ? CTRL.sampleStepTFast : CTRL.sampleStepT;

      if (selectedCtrl != null) {
        // move control point in pixels
        const p = points[selectedCtrl];
        if (key==="arrowleft")  p[0]-=stepPx;
        if (key==="arrowright") p[0]+=stepPx;
        if (key==="arrowup")    p[1]-=stepPx;
        if (key==="arrowdown")  p[1]+=stepPx;
        redraw();
      } else if (selectedSample != null) {
        // slide sample along the spline (t domain)
        const i = selectedSample;
        const eps = OPT.monotonicEps;
        let t = Ts[i];
        if (key==="arrowup")   t += stepT;     // choose up = forward
        if (key==="arrowdown") t -= stepT;
        const left  = i > 0 ? Ts[i-1] + eps : 0;
        const right = i < N_SAMPLES-1 ? Ts[i+1] - eps : 1;
        Ts[i] = Math.min(right, Math.max(left, t));
        renderSamples(false); renderCharts(getSamples());
      }
      return;
    }

    // Other shortcuts (unchanged)
    if (key === "a") {
      const box = svg.node().getBoundingClientRect();
      const p = [box.width/2, box.height/2];
      if (selectedCtrl != null) {
        points.splice(selectedCtrl + 1, 0, p);
        selectedCtrl++;
      } else {
        points.push(p); selectedCtrl = points.length - 1; selectedSample = null;
      }
      redraw();
    }
    if (key === "d") { deleteSelectedCtrl(); }
    if (key === "s") { showSamples = !showSamples; if (document.getElementById("showSamplesChk")) document.getElementById("showSamplesChk").checked = showSamples; renderSamples(true); renderCharts(getSamples()); }
    if (key === "e") { exportSamples(); }

    // '?' opens/closes shortcuts
    if ((e.key === '?' ) || (e.key === '/' && e.shiftKey)) {
      e.preventDefault();
      if (shortcutsModal && shortcutsModal.classList.contains("hidden")) openShortcuts();
      else closeShortcuts();
      return;
    }

    // 'w' toggles Weights panel
    if (key === "w") {
      showWeights = !showWeights;
      if (showWeightsChk) showWeightsChk.checked = showWeights;
      updatePanelsVisibility();
      return;
    }
  });

  // ==== Toolbar hooks (if present) ====
  const alphaInput = document.getElementById("alpha");
  const alphaVal   = document.getElementById("alphaVal");
  const curveSel   = document.getElementById("curveType");
  const showSamplesChk = document.getElementById("showSamplesChk");
  const exportSamplesBtn = document.getElementById("exportSamplesBtn");
  const optimizeBtn = document.getElementById("optimizeBtn");

  const shortcutsBtn   = document.getElementById("shortcutsBtn");
const shortcutsModal = document.getElementById("shortcutsModal");
const shortcutsClose = document.getElementById("shortcutsClose");

function openShortcuts()  { shortcutsModal?.classList.remove("hidden"); }
function closeShortcuts() { shortcutsModal?.classList.add("hidden"); }

shortcutsBtn?.addEventListener("click", openShortcuts);
shortcutsClose?.addEventListener("click", closeShortcuts);
shortcutsModal?.addEventListener("click", (e) => {
  if (e.target === shortcutsModal) closeShortcuts(); // click backdrop to close
});

const showWeightsChk = document.getElementById("showWeightsChk");

if (showWeightsChk) {
  showWeightsChk.checked = showWeights; // default false, checkbox unchecked
  showWeightsChk.addEventListener("change", e => {
    showWeights = e.target.checked;
    updatePanelsVisibility();
  });
}

  function syncAlphaEnabled() {
    const enabled = (curveType === "catmullrom");
    if (alphaInput) alphaInput.disabled = !enabled; // CSS hides when disabled
  }
  if (curveSel) curveSel.value = curveType;
  syncAlphaEnabled();

  if (alphaInput) alphaInput.addEventListener("input", e => {
    alpha = +e.target.value; if (alphaVal) alphaVal.textContent = alpha.toFixed(2); redraw();
  });
  if (curveSel) curveSel.addEventListener("change", e => { curveType = e.target.value; syncAlphaEnabled(); redraw(); });
  if (showSamplesChk) showSamplesChk.addEventListener("change", e => { showSamples = e.target.checked; renderSamples(true); renderCharts(getSamples()); });
  if (optimizeBtn) optimizeBtn.addEventListener("click", optimizeTs);

function exportSamples() {
  const node = path.node();
  const L = node.getTotalLength();

  // N x 2 array in meters: [[x_m, y_m], ...]
  const samples = Ts.map(t => {
    const p = node.getPointAtLength(Math.max(0, Math.min(L, t * L)));
    return [p.x * metersPerPixel, p.y * metersPerPixel];
  });

  const blob = new Blob([JSON.stringify(samples)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "samples.json";
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}


  if (exportSamplesBtn) exportSamplesBtn.addEventListener("click", exportSamples);

  // Init
  seed(); resize();
})();
