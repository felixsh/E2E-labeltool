// src/pcdParser.js
export function parsePCD(arrayBuffer){
  const headText = new TextDecoder().decode(arrayBuffer.slice(0, Math.min(arrayBuffer.byteLength, 1<<20)));
  const lines = headText.split(/\r?\n/);
  let h={}, headerLenBytes=0, seen=false;
  for (const line of lines){
    headerLenBytes += line.length+1;
    const ln=line.trim(); if (!ln || ln.startsWith("#")) continue;
    const [k, ...rest]=ln.split(/\s+/); const key=k?.toUpperCase(); const v=rest.join(" ");
    h[key]=v; if (key==="DATA"){ seen=true; break; }
  }
  if (!seen) throw new Error("PCD: DATA line not found");

  const fields=(h.FIELDS||h.FIELD||"x y z").trim().split(/\s+/);
  const size=(h.SIZE||"").trim().split(/\s+/).map(Number);
  const type=(h.TYPE||"").trim().split(/\s+/);
  const count=(h.COUNT||"").trim()? h.COUNT.trim().split(/\s+/).map(Number) : fields.map(_=>1);
  const width=+(h.WIDTH||0), height=+(h.HEIGHT||1);
  const pointsCount=+(h.POINTS || (width*height));
  const dataMode=(h.DATA||"").toLowerCase();
  const idx={ x:fields.indexOf("x"), y:fields.indexOf("y"), z:fields.indexOf("z"), i:fields.indexOf("intensity") };
  if (idx.x<0||idx.y<0||idx.z<0) throw new Error(`PCD missing x/y/z fields. Found: ${fields.join(", ")}`);

  if (dataMode.startsWith("ascii")){
    const body=new TextDecoder().decode(arrayBuffer.slice(headerLenBytes)).trim();
    const linesB=body.split(/\r?\n/);
    const hasI=idx.i>=0; const out=new Float32Array(pointsCount*(hasI?4:3)); let k=0;
    for (let li=0; li<linesB.length && k<out.length; li++){
      const parts=linesB[li].trim().split(/\s+/); if (parts.length<fields.length) continue;
      out[k++]=parseFloat(parts[idx.x]); out[k++]=parseFloat(parts[idx.y]); out[k++]=parseFloat(parts[idx.z]);
      if (hasI) out[k++]=parseFloat(parts[idx.i]);
    }
    return { points:out, fields, xyzIdx:idx, count:Math.floor(k/(hasI?4:3)) };
  }

  if (dataMode.startsWith("binary")){
    let fieldOffsets=[], stride=0;
    for (let fi=0;fi<fields.length;fi++){ fieldOffsets.push(stride); stride += (size[fi]*(count[fi]||1)); }
    const view=new DataView(arrayBuffer, headerLenBytes);
    const hasI=idx.i>=0; const out=new Float32Array(pointsCount*(hasI?4:3)); let k=0;
    for (let p=0;p<pointsCount;p++){
      const base=p*stride;
      out[k++]=view.getFloat32(base+fieldOffsets[idx.x], true);
      out[k++]=view.getFloat32(base+fieldOffsets[idx.y], true);
      out[k++]=view.getFloat32(base+fieldOffsets[idx.z], true);
      if (hasI){
        if (size[idx.i]===4 && (type[idx.i]||'F').toUpperCase()==='F') out[k++]=view.getFloat32(base+fieldOffsets[idx.i], true);
        else out[k++]=view.getUint8(base+fieldOffsets[idx.i]);
      }
    }
    return { points:out, fields, xyzIdx:idx, count:pointsCount };
  }

  if (dataMode.includes("binary_compressed")) throw new Error("PCD DATA binary_compressed not supported yet.");
  throw new Error(`Unsupported PCD DATA mode: ${dataMode}`);
}

export function computeBounds(arr, idx){
  const dim = idx.i>=0 ? 4 : 3;
  let xmin=Infinity,xmax=-Infinity,ymin=Infinity,ymax=-Infinity,zmin=Infinity,zmax=-Infinity;
  for (let k=0;k<arr.length;k+=dim){
    const x=arr[k], y=arr[k+1], z=arr[k+2];
    if (x<xmin) xmin=x; if (x>xmax) xmax=x;
    if (y<ymin) ymin=y; if (y>ymax) ymax=y;
    if (z<zmin) zmin=z; if (z>zmax) zmax=z;
  }
  return { xmin,xmax,ymin,ymax,zmin,zmax };
}
