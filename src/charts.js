// src/charts.js
const COLOR_GREEN = [46, 204, 113];
const COLOR_YELLOW = [246, 194, 62];
const COLOR_RED = [231, 76, 60];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mixColor(c1, c2, t) {
  return [
    lerp(c1[0], c2[0], t),
    lerp(c1[1], c2[1], t),
    lerp(c1[2], c2[2], t)
  ];
}

function colorForThreshold(value, thresholds) {
  if (!thresholds) return null;
  const { comfort, max } = thresholds;
  if (!Number.isFinite(value) || !Number.isFinite(comfort) || !Number.isFinite(max) || max <= comfort) {
    return null;
  }
  if (value <= comfort) return `rgb(${COLOR_GREEN.map(Math.round).join(",")})`;
  if (value >= max) return `rgb(${COLOR_RED.map(Math.round).join(",")})`;
  const ratio = (value - comfort) / (max - comfort);
  if (ratio <= 0.5) {
    const t = ratio / 0.5;
    const mixed = mixColor(COLOR_GREEN, COLOR_YELLOW, t);
    return `rgb(${mixed.map(Math.round).join(",")})`;
  }
  const t = (ratio - 0.5) / 0.5;
  const mixed = mixColor(COLOR_YELLOW, COLOR_RED, t);
  return `rgb(${mixed.map(Math.round).join(",")})`;
}

export function makeCharts({ velChartSel, accChartSel, jerkChartSel, chartsDiv, dt, d3, limits = {} }) {
  chartsDiv?.classList?.add("hidden");
  let lastSamples = null;
  let resizeRaf = null;

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

  function drawMiniChart(svgSel, X, Y, title, opts = { absMax: false, units: "", thresholds: null }) {
    const node = svgSel.node();
    const w = node.clientWidth || 220;
    const h = node.clientHeight || 100;
    svgSel.attr("viewBox", `0 0 ${w} ${h}`); svgSel.selectAll("*").remove();

    const sizeScale = Math.max(0.6, Math.min(1.3, Math.min(w / 320, h / 200)));
    const margin = {
      top: Math.round(34 * sizeScale),
      right: Math.round(14 * sizeScale),
      bottom: Math.round(30 * sizeScale),
      left: Math.round(46 * sizeScale)
    };
    const titleFont = Math.max(10, Math.round(12 * sizeScale));
    const axisFont = Math.max(8, Math.round(10 * sizeScale));
    const tickStroke = Math.max(0.6, 0.8 * sizeScale);
    const tickLength = Math.max(3, Math.round(4 * sizeScale));
    const innerWidth = w - margin.left - margin.right;
    const innerHeight = h - margin.top - margin.bottom;
    svgSel.append("text")
      .attr("x", margin.left)
      .attr("y", margin.top - Math.round(6 * sizeScale))
      .text(title)
      .attr("fill", "#cfd3dc")
      .attr("font-size", titleFont);
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
    const minYSpacing = axisFont * 1.6;
    let lastLabelY = -Infinity;
    yTicks.forEach((t, idx) => {
      const yt = y(t);
      if (!Number.isFinite(yt)) return;
      svgSel.append("line")
        .attr("x1", left)
        .attr("x2", right)
        .attr("y1", yt)
        .attr("y2", yt)
        .attr("stroke", t === 0 ? "#3b4153" : "#2b3244")
        .attr("stroke-width", t === 0 ? Math.max(1, tickStroke) : tickStroke)
        .attr("opacity", t === 0 ? 1 : 0.6);
      svgSel.append("line")
        .attr("x1", left - tickLength * 1.5)
        .attr("x2", left)
        .attr("y1", yt)
        .attr("y2", yt)
        .attr("stroke", "#3b4153")
        .attr("stroke-width", tickStroke);
      const isZero = Math.abs(t) < 1e-9;
      const needsLabel = idx === 0 || idx === yTicks.length - 1 || isZero || Math.abs(yt - lastLabelY) >= minYSpacing;
      if (needsLabel) {
        svgSel.append("text")
          .attr("x", left - Math.round(8 * sizeScale))
          .attr("y", yt + Math.round(4 * sizeScale))
          .attr("text-anchor", "end")
          .attr("fill", "#cfd3dc")
          .attr("font-size", axisFont)
          .text(fmt(t));
        lastLabelY = yt;
      }
    });

    svgSel.append("path").attr("d", d3.line().x(d => x(d[0])).y(d => y(d[1]))(xy))
      .attr("fill", "none").attr("stroke", "#9fb3ff").attr("stroke-width", 1.5);

    const iStart = Math.ceil(xMin - 1e-9), iEnd = Math.floor(xMax + 1e-9);
    const minXSpacing = Math.max(28, Math.round(32 * sizeScale));
    let lastLabelX = -Infinity;
    for (let i = iStart; i <= iEnd; i++) {
      const xi = x(i);
      svgSel.append("line")
        .attr("x1", xi)
        .attr("x2", xi)
        .attr("y1", bottom)
        .attr("y2", bottom + tickLength)
        .attr("stroke", "#3b4153")
        .attr("stroke-width", tickStroke);
      const needsLabel = (i === iStart || i === iEnd || i === 0 || xi - lastLabelX >= minXSpacing);
      if (needsLabel) {
        svgSel.append("text")
          .attr("x", xi)
          .attr("y", bottom + axisFont + Math.round(6 * sizeScale))
          .attr("text-anchor", "middle")
          .attr("fill", "#cfd3dc")
          .attr("font-size", axisFont)
          .text(i);
        lastLabelX = xi;
      }
    }

    const vals = xy.map(d => opts.absMax ? Math.abs(d[1]) : d[1]); let k = 0, v = -Infinity;
    for (let i = 0; i < vals.length; i++) if (vals[i] > v) { v = vals[i]; k = i; }
    const xmax = xy[k][0], ymaxv = xy[k][1];
    svgSel.append("circle").attr("cx", x(xmax)).attr("cy", y(ymaxv)).attr("r", Math.max(2.5, 3 * sizeScale)).attr("fill", "#cfd3dc");
    const maxValue = (opts.absMax ? Math.abs(ymaxv) : ymaxv);
    const label = `max ${maxValue.toFixed(2)}${opts.units ? ` ${opts.units}` : ""}`;
    const maxText = svgSel.append("text")
      .attr("x", right)
      .attr("y", margin.top - Math.round(6 * sizeScale))
      .attr("text-anchor", "end")
      .attr("font-size", titleFont)
      .text(label);
    const color = colorForThreshold(maxValue, opts.thresholds);
    if (color) {
      const bbox = maxText.node()?.getBBox();
      if (bbox) {
        const padX = 4;
        const padY = 2;
        svgSel.insert("rect", () => maxText.node())
          .attr("x", bbox.x - padX)
          .attr("y", bbox.y - padY)
          .attr("width", bbox.width + padX * 2)
          .attr("height", bbox.height + padY * 2)
          .attr("rx", 4)
          .attr("ry", 4)
          .attr("fill", color)
          .attr("stroke", "none");
        maxText.attr("fill", "#0b0d13");
      } else {
        maxText.attr("fill", "#cfd3dc");
      }
    } else {
      maxText.attr("fill", "#cfd3dc");
    }
  }

  function redraw() {
    const samples = lastSamples;
    if (!samples || !samples.length) {
      chartsDiv?.classList?.add("hidden");
      velChartSel.selectAll("*").remove();
      accChartSel.selectAll("*").remove();
      jerkChartSel.selectAll("*").remove();
      return;
    }
    chartsDiv?.classList?.remove("hidden");
    const { iVel, v_kmh, iAcc, aTotal, iJerk, jerkTotal } = computeKinematics(samples);
    drawMiniChart(velChartSel, iVel, v_kmh, "velocity (km/h)", { absMax: false, units: "km/h" });
    drawMiniChart(accChartSel, iAcc, aTotal, "acceleration total (m/s²)", { absMax: true, units: "m/s²", thresholds: limits.acceleration });
    drawMiniChart(jerkChartSel, iJerk, jerkTotal, "jerk total (m/s³)", { absMax: true, units: "m/s³", thresholds: limits.jerk });
  }

  function render(samples) {
    lastSamples = Array.isArray(samples) ? samples : null;
    redraw();
  }

  if (chartsDiv) {
    // Redraw charts when the container resizes to keep them full-width.
    const handleResize = () => {
      if (!lastSamples || !lastSamples.length) return;
      if (resizeRaf != null) return;
      resizeRaf = window.requestAnimationFrame(() => {
        resizeRaf = null;
        redraw();
      });
    };

    if (typeof ResizeObserver === "function") {
      const ro = new ResizeObserver(handleResize);
      ro.observe(chartsDiv);
    } else {
      window.addEventListener("resize", handleResize);
    }
  }

  return { render };
}
