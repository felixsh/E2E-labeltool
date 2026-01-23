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

function baseName(entryName = "") {
  const normalized = normalizeEntryName(entryName);
  const parts = normalized.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : normalized;
}

function matchesBase(entryName = "", regex) {
  return regex.test(baseName(entryName));
}

const RE_TRAJECTORY = /^trajectory.*\.npy$/i;
const RE_TRANSFORM = /^transformation_matrices.*\.npy$/i;
const RE_FRONT_IMG = /^front_img_now.*\.(jpg|jpeg)$/i;
const RE_PCD_OR_BIN = /\.(bin|pcd)$/i;
const RE_PRIMARY_PCD = /^pc_now.*\.(bin|pcd)$/i;
const RE_SECONDARY_PCD = /^pc_end.*\.(bin|pcd)$/i;

function sortEntriesByName(entries = []) {
  return entries.slice().sort((a, b) => normalizeEntryName(a.name).localeCompare(normalizeEntryName(b.name)));
}

function isTrajectoryName(entryName = "") {
  return matchesBase(entryName, RE_TRAJECTORY);
}

function isTransformName(entryName = "") {
  return matchesBase(entryName, RE_TRANSFORM);
}

function isFrontImageName(entryName = "") {
  return matchesBase(entryName, RE_FRONT_IMG);
}

function isPointCloudName(entryName = "") {
  return matchesBase(entryName, RE_PCD_OR_BIN);
}

function isPrimaryCloudName(entryName = "") {
  return isPointCloudName(entryName) && matchesBase(entryName, RE_PRIMARY_PCD);
}

function isSecondaryCloudName(entryName = "") {
  return isPointCloudName(entryName) && matchesBase(entryName, RE_SECONDARY_PCD);
}

function makeZipPath(zipName, entryName) {
  const cleanZip = zipName || "dataset.zip";
  const cleanEntry = normalizeEntryName(entryName) || "file";
  return `${cleanZip}::${cleanEntry}`;
}

function selectTrajectoryEntry(entries) {
  const matches = entries.filter((entry) => isTrajectoryName(entry.name));
  if (!matches.length) return null;
  return sortEntriesByName(matches)[0];
}

function selectPointCloudEntries(entries, preferFirstCloud = false) {
  const pick = (list = []) => {
    if (!list.length) return null;
    const sorted = sortEntriesByName(list);
    return preferFirstCloud ? sorted[0] : sorted[sorted.length - 1];
  };

  const primaryCandidates = entries.filter((entry) => isPrimaryCloudName(entry.name));
  const secondaryCandidates = entries.filter((entry) => isSecondaryCloudName(entry.name));
  const allPointClouds = entries.filter((entry) => isPointCloudName(entry.name));

  let primary = pick(primaryCandidates);
  let secondary = pick(secondaryCandidates);

  if (!primary && allPointClouds.length) {
    // Fallback to any point cloud files if the expected names are missing.
    primary = pick(allPointClouds);
    const sortedAll = sortEntriesByName(allPointClouds);
    secondary = sortedAll.length >= 2
      ? (preferFirstCloud ? sortedAll[sortedAll.length - 1] : sortedAll[0])
      : null;
  } else if (primary && !secondary && allPointClouds.length >= 2) {
    const sortedAll = sortEntriesByName(allPointClouds);
    const others = sortedAll.filter((entry) => entry !== primary);
    secondary = others.length
      ? (preferFirstCloud ? others[others.length - 1] : others[0])
      : null;
  }

  if (!primary) return null;
  if (!secondary) {
    console.warn("Only one point cloud found in zip; secondary cloud will be empty.");
  }
  return { primary, secondary };
}

function ensureAncillaryFiles(entries) {
  const hasTransform = entries.some((e) => isTransformName(e.name));
  const hasImage = entries.some((e) => isFrontImageName(e.name));
  if (!hasImage) {
    console.warn('Front-facing .jpg image (filename including "front") not found; continuing without front image.');
  }
  return { hasTransform };
}

function selectTransformEntry(entries) {
  const matches = entries.filter((entry) => isTransformName(entry.name));
  if (!matches.length) return null;
  return sortEntriesByName(matches)[0];
}

async function loadFrontImage(entries, zip, zipName) {
  const matches = entries.filter((e) => isFrontImageName(e.name));
  const entry = matches.length ? sortEntriesByName(matches)[0] : null;
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

function parseTransformMatrix(parsed, index = 0) {
  const shape = parsed?.shape || [];
  if (shape.length !== 3 || shape[1] !== 4 || shape[2] !== 4) {
    throw new Error("transformation_matrices.npy must have shape (N,4,4)");
  }
  const n = shape[0];
  if (n < 1) {
    throw new Error("transformation_matrices.npy is empty");
  }
  const clampedIdx = Math.min(n - 1, Math.max(0, index | 0));
  const { data, fortranOrder } = parsed;
  const idx3 = (i, j, k) => {
    if (fortranOrder) {
      return i + shape[0] * (j + shape[1] * k);
    }
    return (i * shape[1] + j) * shape[2] + k;
  };
  const mat = [];
  for (let r = 0; r < 4; r++) {
    const row = [];
    for (let c = 0; c < 4; c++) {
      row.push(data[idx3(clampedIdx, r, c)]);
    }
    mat.push(row);
  }
  const lastRow = mat[3];
  const okLastRow = Math.abs(lastRow[0]) < 1e-6 && Math.abs(lastRow[1]) < 1e-6 && Math.abs(lastRow[2]) < 1e-6 && Math.abs(lastRow[3] - 1) < 1e-6;
  if (!okLastRow) {
    console.warn("Transformation matrix last row is not [0 0 0 1]");
  }
  const rotation3x3 = mat.slice(0, 3).map((row) => row.slice(0, 3));
  const translation = [mat[0][3], mat[1][3], mat[2][3]];
  return { matrix4x4: mat, rotation3x3, translation, index: clampedIdx };
}

export async function loadDatasetFromZip(file, { preferFirstCloud = false, transformIndex = 0 } = {}) {
  const zipBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(zipBuffer);
  const entries = Object.values(zip.files || {}).filter((f) => !f.dir);

  if (!entries.length) {
    throw new Error("zip is empty");
  }

  const ancillary = ensureAncillaryFiles(entries);

  const trajEntry = selectTrajectoryEntry(entries);
  if (!trajEntry) {
    throw new Error('zip is missing a trajectory .npy file');
  }
  const cloudEntries = selectPointCloudEntries(entries, preferFirstCloud);
  if (!cloudEntries?.primary) {
    throw new Error("zip is missing point cloud (.bin/.pcd) files");
  }

  const transformEntry = selectTransformEntry(entries);
  const needsTransform = !!cloudEntries.secondary;
  if (needsTransform && !transformEntry) {
    throw new Error('zip is missing "transformation_matrices.npy" required for the second point cloud');
  }

  const promises = [
    trajEntry.async("arraybuffer"),
    cloudEntries.primary.async("arraybuffer"),
    loadFrontImage(entries, zip, file?.name)
  ];
  const hasSecondary = !!cloudEntries.secondary;
  if (hasSecondary) {
    promises.push(cloudEntries.secondary.async("arraybuffer"));
  }
  const hasTransform = !!transformEntry;
  const transformPosition = promises.length;
  if (transformEntry) {
    promises.push(transformEntry.async("arraybuffer"));
  }
  const results = await Promise.all(promises);
  let ri = 0;
  const trajBuffer = results[ri++];
  const cloudBuffer = results[ri++];
  const frontImage = results[ri++];
  const cloudBuffer2 = hasSecondary ? results[ri++] : null;
  const transformBuffer = hasTransform ? results[transformPosition] : null;

  const trajectoryParsed = await loadNpy(trajBuffer);
  const trajectoryPoints = parseTrajectory(trajectoryParsed);
  const cloudRaw = parsePointCloud(cloudBuffer, normalizeEntryName(cloudEntries.primary.name));
  const cloudRawSecondary = cloudEntries.secondary && cloudBuffer2
    ? parsePointCloud(cloudBuffer2, normalizeEntryName(cloudEntries.secondary.name))
    : null;
  const transformParsed = transformBuffer ? await loadNpy(transformBuffer) : null;
  const transformResult = transformParsed ? parseTransformMatrix(transformParsed, transformIndex) : null;

  return {
    trajectory: {
      points: trajectoryPoints,
      raw: trajectoryParsed,
      name: normalizeEntryName(trajEntry.name),
      path: makeZipPath(file?.name, trajEntry.name)
    },
    transformation: transformResult,
    frontImage,
    cloud: {
      raw: cloudRaw,
      name: normalizeEntryName(cloudEntries.primary.name),
      path: makeZipPath(file?.name, cloudEntries.primary.name)
    },
    secondaryCloud: cloudRawSecondary ? {
      raw: cloudRawSecondary,
      name: normalizeEntryName(cloudEntries.secondary.name),
      path: makeZipPath(file?.name, cloudEntries.secondary.name)
    } : null
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

export async function loadDemoDataset({ zipUrl, cloudUrl, trajectoryUrl, preferFirstCloud = false, transformIndex = 0 } = {}) {
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
  return loadDatasetFromZip(pseudoFile, { preferFirstCloud, transformIndex });
}
