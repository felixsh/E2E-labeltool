// src/charts.js
export function makeCharts({ velChartSel, accChartSel, jerkChartSel, chartsDiv, dt, d3 }) {
  chartsDiv?.classList?.add("hidden");

  function computeKinematics(samplePts){
    if (!samplePts || samplePts.length < 2) {
      return { iVel: [], v_kmh: [], iAcc: [], aLong: [], aLat: [], aTotal: [], iJerk: [], jerkTotal: [] };
    }
    const sorted = samplePts.slice().sort((a, b) => a.idx - b.idx);
    const dedup = [];
    const idx = [];
    const EPS = 1e-9;
    for (const p of sorted) {
      if (!dedup.length || Math.abs(p.x - dedup[dedup.length - 1][0]) > EPS || Math.abs(p.y - dedup[dedup.length - 1][1]) > EPS) {
        dedup.push([p.x, p.y]);
        idx.push(p.idx);
      }
    }
    if (dedup.length < 2) {
      return { iVel: [], v_kmh: [], iAcc: [], aLong: [], aLat: [], aTotal: [], iJerk: [], jerkTotal: [] };
    }
    const pos = dedup;

    const v_ms = [];
    const v_kmh = [];
    const iVel = [];
    for (let i = 0; i < pos.length - 1; i++) {
      const dx = (pos[i + 1][0] - pos[i][0]) / dt;
      const dy = (pos[i + 1][1] - pos[i][1]) / dt;
      const vel = Math.hypot(dx, dy);
      v_ms.push(vel);
      v_kmh.push(vel * 3.6);
      iVel.push((idx[i] + idx[i + 1]) / 2);
    }

    const a = [];
    const tHat = [];
    for (let i = 0; i < pos.length - 2; i++) {
      const ax = (pos[i + 2][0] - 2 * pos[i + 1][0] + pos[i][0]) / (dt * dt);
      const ay = (pos[i + 2][1] - 2 * pos[i + 1][1] + pos[i][1]) / (dt * dt);
      a.push([ax, ay]);
      const tx = pos[i + 2][0] - pos[i][0];
      const ty = pos[i + 2][1] - pos[i][1];
      const n = Math.hypot(tx, ty) || 1;
      tHat.push([tx / n, ty / n]);
    }
    const aLong = a.map(([ax, ay], i) => ax * tHat[i][0] + ay * tHat[i][1]);
    const aLat = a.map(([ax, ay], i) => {
      const along = aLong[i];
      const axp = ax - along * tHat[i][0];
      const ayp = ay - along * tHat[i][1];
      const mag = Math.hypot(axp, ayp);
      const sign = Math.sign(tHat[i][0] * ay - tHat[i][1] * ax) || 1;
      return sign * mag;
    });
    const iAcc = a.map((_, i) => idx[i + 1]);
    const aTotal = aLong.map((ax, i) => Math.hypot(ax, aLat[i]));

    const iJerk = [];
    const jerkTotal = [];
    for (let i = 0; i < aLong.length - 1; i++) {
      const jLong = (aLong[i + 1] - aLong[i]) / dt;
      const jLat = (aLat[i + 1] - aLat[i]) / dt;
      iJerk.push((iAcc[i] + iAcc[i + 1]) / 2);
      jerkTotal.push(Math.hypot(jLong, jLat));
    }

    return { iVel, v_kmh, iAcc, aLong, aLat, aTotal, iJerk, jerkTotal };
  }

  function drawMiniChart(svgSel, X, Y, title, opts = { absMax: false, units: "" }) {
    const node = svgSel.node();
    const w = node.clientWidth || 220;
    const h = node.clientHeight || 100;
    svgSel.attr("viewBox", `0 0 ${w} ${h}`); svgSel.selectAll("*").remove();

    const margin = { top: 20, right: 12, bottom: 26, left: 44 };
    const innerWidth = w - margin.left - margin.right;
    const innerHeight = h - margin.top - margin.bottom;
    svgSel.append("text")
      .attr("x", margin.left)
      .attr("y", margin.top - 6)
      .text(title)
      .attr("fill", "#cfd3dc")
      .attr("font-size", 12);
    if (innerWidth <= 0 || innerHeight <= 0) return;
    if (X.length < 2) return;

    const xy = X.map((x, i) => [x, Y[i]]).filter(d => Number.isFinite(d[1]));
    if (xy.length < 2) return;

    const xMin = d3.min(xy, d => d[0]), xMax = d3.max(xy, d => d[0]);
    let yMin = d3.min(xy, d => d[1]);
    let yMax = d3.max(xy, d => d[1]);
    const pad = (yMax - yMin) * 0.15 || 1;
    yMin -= pad; yMax += pad;

    const left = margin.left;
    const right = w - margin.right;
    const bottom = h - margin.bottom;
    const x = d3.scaleLinear().domain([xMin, xMax]).range([left, right]);
    const y = d3.scaleLinear().domain([yMin, yMax]).range([bottom, margin.top]);

    const maxAbs = Math.max(Math.abs(yMin), Math.abs(yMax)) || 1;
    const fmt = maxAbs >= 100 ? d3.format(".0f") : (maxAbs >= 10 ? d3.format(".1f") : d3.format(".2f"));
    const yTicks = y.ticks(4);
    yTicks.forEach(t => {
      const yt = y(t);
      if (!Number.isFinite(yt)) return;
      svgSel.append("line")
        .attr("x1", left)
        .attr("x2", right)
        .attr("y1", yt)
        .attr("y2", yt)
        .attr("stroke", t === 0 ? "#3b4153" : "#2b3244")
        .attr("stroke-width", t === 0 ? 1 : 0.6)
        .attr("opacity", t === 0 ? 1 : 0.6);
      svgSel.append("line")
        .attr("x1", left - 6)
        .attr("x2", left)
        .attr("y1", yt)
        .attr("y2", yt)
        .attr("stroke", "#3b4153")
        .attr("stroke-width", 0.8);
      svgSel.append("text")
        .attr("x", left - 8)
        .attr("y", yt + 4)
        .attr("text-anchor", "end")
        .attr("fill", "#cfd3dc")
        .attr("font-size", 10)
        .text(fmt(t));
    });

    svgSel.append("path").attr("d", d3.line().x(d => x(d[0])).y(d => y(d[1]))(xy))
      .attr("fill", "none").attr("stroke", "#9fb3ff").attr("stroke-width", 1.5);

    const iStart = Math.ceil(xMin - 1e-9), iEnd = Math.floor(xMax + 1e-9);
    for (let i = iStart; i <= iEnd; i++) {
      const xi = x(i);
      svgSel.append("line").attr("x1", xi).attr("x2", xi).attr("y1", bottom).attr("y2", bottom + 4).attr("stroke", "#3b4153");
      svgSel.append("text").attr("x", xi).attr("y", bottom + 16).attr("text-anchor", "middle").attr("fill", "#cfd3dc").attr("font-size", 10).text(i);
    }

    const vals = xy.map(d => opts.absMax ? Math.abs(d[1]) : d[1]); let k = 0, v = -Infinity;
    for (let i = 0; i < vals.length; i++) if (vals[i] > v) { v = vals[i]; k = i; }
    const xmax = xy[k][0], ymaxv = xy[k][1];
    svgSel.append("circle").attr("cx", x(xmax)).attr("cy", y(ymaxv)).attr("r", 3).attr("fill", "#cfd3dc");
    svgSel.append("text").attr("x", right).attr("y", margin.top - 6).attr("text-anchor", "end").attr("fill", "#cfd3dc").attr("font-size", 12)
      .text(`max ${(opts.absMax ? Math.abs(ymaxv) : ymaxv).toFixed(2)}${opts.units ? ` ${opts.units}` : ""}`);
  }

  function render(samples){
    if (!samples || !samples.length){
      chartsDiv?.classList?.add("hidden");
      velChartSel.selectAll("*").remove();
      accChartSel.selectAll("*").remove();
      jerkChartSel.selectAll("*").remove();
      return;
    }
    chartsDiv?.classList?.remove("hidden");
    const { iVel, v_kmh, iAcc, aTotal, iJerk, jerkTotal } = computeKinematics(samples);
    drawMiniChart(velChartSel, iVel, v_kmh, "velocity (km/h)", { absMax: false, units: "km/h" });
    drawMiniChart(accChartSel, iAcc, aTotal, "acceleration total (m/s²)", { absMax: true, units: "m/s²" });
    drawMiniChart(jerkChartSel, iJerk, jerkTotal, "jerk total (m/s³)", { absMax: true, units: "m/s³" });
  }

  return { render };
}
