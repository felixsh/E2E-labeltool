import { parsePointCloud } from "./pcdParser.js";
import { load as loadNpy } from "npyjs";
import JSZip from "jszip";

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

function normalizeEntryName(entryName = "") {
  return entryName.split("/").filter(Boolean).join("/").trim();
}

function makeZipPath(zipName, entryName) {
  const cleanZip = zipName || "dataset.zip";
  const cleanEntry = normalizeEntryName(entryName) || "file";
  return `${cleanZip}::${cleanEntry}`;
}

function selectTrajectoryEntry(entries) {
  return entries.find((entry) => {
    const lower = normalizeEntryName(entry.name).toLowerCase();
    return lower.endsWith(".npy") && lower.includes("trajectory");
  }) || null;
}

function selectPointCloudEntry(entries, preferFirstCloud = false) {
  const candidates = entries.filter((entry) => {
    const lower = normalizeEntryName(entry.name).toLowerCase();
    return lower.endsWith(".bin") || lower.endsWith(".pcd");
  });
  if (!candidates.length) return null;
  if (candidates.length < 2) {
    throw new Error("zip must contain at least two point cloud (.bin/.pcd) files");
  }
  const sorted = candidates.slice().sort((a, b) => normalizeEntryName(a.name).localeCompare(normalizeEntryName(b.name)));
  return preferFirstCloud ? sorted[0] : sorted[sorted.length - 1];
}

function ensureAncillaryFiles(entries) {
  const lowerNames = entries.map((e) => normalizeEntryName(e.name).toLowerCase());
  const hasTransform = lowerNames.some((name) => name.endsWith("transformation_matrices.npy"));
  const hasImage = lowerNames.some((name) => (name.endsWith(".jpg") || name.endsWith(".jpeg")) && name.includes("front"));
  if (!hasTransform) {
    throw new Error('zip is missing "transformation_matrices.npy"');
  }
  if (!hasImage) {
    throw new Error('zip is missing a front-facing .jpg image (filename must include "front")');
  }
}

async function loadFrontImage(entries, zip, zipName) {
  const entry = entries.find((e) => {
    const lower = normalizeEntryName(e.name).toLowerCase();
    return (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) && lower.includes("front");
  });
  if (!entry) return null;
  const blob = await entry.async("blob");
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(blob);
  });
  return {
    dataUrl,
    name: normalizeEntryName(entry.name),
    path: makeZipPath(zipName, entry.name)
  };
}

export async function loadDatasetFromZip(file, { preferFirstCloud = false } = {}) {
  const zipBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(zipBuffer);
  const entries = Object.values(zip.files || {}).filter((f) => !f.dir);

  if (!entries.length) {
    throw new Error("zip is empty");
  }

  ensureAncillaryFiles(entries);

  const trajEntry = selectTrajectoryEntry(entries);
  if (!trajEntry) {
    throw new Error('zip is missing a trajectory .npy file');
  }
  const cloudEntry = selectPointCloudEntry(entries, preferFirstCloud);
  if (!cloudEntry) {
    throw new Error("zip is missing point cloud (.bin/.pcd) files");
  }

  const [trajBuffer, cloudBuffer, frontImage] = await Promise.all([
    trajEntry.async("arraybuffer"),
    cloudEntry.async("arraybuffer"),
    loadFrontImage(entries, zip, file?.name)
  ]);

  const trajectoryParsed = await loadNpy(trajBuffer);
  const trajectoryPoints = parseTrajectory(trajectoryParsed);
  const cloudRaw = parsePointCloud(cloudBuffer, normalizeEntryName(cloudEntry.name));

  return {
    trajectory: {
      points: trajectoryPoints,
      raw: trajectoryParsed,
      name: normalizeEntryName(trajEntry.name),
      path: makeZipPath(file?.name, trajEntry.name)
    },
    frontImage,
    cloud: {
      raw: cloudRaw,
      name: normalizeEntryName(cloudEntry.name),
      path: makeZipPath(file?.name, cloudEntry.name)
    }
  };
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

export async function loadDemoDataset({ zipUrl, cloudUrl, trajectoryUrl, preferFirstCloud = false } = {}) {
  const url = zipUrl || cloudUrl || trajectoryUrl;
  if (!url) {
    throw new Error("zipUrl is required for demo loading");
  }
  if (!zipUrl) {
    console.warn("loadDemoDataset: cloudUrl/trajectoryUrl are deprecated; use zipUrl instead.");
  }
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();
  const pseudoFile = {
    name: nameFromPath(url, "demo.zip"),
    arrayBuffer: async () => buffer
  };
  return loadDatasetFromZip(pseudoFile, { preferFirstCloud });
}
