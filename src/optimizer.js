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
    const costFn = (x) => {
      const Tx = [0, ...x, 1];
      return evaluateCost(Tx, dt, cfg);
    };
    const addFn = solver.add_function?.bind(solver);
    const addLe = solver.add_less_than_or_equal_to_constraint?.bind(solver);
    const solve = solver.solve?.bind(solver);

    if (!addFn || !addLe || !solve) {
      logger.error("[optimizeTs] Alglib solver does not expose required methods.");
      solver.remove?.();
      logger.groupEnd?.();
      return;
    }

    addFn(costFn);

    // Bounds for first and last interior points
    addLe((x) => eps - x[0]);
    addLe((x) => x[interiorCount - 1] - (1 - eps));

    // Monotonic constraints between neighbors
    for (let i = 1; i < interiorCount; i++) {
      addLe((x) => x[i - 1] + eps - x[i]);
    }

    const xGuess = clampMonotonic(T.slice(1, -1), eps);

    let solution = null;
    try {
      const maybe = solve("min", xGuess);
      if (Array.isArray(maybe) && maybe.length === interiorCount) {
        solution = maybe;
      } else if (typeof solver.get_results === "function") {
        const res = solver.get_results();
        if (Array.isArray(res) && res.length === interiorCount) {
          solution = res;
        }
      }
    } catch (err) {
      logger.error("[optimizeTs] Solver error:", err);
    }

    if (!solution) {
      logger.warn("[optimizeTs] Solver did not return a solution; keeping existing samples.");
      solver.remove?.();
      logger.groupEnd?.();
      return;
    }

    const clamped = clampMonotonic(solution, eps);
    const nextTs = [0, ...clamped, 1];
    logger.log("Final cost:", evaluateCost(nextTs, dt, cfg).toFixed(6));
    logger.log("Solver status:", solver.get_status?.());
    logger.log("Solver report:", solver.get_report?.());
    solver.remove?.();
    logger.groupEnd?.();

    setTs(nextTs);
    onOptimized();
  }

  return { optimizeTs };
}
