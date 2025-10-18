// Global config for the spline editor.

window.SPLINE_CONFIG = {
  // ---- Physical scaling & defaults ----
  metersPerPixel: 0.05,
  defaultCurve: "basis",  // "basis" | "natural" | "catmullrom"
  defaultDt: 0.20,        // seconds
  numSamples: 16,         // number of intermediate points >= 3

  // ---- Optimizer hyperparameters ----
  optimizer: {
    steps: [0.05, 0.02, 0.01, 0.005, 0.002],
    maxPassesPerStep: 8,
    monotonicEps: 1e-4,

    // weights (these are what the sliders control at runtime)
    wJerk: 1.0,
    wVel: 0.10,
    wAcc: 0.10,

    // soft limits (used by penalties)
    vMaxKmh: 120,
    aLongMax: 3.0,
    aLatMax: 3.0
  },

  // ---- Chart limits (null = auto-scale)
  chartLimits: {
    velocityKmh: null,
    accelMS2: null
  },

  controls: {
    moveStepPx: 1,        // arrow step for control points (px)
    moveStepPxFast: 5,    // with Shift held
    sampleStepT: 0.001,    // up/down t-step for samples
    sampleStepTFast: 0.005 // with Shift held
  }
};
