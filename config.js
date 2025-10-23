window.CONFIG = {
  /* ---------- PCD viewer ---------- */
  demoPCD: "demo/pointcloud.bin",       // used by Demo button
  demoTrajectory: "demo/trajectory.npy",
  
  /* Point rendering */
  pointSize: 0.08,                // meters; in 2D multiplied by camera.zoom
  colorMode: "height",            // "height" | "intensity" | "distance" | "solid"
  maxPoints: 500000,              // hard cap

  /* ---------- Spline editor ---------- */
  // Control points in world meters on z=0
  initCtrl: [[0,0],[4,0]],

  // Curve settings
  defaultCurve: "basis",          // "basis" | "natural" | "catmullrom"
  defaultAlpha: 0.5,              // only for catmull-rom
  N_FUTURE: 25,                  // number of intermediate/sample points
  N_PAST: 3,                     // how many previously driven (fixed) samples to keep ahead of the spline

  // Simulation timestep for velocity/accel (seconds)
  defaultDt: 0.20,

  // Mini-chart axis limits (null = auto)
  chartLimits: {
    velocityKmh: null,            // e.g. 120
    accelMS2:   null             // e.g. 5
  },

  // Optimizer hyperparameters
  optimizer: {
    monotonicEps: 1e-8,
    wJerk: 1.0,
    wVel: 0.10,
    wAcc: 0.10,
    vMaxKmh: 120,
    aLongMax: 3.0,
    aLatMax: 3.0
  }
};
