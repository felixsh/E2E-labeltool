export function makeEvaluateCost({
  d3,
  getParamPoint,
  getFixedPoints = () => []
}) {
  const samplePoint = (t) => {
    const p = getParamPoint(t);
    return [p.x, p.y];
  };

  const sampleDerivatives = (t, lower, upper) => {
    if (!(upper > lower + 1e-12)) {
      return { dx: 0, dy: 0 };
    }

    const span = upper - lower;
    let delta = Math.min(1e-4, span * 0.5);
    if (delta <= 0) delta = span * 0.25;
    if (delta <= 0) {
      return { dx: 0, dy: 0 };
    }

    let tMinus = Math.max(lower, t - delta);
    let tPlus = Math.min(upper, t + delta);
    if (tPlus <= tMinus + 1e-12) {
      tPlus = Math.min(upper, tPlus + delta);
      tMinus = Math.max(lower, tMinus - delta);
    }
    if (tPlus <= tMinus + 1e-12) {
      return { dx: 0, dy: 0 };
    }

    const pPlus = samplePoint(tPlus);
    const pMinus = samplePoint(tMinus);
    const denom = tPlus - tMinus || 1e-6;
    const dx = (pPlus[0] - pMinus[0]) / denom;
    const dy = (pPlus[1] - pMinus[1]) / denom;
    return { dx, dy };
  };

  function computeCostAndGradient(Tarray, dt, cfg, needGrad) {

    const fixed = getFixedPoints ? getFixedPoints() : [];
    const paramPoints = Tarray.map(samplePoint);
    const P = fixed.concat(paramPoints.slice(1));
    const pointCount = P.length;

    if (pointCount < 2) {
      return needGrad ? { value: 0, grad: new Float64Array(Tarray.length) } : { value: 0 };
    }

    const wVel = Number.isFinite(cfg.wVel) ? cfg.wVel : 0;
    const wAcc = Number.isFinite(cfg.wAcc) ? cfg.wAcc : 0;
    const wJerk = Number.isFinite(cfg.wJerk) ? cfg.wJerk : 0;

    const invDt = 1 / dt;
    const invDt2 = invDt * invDt;
    const invDt4 = invDt2 * invDt2;
    const invDt6 = invDt4 * invDt2;

    const gradP = needGrad ? Array.from({ length: pointCount }, () => [0, 0]) : null;

    let cost = 0;

    const accumulateQuadratic = (indices, coeffs, weight) => {
      if (!weight) return;
      let vx = 0;
      let vy = 0;
      for (let k = 0; k < indices.length; k++) {
        const idx = indices[k];
        vx += coeffs[k] * P[idx][0];
        vy += coeffs[k] * P[idx][1];
      }
      const quad = vx * vx + vy * vy;
      cost += weight * quad;

      if (!needGrad) return;

      const scale = 2 * weight;
      for (let k = 0; k < indices.length; k++) {
        const idx = indices[k];
        gradP[idx][0] += scale * vx * coeffs[k];
        gradP[idx][1] += scale * vy * coeffs[k];
      }

    };

    for (let i = 0; i < pointCount - 1; i++) {
      accumulateQuadratic([i, i + 1], [-1, 1], wVel * invDt2);
    }

    for (let i = 0; i < pointCount - 2; i++) {
      accumulateQuadratic([i, i + 1, i + 2], [1, -2, 1], wAcc * invDt4);
    }

    for (let i = 0; i < pointCount - 3; i++) {
      accumulateQuadratic([i, i + 1, i + 2, i + 3], [-1, 3, -3, 1], wJerk * invDt6);
    }

    const result = { value: cost };

    if (!needGrad) {
      return result;
    }

    const gradT = new Float64Array(Tarray.length);
    const monotonicEps = Number.isFinite(cfg.monotonicEps) ? cfg.monotonicEps : 0;
    const nInt = Math.max(0, Tarray.length - 2);
    const offset = fixed.length;

    const derivatives = Tarray.map((t, idx) => {
      if (idx === 0 || idx === Tarray.length - 1) {
        return { dx: 0, dy: 0 };
      }
      const lower = Math.max(0, Math.min(1, Tarray[idx - 1] + monotonicEps));
      const upper = Math.max(0, Math.min(1, Tarray[idx + 1] - monotonicEps));
      return sampleDerivatives(t, lower, upper);
    });

    for (let a = 0; a < nInt; a++) {
      const tIdx = a + 1;
      const pIdx = offset + a;
      const deriv = derivatives[tIdx];
      const dp = [deriv.dx, deriv.dy];
      const gPx = gradP[pIdx][0];
      const gPy = gradP[pIdx][1];
      gradT[tIdx] = gPx * dp[0] + gPy * dp[1];
    }

    result.grad = gradT;

    return result;
  }

  function evaluateCost(Tarray, dt, cfg) {
    return computeCostAndGradient(Tarray, dt, cfg, false).value;
  }

  evaluateCost.withGradient = function withGradient(Tarray, dt, cfg) {
    return computeCostAndGradient(Tarray, dt, cfg, true);
  };

  return evaluateCost;
}
