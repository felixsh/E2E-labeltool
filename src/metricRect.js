// src/metricRect.js
// Utilities for scaling similarity-rectangle thresholds based on velocity.

const CONFIG = window.CONFIG || {};
const DEFAULT_DT = CONFIG.defaultDt ?? 0.2;
const BASE_THRESHOLDS = CONFIG.similarityThresholds || {
  threshLat: 1.8,
  threshLon: 3.6,
  vHigh: 11.0,
  vLow: 1.4
};

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function toXY(p) {
  if (!p) return [undefined, undefined];
  if (Array.isArray(p)) return [p[0], p[1]];
  return [p.x, p.y];
}

function normalizedScale(value, vLow, vHigh) {
  const range = Math.max(Number.EPSILON, vHigh - vLow);
  const normalized = clamp01((value - vLow) / range);
  return 0.5 + normalized * 0.5; // keeps scale in [0.5, 1] as in the MR metric paper
}

export function velocityFromSamples(samples, deltaT = DEFAULT_DT) {
  if (!Array.isArray(samples) || samples.length < 2) return { vX: 0, vY: 0 };

  const [prevX, prevY] = toXY(samples[samples.length - 2]);
  const [lastX, lastY] = toXY(samples[samples.length - 1]);

  if (![prevX, prevY, lastX, lastY].every(Number.isFinite)) return { vX: 0, vY: 0 };

  return {
    vX: (lastX - prevX) / deltaT,
    vY: (lastY - prevY) / deltaT
  };
}

export function rotationFromSamples(samples) {
  const fallback = { angle: 0, rotationMatrix: [[1, 0], [0, 1]] };
  if (!Array.isArray(samples) || samples.length < 2) return fallback;

  const [prevX, prevY] = toXY(samples[samples.length - 2]);
  const [lastX, lastY] = toXY(samples[samples.length - 1]);

  if (![prevX, prevY, lastX, lastY].every(Number.isFinite)) return fallback;

  const dx = lastX - prevX;
  const dy = lastY - prevY;
  const angle = Math.atan2(dy, dx);
  const c = Math.cos(angle);
  const s = Math.sin(angle);

  // Rotate by -angle so that heading cancels out and points at +x.
  return {
    angle,
    rotationMatrix: [
      [c, s],
      [-s, c]
    ]
  };
}

/**
 * Scale longitudinal/lateral thresholds according to velocity.
 * Mirrors the miss rate metric described in https://arxiv.org/abs/2104.10133.
 */
export function scaleThresholds(
  vX,
  vY,
  thresholds = {}
) {
  const { threshLat, threshLon, vHigh, vLow } = thresholds && Object.keys(thresholds).length
    ? { ...BASE_THRESHOLDS, ...thresholds }
    : BASE_THRESHOLDS;
  const scaleX = normalizedScale(Math.abs(vX), vLow, vHigh);
  const scaleY = normalizedScale(Math.abs(vY), vLow, vHigh);

  return {
    lon: threshLon * scaleX,
    lat: threshLat * scaleY
  };
}

/**
 * Build oriented rectangle corners using past motion for scale and future motion for heading.
 * Returns four 2D corner points rotated by the future heading.
 */
export function orientedCornersFromTrajectories(
  pastSamples,
  futureSamples,
  {
    deltaT = DEFAULT_DT,
    thresholds = {}
  } = {}
) {
  const { vX, vY } = velocityFromSamples(pastSamples, deltaT);
  const { lon, lat } = scaleThresholds(vX, vY, thresholds);
  const { rotationMatrix } = rotationFromSamples(futureSamples);

  const lastFuture = Array.isArray(futureSamples) && futureSamples.length
    ? futureSamples[futureSamples.length - 1]
    : null;
  const [rawCenterX = 0, rawCenterY = 0] = toXY(lastFuture) || [];
  const centerX = Number.isFinite(rawCenterX) ? rawCenterX : 0;
  const centerY = Number.isFinite(rawCenterY) ? rawCenterY : 0;

  // CCW corners in local frame: +x is lon, +y is lat
  const corners = [
    [lon, lat],
    [-lon, lat],
    [-lon, -lat],
    [lon, -lat]
  ];

  // Transpose of rotationMatrix: [[c, -s], [s, c]]
  const rotated = corners.map(([x, y]) => {
    const m00 = rotationMatrix[0][0];
    const m01 = rotationMatrix[0][1];
    const m10 = rotationMatrix[1][0];
    const m11 = rotationMatrix[1][1];
    return [
      centerX + x * m00 + y * m10,
      centerY + x * m01 + y * m11
    ];
  });

  return rotated;
}
