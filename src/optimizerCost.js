export function makeEvaluateCost({
  d3,
  getParamPoint,
  getFixedPoints = () => []
}) {
  return function evaluateCost(Tarray, dt, cfg) {
    const fixed = getFixedPoints ? getFixedPoints() : [];
    const paramPoints = Tarray.map(t => {
      const p = getParamPoint(t);
      return [p.x, p.y];
    });
    
    const P = fixed.concat(paramPoints.slice(1));
    
    const pointCount = P.length;
    if (pointCount < 2) {
      return 0;
    }
    
    const penV = d3.range(pointCount - 1).reduce((sum, i) => {
      const vx = (P[i + 1][0] - P[i][0]) / dt;
      const vy = (P[i + 1][1] - P[i][1]) / dt;
      return sum + vx * vx + vy * vy;
    }, 0);
    
    const dt2 = dt * dt;
    const penA = d3.range(pointCount - 2).reduce((sum, i) => {
      const ax = (P[i + 2][0] - 2 * P[i + 1][0] + P[i][0]) / dt2;
      const ay = (P[i + 2][1] - 2 * P[i + 1][1] + P[i][1]) / dt2;
      return sum + ax * ax + ay * ay;
    }, 0);
    
    const dt3 = dt2 * dt;
    const penJ = pointCount >= 4
      ? d3.range(pointCount - 3).reduce((sum, i) => {
          const jx = (P[i + 3][0] - 3 * P[i + 2][0] + 3 * P[i + 1][0] - P[i][0]) / dt3;
          const jy = (P[i + 3][1] - 3 * P[i + 2][1] + 3 * P[i + 1][1] - P[i][1]) / dt3;
          return sum + jx * jx + jy * jy;
        }, 0)
      : 0;

    return cfg.wJerk * penJ + cfg.wVel * penV + cfg.wAcc * penA;
  };
}
