// 手机端镜头与变焦的纯计算部分（可在 Node 里单测，不碰 DOM / 摄像头）

/** 数码变焦的取景框：从原始帧中心裁一块，再缩放到输出尺寸 */
export function cropRect(vw, vh, zoom) {
  const w = Number(vw) || 0;
  const h = Number(vh) || 0;
  const z = clampZoom(zoom);
  if (!w || !h) return { sx: 0, sy: 0, sw: 0, sh: 0, zoom: z };
  const sw = w / z;
  const sh = h / z;
  return { sx: (w - sw) / 2, sy: (h - sh) / 2, sw, sh, zoom: z };
}

export function clampZoom(z) {
  const n = Number(z);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.max(1, Math.min(4, Math.round(n * 100) / 100));
}

/** 摄像头 track.getCapabilities().zoom → 可用的变焦区间；不支持返回 null */
export function zoomCapability(caps) {
  const z = caps && caps.zoom;
  if (!z || !Number.isFinite(z.min) || !Number.isFinite(z.max)) return null;
  if (z.max <= z.min) return null;
  return {
    min: Math.max(0.4, Math.round(z.min * 100) / 100),
    max: Math.min(8, Math.round(z.max * 100) / 100),
    step: Number.isFinite(z.step) && z.step > 0 ? z.step : 0.1,
  };
}

export function zoomLabel(v) {
  const n = Number(v) || 1;
  return (Math.round(n * 10) / 10).toFixed(1) + "×";
}

/** 设备列表里挑默认镜头：优先非前置，其次标签里带广角/超广角的 */
export function pickDefaultDevice(devices) {
  const list = (devices || []).filter((d) => d && d.kind === "videoinput");
  if (!list.length) return "";
  const back = list.filter((d) => !/front|user|前置/i.test(d.label || ""));
  const pool = back.length ? back : list;
  const wide = pool.filter((d) => /wide|ultra|广角|超广角|0\.5/i.test(d.label || ""));
  return (wide[0] || pool[0]).deviceId || "";
}

/** 依据变焦引擎算出送进模型的取景参数 */
export function viewport(vw, vh, engine, zoom) {
  if (engine === "native") return { sx: 0, sy: 0, sw: vw, sh: vh, zoom: 1, native: clampZoom(zoom) };
  const r = cropRect(vw, vh, zoom);
  return { sx: r.sx, sy: r.sy, sw: r.sw, sh: r.sh, zoom: r.zoom, native: 1 };
}
