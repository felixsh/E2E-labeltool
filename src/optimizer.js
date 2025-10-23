export function createTrajectoryOptimizer({
  d3,
  getDt,
  getConfig,
  getSampleCount,
  getParamPoint,
  getTs,
  setTs,
  getDensePointCount,
  pushUndoState,
  onOptimized,
  getFixedPoints = () => [],
  logger = console
}) {
  function evaluateCost(Tarray, dt, cfg) {
    const fixed = getFixedPoints ? getFixedPoints() : [];
    let paramPoints = Tarray.map(t => {
      const p = getParamPoint(t);
      return [p.x, p.y];
    });
    if (fixed.length && paramPoints.length) {
      const lastFixed = fixed[fixed.length - 1];
      const firstParam = paramPoints[0];
      if (Math.abs(firstParam[0] - lastFixed[0]) < 1e-9 && Math.abs(firstParam[1] - lastFixed[1]) < 1e-9) {
        paramPoints = paramPoints.slice(1);
      }
    }
    const P = fixed.concat(paramPoints);

    let jerk = 0;
    for (let i = 0; i <= P.length - 4; i++) {
      const jx = (P[i + 3][0] - 3 * P[i + 2][0] + 3 * P[i + 1][0] - P[i][0]);
      const jy = (P[i + 3][1] - 3 * P[i + 2][1] + 3 * P[i + 1][1] - P[i][1]);
      jerk += jx * jx + jy * jy;
    }

    const dt2 = dt * dt;
    const v_ms = d3.range(P.length - 1).map(i => {
      const dx = (P[i + 1][0] - P[i][0]) / dt;
      const dy = (P[i + 1][1] - P[i][1]) / dt;
      return Math.hypot(dx, dy);
    });
    const v_kmh = v_ms.map(v => v * 3.6);

    const a = d3.range(P.length - 2).map(i => {
      const ax = (P[i + 2][0] - 2 * P[i + 1][0] + P[i][0]) / dt2;
      const ay = (P[i + 2][1] - 2 * P[i + 1][1] + P[i][1]) / dt2;
      return [ax, ay];
    });
    const tHat = d3.range(P.length - 2).map(i => {
      const tx = P[i + 2][0] - P[i][0];
      const ty = P[i + 2][1] - P[i][1];
      const n = Math.hypot(tx, ty) || 1;
      return [tx / n, ty / n];
    });
    const aLong = a.map(([ax, ay], i) => ax * tHat[i][0] + ay * tHat[i][1]);
    const aLat = a.map(([ax, ay], i) => {
      const al = aLong[i];
      const axp = ax - al * tHat[i][0];
      const ayp = ay - al * tHat[i][1];
      const mag = Math.hypot(axp, ayp);
      const sign = Math.sign(tHat[i][0] * ay - tHat[i][1] * ax) || 1;
      return sign * mag;
    });

    let penV = 0;
    for (const v of v_kmh) {
      const d = v - cfg.vMaxKmh;
      if (d > 0) penV += d * d;
    }

    let penA = 0;
    for (const al of aLong) {
      const d = Math.abs(al) - cfg.aLongMax;
      if (d > 0) penA += d * d;
    }
    for (const at of aLat) {
      const d = Math.abs(at) - cfg.aLatMax;
      if (d > 0) penA += d * d;
    }

    return cfg.wJerk * jerk + cfg.wVel * penV + cfg.wAcc * penA;
  }

  function optimizeTs() {
    if (getDensePointCount() < 2) {
      logger.warn("[optimizeTs] Not enough sample points to optimize (need ≥2).");
      return;
    }

    pushUndoState();

    const cfg = getConfig();
    const dt = getDt();
    const N = getSampleCount();
    const eps = cfg.monotonicEps;
    const T = getTs().slice();
    T[0] = 0;
    T[N - 1] = 1;

    let best = evaluateCost(T, dt, cfg);

    logger.groupCollapsed?.("%c[optimizeTs] Optimization started", "color:#6cf");
    logger.log("Initial cost:", best.toFixed(6));
    logger.log("Steps:", cfg.steps);
    logger.log("Max passes/step:", cfg.maxPassesPerStep);

    let totalPasses = 0;
    let anyImprovement = false;

    for (const h0 of cfg.steps) {
      let improved = true;
      let passes = 0;
      logger.groupCollapsed?.(`Step size h0=${h0}`);
      while (improved && passes < cfg.maxPassesPerStep) {
        improved = false;
        passes++;
        totalPasses++;

        for (let j = 1; j < N - 1; j++) {
          const L = T[j - 1] + eps;
          const R = T[j + 1] - eps;
          let tj = Math.min(R, Math.max(L, T[j]));
          let bestLocal = best;
          let bestTj = tj;

          for (const dir of [-1, +1]) {
            const cand = Math.min(R, Math.max(L, tj + dir * h0));
            if (Math.abs(cand - tj) < 1e-12) continue;
            const old = T[j];
            T[j] = cand;
            const cost = evaluateCost(T, dt, cfg);
            T[j] = old;
            if (cost + 1e-12 < bestLocal) {
              bestLocal = cost;
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
          logger.log(`↳ Step ${h0}: converged after ${passes} passes (no further improvement).`);
          break;
        }
        if (passes >= cfg.maxPassesPerStep) {
          logger.warn(`↳ Step ${h0}: reached max passes (${cfg.maxPassesPerStep}) before convergence.`);
        }
      }
      logger.groupEnd?.();
    }

    if (!anyImprovement) {
      logger.info?.("[optimizeTs] Terminated: no improvement across all steps.");
    } else {
      logger.info?.("[optimizeTs] Optimization complete.");
    }
    logger.log("Final cost:", best.toFixed(6));
    logger.log("Total passes:", totalPasses);
    logger.groupEnd?.();

    setTs(T);
    onOptimized();
  }

  return { optimizeTs };
}
