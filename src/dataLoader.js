import { parsePointCloud } from "./pcdParser.js";
import { load as loadNpy } from "npyjs";

function nameFromPath(path, fallback) {
  if (!path) return fallback;
  const parts = String(path).split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : fallback;
}

function parseTrajectory(parsed) {
  const shape = parsed?.shape || [];
  if (shape.length !== 2 || shape[1] < 2) {
    throw new Error("expected an array shaped (N, 2)");
  }

  const stride = shape[1];
  const { data } = parsed;
  const points = [];
  for (let i = 0; i < shape[0]; i++) {
    const x = data[i * stride + 0];
    const y = data[i * stride + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    points.push([x, y]);
  }
  if (points.length < 2) {
    throw new Error("trajectory requires at least two finite points");
  }
  return points;
}

function normalizeTrajectory(parsed) {
  if (!parsed || !Array.isArray(parsed.shape)) return parsed;
  const [rows, cols] = parsed.shape;
  if (rows && cols > 2 && parsed.data) {
    const stride = cols;
    const ctor =
      typeof parsed.data.constructor === "function"
        ? parsed.data.constructor
        : Float64Array;
    const trimmed = new ctor(rows * 2);
    for (let i = 0; i < rows; i++) {
      trimmed[i * 2 + 0] = parsed.data[i * stride + 0];
      trimmed[i * 2 + 1] = parsed.data[i * stride + 1];
    }
    return {
      ...parsed,
      shape: [rows, 2],
      data: trimmed
    };
  }
  return parsed;
}

export async function loadPointCloudFromFile(file) {
  const buffer = await file.arrayBuffer();
  const name = file?.name || "pointcloud.pcd";
  const raw = parsePointCloud(buffer, name);
  const path =
    file?.path ||
    file?.webkitRelativePath ||
    (file?.name ? file.name : null);
  return { raw, name, path };
}

export async function loadPointCloudFromUrl(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();
  const name = nameFromPath(url, "pointcloud.pcd");
  const raw = parsePointCloud(buffer, name);
  return { raw, name, path: url };
}

export async function loadTrajectoryFromFile(file) {
  const buffer = await file.arrayBuffer();
  const parsed = normalizeTrajectory(await loadNpy(buffer));
  const points = parseTrajectory({
    shape: parsed.shape,
    data: parsed.data
  });
  const name = file?.name || "trajectory.npy";
  const path =
    file?.path ||
    file?.webkitRelativePath ||
    (file?.name ? file.name : null);
  return { points, raw: parsed, name, path };
}

export async function loadTrajectoryFromUrl(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();
  const parsed = normalizeTrajectory(await loadNpy(buffer));
  const points = parseTrajectory({
    shape: parsed.shape,
    data: parsed.data
  });
  const name = nameFromPath(url, "trajectory.npy");
  return { points, raw: parsed, name, path: url };
}

export async function loadDemoDataset({ cloudUrl, trajectoryUrl } = {}) {
  const result = {};
  if (cloudUrl) {
    result.cloud = await loadPointCloudFromUrl(cloudUrl);
  }
  if (trajectoryUrl) {
    result.trajectory = await loadTrajectoryFromUrl(trajectoryUrl);
  }
  return result;
}
