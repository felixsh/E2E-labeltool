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
    throw new Error("expected an array shaped (N, >=2)");
  }
  const rows = shape[0];
  const cols = shape[1];
  const { data, fortranOrder } = parsed;
  const points = [];
  const idxFor = (r, c) => (fortranOrder ? r + rows * c : r * cols + c);
  for (let r = 0; r < rows; r++) {
    const x = data[idxFor(r, 0)];
    const y = data[idxFor(r, 1)];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    points.push([x, y]);
  }
  if (points.length < 2) {
    throw new Error("trajectory requires at least two finite points");
  }
  return points;
}

export async function loadPointCloudFromFile(file) {
  const buffer = await file.arrayBuffer();
  const name = file?.name || "pointcloud.pcd";
  const raw = parsePointCloud(buffer, name);
  const path =
    typeof file?.webkitRelativePath === "string" && file.webkitRelativePath.trim()
      ? file.webkitRelativePath
      : file?.path || (file?.name ? file.name : null);
  return { raw, name, path };
}

export async function loadPointCloudFromUrl(url) {
  const response = await fetch(url, { cache: "no-store" });
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
  const parsed = await loadNpy(buffer);
  const points = parseTrajectory(parsed);
  const name = file?.name || "trajectory.npy";
  const path =
    typeof file?.webkitRelativePath === "string" && file.webkitRelativePath.trim()
      ? file.webkitRelativePath
      : file?.path || (file?.name ? file.name : null);
  return { points, raw: parsed, name, path };
}

export async function loadTrajectoryFromUrl(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();
  const parsed = await loadNpy(buffer);
  const points = parseTrajectory(parsed);
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
