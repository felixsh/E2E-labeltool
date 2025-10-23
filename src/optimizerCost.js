export function makeEvaluateCost({
  d3,
  getParamPoint,
  getFixedPoints = () => []
}) {
  return function evaluateCost(Tarray, dt, cfg) {
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

    const penV = v_ms.reduce((sum, v) => sum + v * v, 0);
    const penA =
      aLong.reduce((sum, val) => sum + val * val, 0) +
      aLat.reduce((sum, val) => sum + val * val, 0);

    return cfg.wJerk * jerk + cfg.wVel * penV + cfg.wAcc * penA;
  };
}
