import { makeEvaluateCost } from "./optimizerCost.js";

let alglibCtorPromise = null;

async function getAlglibCtor() {
  if (!alglibCtorPromise) {
    alglibCtorPromise = import("https://cdn.jsdelivr.net/gh/Pterodactylus/Alglib.js@master/Alglib-v1.1.0.js")
      .then(mod => {
        if (!mod?.Alglib) throw new Error("Alglib export missing");
        return mod.Alglib;
      });
  }
  return alglibCtorPromise;
}

async function makeSolver() {
  const Alglib = await getAlglibCtor();
  const solver = new Alglib();
  if (solver?.promise) {
    await solver.promise;
  }
  return solver;
}

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
  const evaluateCost = makeEvaluateCost({ d3, getParamPoint, getFixedPoints });

  function clampMonotonic(values, eps) {
    const out = values.slice();
    let prev = 0;
    for (let i = 0; i < out.length; i++) {
      const remaining = out.length - i;
      const maxAllowed = 1 - eps * (remaining);
      const next = Math.max(prev + eps, Math.min(maxAllowed, out[i]));
      out[i] = next;
      prev = next;
    }
    return out;
  }

  async function optimizeTs() {
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

    if (N <= 2) {
      logger.warn("[optimizeTs] Not enough interior samples to optimize.");
      return;
    }

    logger.groupCollapsed?.("%c[optimizeTs] Alglib optimization started", "color:#6cf");
    logger.log("Interior variables:", N - 2);
    logger.log("Initial cost:", evaluateCost(T, dt, cfg).toFixed(6));

    let solver;
    try {
      solver = await makeSolver();
    } catch (err) {
      logger.error("[optimizeTs] Failed to load Alglib:", err);
      logger.groupEnd?.();
      return;
    }

    const interiorCount = N - 2;
    const maxPasses = Number.isFinite(cfg.maxSolverPasses) ? Math.max(1, cfg.maxSolverPasses | 0) : 3;
    const relTolRepeat = Number.isFinite(cfg.solverPassRelTol) ? Math.max(0, cfg.solverPassRelTol) : 1e-5;
    const maxIterations = Number.isFinite(cfg?.maxIterations) ? cfg.maxIterations : undefined;

    let xCurrent = clampMonotonic(T.slice(1, -1), eps);
    let currentCost = evaluateCost([0, ...xCurrent, 1], dt, cfg);
    let bestSolution = xCurrent.slice();
    let bestCost = currentCost;
    let solverReport = null;

    for (let pass = 0; pass < maxPasses; pass++) {
      let solver;
      try {
        solver = await makeSolver();
      } catch (err) {
        logger.error("[optimizeTs] Failed to load Alglib:", err);
        logger.groupEnd?.();
        return;
      }

      const gradCache = { key: null, value: null, grad: null };
      const useAnalyticGrad = typeof evaluateCost.withGradient === "function";

      const evalCost = (x) => {
        const key = Array.from(x).join("|");
        if (gradCache.key === key && gradCache.value != null) {
          return gradCache.value;
        }
        const TsFull = [0, ...x, 1];
        if (useAnalyticGrad) {
          const res = evaluateCost.withGradient(TsFull, dt, cfg);
          if (res && typeof res.value === "number" && res.grad) {
            const gradArr = Array.from(res.grad);
            if (gradArr.length === TsFull.length) {
              const interior = gradArr.slice(1, gradArr.length - 1);
              if (interior.length === x.length) {
                gradCache.key = key;
                gradCache.value = res.value;
                gradCache.grad = interior;
                return res.value;
              }
            }
          }
        }
        const value = evaluateCost(TsFull, dt, cfg);
        gradCache.key = key;
        gradCache.value = value;
        gradCache.grad = null;
        return value;
      };

      const gradFn = (x, j) => {
        const key = Array.from(x).join("|");
        if (gradCache.key !== key || !gradCache.grad) {
          evalCost(x);
        }
        if (gradCache.grad && gradCache.grad.length === x.length) {
          return gradCache.grad[j];
        }
        const step = 1e-6;
        const xp = x.slice();
        const xm = x.slice();
        xp[j] += step;
        xm[j] -= step;
        const xpClamped = clampMonotonic(xp, eps);
        const xmClamped = clampMonotonic(xm, eps);
        const fp = evaluateCost([0, ...xpClamped, 1], dt, cfg);
        const fm = evaluateCost([0, ...xmClamped, 1], dt, cfg);
        return (fp - fm) / (xpClamped[j] - xmClamped[j] || 1e-9);
      };

      const costFn = (x) => evalCost(x);
      const addFn = solver.add_function?.bind(solver);
      const addJac = solver.add_jacobian?.bind(solver);
      const addLe = solver.add_less_than_or_equal_to_constraint?.bind(solver);
      const solve = solver.solve?.bind(solver);

      if (!addFn || !addLe || !solve) {
        logger.error("[optimizeTs] Alglib solver does not expose required methods.");
        solver.remove?.();
        logger.groupEnd?.();
        return;
      }

      addFn(costFn);
      if (addJac) addJac(gradFn);

      const addConstraint = (fn, jac) => {
        addLe(fn);
        if (addJac && jac) addJac(jac);
      };

      addConstraint(
        (x) => eps - x[0],
        (_, j) => (j === 0 ? -1 : 0)
      );
      addConstraint(
        (x) => x[interiorCount - 1] - (1 - eps),
        (_, j) => (j === interiorCount - 1 ? 1 : 0)
      );
      for (let i = 1; i < interiorCount; i++) {
        addConstraint(
          (x) => x[i - 1] + eps - x[i],
          (_, j) => (j === i - 1 ? 1 : j === i ? -1 : 0)
        );
      }

      let solution = null;
      try {
        const maybe = solve("min", xCurrent, [], maxIterations);
        if (Array.isArray(maybe) && maybe.length === interiorCount) {
          solution = maybe;
        } else if (typeof solver.get_results === "function") {
          const res = solver.get_results();
          if (Array.isArray(res) && res.length === interiorCount) {
            solution = res;
          }
        }
        solverReport = solver.get_report?.();
      } catch (err) {
        logger.error("[optimizeTs] Solver error:", err);
      }

      if (!solution) {
        solver.remove?.();
        break;
      }

      const clamped = clampMonotonic(solution, eps);
      const candidateCost = evaluateCost([0, ...clamped, 1], dt, cfg);
      bestSolution = clamped;
      bestCost = candidateCost;
      solver.remove?.();

      const improvement = currentCost - candidateCost;
      if (improvement <= Math.max(1, Math.abs(currentCost)) * relTolRepeat) {
        break;
      }

      xCurrent = clamped;
      currentCost = candidateCost;
    }

    const nextTs = [0, ...bestSolution, 1];
    logger.log("Final cost:", bestCost.toFixed(6));
    if (solverReport) logger.log("Solver report:", solverReport);
    logger.groupEnd?.();

    setTs(nextTs);
    onOptimized();
  }

  return { optimizeTs };
}
