// src/pcdParser.js
export function parsePointCloud(arrayBuffer, filename = "") {
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "pcd") return parsePCD(arrayBuffer);
  if (ext === "bin") return parseKittiBIN(arrayBuffer);
  // Try PCD header detection as fallback
  const head = new TextDecoder().decode(arrayBuffer.slice(0, 256));
  if (/^#?\s*version/im.test(head) || /\bFIELDS\b/im.test(head)) return parsePCD(arrayBuffer);
  // Otherwise assume KITTI .bin
  return parseKittiBIN(arrayBuffer);
}

// --- KITTI .bin: float32 x y z [intensity] ---
export function parseKittiBIN(arrayBuffer) {
  const f32 = new Float32Array(arrayBuffer);
  if (f32.length < 3) throw new Error("BIN too small");

  // Heuristic: prefer XYZ[I] stride 4, but handle XYZ (stride 3)
  const hasI = (f32.length % 4 === 0) || (f32.length % 3 !== 0);
  const strideIn = hasI ? 4 : 3;
  const n = Math.floor(f32.length / strideIn);

  const out = new Float32Array(n * (hasI ? 4 : 3));
  let imin = Infinity, imax = -Infinity;

  for (let i = 0; i < n; i++) {
    const si = i * strideIn;
    const di = i * (hasI ? 4 : 3);
    out[di + 0] = f32[si + 0]; // x
    out[di + 1] = f32[si + 1]; // y
    out[di + 2] = f32[si + 2]; // z
    if (hasI) {
      const val = f32[si + 3];
      out[di + 3] = val;
      if (val < imin) imin = val;
      if (val > imax) imax = val;
    }
  }

  const fields = hasI ? ["x","y","z","intensity"] : ["x","y","z"];
  const xyzIdx = { x:0, y:1, z:2, i: hasI ? 3 : -1 };
  return { points: out, fields, xyzIdx, count: n };
}

// --- Existing PCD parser (unchanged) ---
export function parsePCD(arrayBuffer) {
  const headText = new TextDecoder().decode(arrayBuffer.slice(0, Math.min(arrayBuffer.byteLength, 1<<20)));
  const lines = headText.split(/\r?\n/);
  let h = {}, headerLenBytes = 0, seenData = false;
  for (const line of lines) {
    headerLenBytes += line.length + 1;
    const ln = line.trim();
    if (!ln || ln.startsWith("#")) continue;
    const [k, ...rest] = ln.split(/\s+/);
    const key = k?.toUpperCase();
    const v = rest.join(" ");
    h[key] = v;
    if (key === "DATA") { seenData = true; break; }
  }
  if (!seenData) throw new Error("PCD: DATA line not found");

  const fields = (h.FIELDS || h.FIELD || "x y z").trim().split(/\s+/);
  const size = (h.SIZE || "").trim().split(/\s+/).map(Number);
  const type = (h.TYPE || "").trim().split(/\s+/);
  const count = (h.COUNT || "").trim() ? h.COUNT.trim().split(/\s+/).map(Number) : fields.map(_ => 1);
  const width = +(h.WIDTH || 0);
  const height = +(h.HEIGHT || 1);
  const pointsCount = +(h.POINTS || (width * height));
  const dataMode = (h.DATA || "").toLowerCase();

  const idx = {
    x: fields.indexOf("x"),
    y: fields.indexOf("y"),
    z: fields.indexOf("z"),
    i: fields.indexOf("intensity"),
  };
  if (idx.x < 0 || idx.y < 0 || idx.z < 0) {
    throw new Error(`PCD missing x/y/z fields. Found: ${fields.join(", ")}`);
  }

  if (dataMode.startsWith("ascii")) {
    const body = new TextDecoder().decode(arrayBuffer.slice(headerLenBytes)).trim();
    const linesB = body.split(/\r?\n/);
    const hasI = idx.i >= 0;
    const out = new Float32Array(pointsCount * (hasI ? 4 : 3));
    let k = 0;
    for (let li=0; li<linesB.length && k<out.length; li++) {
      const parts = linesB[li].trim().split(/\s+/);
      if (parts.length < fields.length) continue;
      out[k++] = parseFloat(parts[idx.x]);
      out[k++] = parseFloat(parts[idx.y]);
      out[k++] = parseFloat(parts[idx.z]);
      if (hasI) out[k++] = parseFloat(parts[idx.i]);
    }
    return { points: out, fields, xyzIdx: idx, count: Math.floor(k / (hasI?4:3)) };
  }

  if (dataMode.startsWith("binary")) {
    let fieldOffsets = []; let stride = 0;
    for (let fi=0; fi<fields.length; fi++) {
      fieldOffsets.push(stride);
      stride += (size[fi] * (count[fi] || 1));
    }
    const view = new DataView(arrayBuffer, headerLenBytes);
    const hasI = idx.i >= 0;
    const out = new Float32Array(pointsCount * (hasI?4:3));
    let k=0;
    for (let p=0; p<pointsCount; p++) {
      const base = p * stride;
      out[k++] = view.getFloat32(base + fieldOffsets[idx.x], true);
      out[k++] = view.getFloat32(base + fieldOffsets[idx.y], true);
      out[k++] = view.getFloat32(base + fieldOffsets[idx.z], true);
      if (hasI) {
        if (size[idx.i] === 4 && (type[idx.i]||'F').toUpperCase() === 'F') {
          out[k++] = view.getFloat32(base + fieldOffsets[idx.i], true);
        } else {
          out[k++] = view.getUint8(base + fieldOffsets[idx.i]);
        }
      }
    }
    return { points: out, fields, xyzIdx: idx, count: pointsCount };
  }

  if (dataMode.includes("binary_compressed")) {
    throw new Error("PCD DATA binary_compressed not supported yet.");
  }
  throw new Error(`Unsupported PCD DATA mode: ${dataMode}`);
}
