// src/align.js

// Apply transform to all points in the cloud
export function applyTransformToPointCloudBuffer(points, R, t) {
  if (!(points instanceof Float32Array)) {
    throw new Error("expected Float32Array of points");
  }

  const N = points.length;
  let stride;
  if (N % 4 === 0) {
    stride = 4;
  } else if (N % 3 === 0) {
    stride = 3;
  } else {
    throw new Error("Unknown point format (not divisible by 3 or 4 floats).");
  }

  for (let i = 0; i < N; i += stride) {
    const x = points[i + 0];
    const y = points[i + 1];
    const z = points[i + 2];

    const nx = R[0][0] * x + R[0][1] * y + R[0][2] * z + t[0];
    const ny = R[1][0] * x + R[1][1] * y + R[1][2] * z + t[1];
    const nz = R[2][0] * x + R[2][1] * y + R[2][2] * z + t[2];

    points[i + 0] = nx;
    points[i + 1] = ny;
    points[i + 2] = nz;
  }
}
