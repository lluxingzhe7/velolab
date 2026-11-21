// 姿态推理 Worker：MediaPipe 推理是同步阻塞的，放在主线程里会让画面卡住几百毫秒。
// 这里只做「收到 ImageBitmap -> 推理 -> 回传骨架关键点」，主线程永远不被堵。
import { createPoseTracker } from "./pose.js";

let tracker = null;
let initing = false;

function post(m) {
  try { self.postMessage(m); } catch (e) { /* ignore */ }
}

self.onmessage = async (ev) => {
  const m = ev.data || {};
  if (m.t === "init") {
    if (tracker || initing) return;
    initing = true;
    try {
      tracker = await createPoseTracker({ wasmBase: m.wasmBase, modelPath: m.modelPath });
      post({ t: "ready", delegate: tracker.delegate });
    } catch (err) {
      post({ t: "error", message: String((err && err.message) || err) });
    } finally {
      initing = false;
    }
    return;
  }
  if (m.t !== "frame") return;
  const bitmap = m.bitmap;
  if (!tracker || !bitmap) {
    if (bitmap && bitmap.close) bitmap.close();
    post({ t: "frame", id: m.id, frame: null, ms: 0 });
    return;
  }
  const t0 = performance.now();
  let frame = null;
  try { frame = tracker.detect(bitmap, m.ts || Math.round(performance.now())); } catch (err) { frame = null; }
  const ms = performance.now() - t0;
  // 缩略图坐标 -> 原始像素坐标
  const s = m.w && bitmap.width ? m.w / bitmap.width : 1;
  if (frame && s && s !== 1) {
    for (const side of ["left", "right"]) {
      const o = frame[side];
      if (!o) continue;
      for (const key of Object.keys(o)) {
        const p = o[key];
        if (p) { p.x *= s; p.y *= s; }
      }
    }
    if (frame.mid) {
      for (const key of Object.keys(frame.mid)) {
        const p = frame.mid[key];
        if (p) { p.x *= s; p.y *= s; }
      }
    }
  }
  if (bitmap.close) bitmap.close();
  post({ t: "frame", id: m.id, frame, ms });
};
