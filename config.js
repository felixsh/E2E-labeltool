window.CONFIG = {
  // Demo files
  demoPCD: "demo/pointcloud.bin",
  demoTrajectory: "demo/trajectory.npy",
  
  /* Point rendering */
  pointSize: 0.08,                // meters; in 2D multiplied by camera.zoom
  colorMode: "height",            // "height" | "intensity" | "distance" | "solid"
  maxPoints: 500000,              // hard cap

  // Curve settings
  defaultCurve: "basis",          // "basis" | "natural" | "catmullrom"
  defaultAlpha: 0.5,              // only for catmull-rom
  N_FUTURE: 25,                   // number of intermediate/sample points
  N_PAST: 3,                      // how many previously driven (fixed) samples to keep ahead of the spline
  defaultDt: 0.20,                // Simulation timestep for velocity/accel (seconds)
  initCtrl: [[0,0],[4,0]],        // Control points in world meters on z=0

  // Comfort / max thresholds used by charts (m/s² and m/s³)
  kinematicLimits: {
    acceleration: { comfort: 3, max: 9 },
    jerk: { comfort: 2, max: 15 }
  },

  // Optimizer hyperparameters
  optimizer: {
    monotonicEps: 1e-4,
    wJerk: 1.0,
    wVel: 0.10,
    wAcc: 0.10,
    maxIterations: 10000
  }
};
