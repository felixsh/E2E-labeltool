const PREF_KEY = "labeltool:prefs";
const POINT_SIZE_MIN = 0.01;
const POINT_SIZE_MAX = 0.5;
const LAST_MANEUVER_FIELD = "lastManeuverType";
const LEGACY_LAST_MANOUVER_FIELD = "lastManouverType";
const FRONT_IMAGE_LAYOUT_FIELD = "frontImageLayout";
const validColorModes = new Set(["height", "intensity", "distance", "solid"]);
const validCurveTypes = new Set(["basis", "natural", "catmullrom"]);

const STORAGE_AVAILABLE = (() => {
  try {
    if (!("localStorage" in window)) return false;
    const testKey = "__lt_pref_test__";
    window.localStorage.setItem(testKey, "1");
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
})();

function clampPointSize(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return null;
  return Math.min(POINT_SIZE_MAX, Math.max(POINT_SIZE_MIN, v));
}

function clampAlpha(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return null;
  return Math.min(1, Math.max(0, v));
}

function loadPreferences() {
  if (!STORAGE_AVAILABLE) return {};
  try {
    const raw = window.localStorage.getItem(PREF_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    console.warn("Failed to parse stored preferences", err);
    return {};
  }
}

let cachedPrefs = loadPreferences();

function persistPreferences(patch) {
  if (!STORAGE_AVAILABLE || !patch || typeof patch !== "object") return;
  cachedPrefs = { ...cachedPrefs, ...patch };
  try {
    window.localStorage.setItem(PREF_KEY, JSON.stringify(cachedPrefs));
  } catch (err) {
    console.warn("Failed to persist preferences", err);
  }
}

function getPreferencesSnapshot() {
  return { ...cachedPrefs };
}

function getLastManeuver() {
  const value = cachedPrefs[LAST_MANEUVER_FIELD] ?? cachedPrefs[LEGACY_LAST_MANOUVER_FIELD];
  return typeof value === "string" && value.length ? value : null;
}

function setLastManeuver(key) {
  if (typeof key !== "string" || !key.length) {
    persistPreferences({ [LAST_MANEUVER_FIELD]: null, [LEGACY_LAST_MANOUVER_FIELD]: null });
    return;
  }
  persistPreferences({ [LAST_MANEUVER_FIELD]: key, [LEGACY_LAST_MANOUVER_FIELD]: key });
}

function sanitizeFrontImageLayout(layout) {
  if (!layout || typeof layout !== "object") return null;
  const toNum = (v) => (Number.isFinite(v) ? v : null);
  const x = toNum(layout.x);
  const y = toNum(layout.y);
  const width = toNum(layout.width);
  const height = toNum(layout.height);
  const visible = !!layout.visible;
  return { x, y, width, height, visible };
}

function getFrontImageLayout() {
  const value = sanitizeFrontImageLayout(cachedPrefs[FRONT_IMAGE_LAYOUT_FIELD]);
  if (!value) return { x: null, y: null, width: null, height: null, visible: false };
  return value;
}

function setFrontImageLayout(layout) {
  const cleaned = sanitizeFrontImageLayout(layout);
  if (!cleaned) return;
  persistPreferences({ [FRONT_IMAGE_LAYOUT_FIELD]: cleaned });
}

export {
  clampAlpha,
  clampPointSize,
  getLastManeuver,
  getFrontImageLayout,
  getPreferencesSnapshot,
  persistPreferences,
  setLastManeuver,
  setFrontImageLayout,
  validColorModes,
  validCurveTypes,
  loadPreferences
};
