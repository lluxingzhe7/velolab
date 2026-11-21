// MediaPipe PoseLandmarker 封装：把视频帧转成 fit.js 需要的骨架帧格式
import { FilesetResolver, PoseLandmarker } from "../vendor/mediapipe/vision_bundle.mjs";

const IDX = {
  left: { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27, heel: 29, toe: 31 },
  right: { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28, heel: 30, toe: 32 },
};

export const DEFAULT_WASM_BASE = "./vendor/mediapipe/wasm";
export const MODELS = {
  lite: "./vendor/mediapipe/models/pose_landmarker_lite.task",
  full: "./vendor/mediapipe/models/pose_landmarker_full.task",
};

function pick(lm, side, key, w, h) {
  const p = lm[IDX[side][key]];
  if (!p) return null;
  return { x: p.x * w, y: p.y * h, vis: p.visibility == null ? 1 : p.visibility };
}

/** 归一化关键点 -> 像素骨架帧 { t, left, right, mid, vis } */
export function poseToFrame(lm, t, w, h) {
  const mk = (side) => {
    const o = {};
    for (const key of Object.keys(IDX[side])) {
      const p = pick(lm, side, key, w, h);
      if (p) o[key] = p;
    }
    return o;
  };
  const left = mk("left");
  const right = mk("right");
  const nose = lm[0] ? { x: lm[0].x * w, y: lm[0].y * h, vis: lm[0].visibility ?? 1 } : null;
  const both = (a, b) => (a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a || b || null);
  return {
    t,
    left,
    right,
    mid: { shoulder: both(left.shoulder, right.shoulder), hip: both(left.hip, right.hip), nose },
    vis: {
      left: left.hip ? left.hip.vis : 0,
      right: right.hip ? right.hip.vis : 0,
    },
  };
}

/**
 * 创建姿态追踪器。优先 GPU，失败自动回退 CPU。
 * 返回 { detect(video, timestampMs), close() }
 */
export async function createPoseTracker(opts = {}) {
  const wasmBase = opts.wasmBase || DEFAULT_WASM_BASE;
  const modelPath = opts.modelPath || MODELS.lite;
  const fileset = await FilesetResolver.forVisionTasks(wasmBase);
  const base = { modelAssetPath: modelPath, delegate: "GPU" };
  const common = {
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputSegmentationMasks: false,
  };
  let landmarker;
  let delegate = "GPU";
  try {
    landmarker = await PoseLandmarker.createFromOptions(fileset, { ...common, baseOptions: base });
  } catch (err) {
    delegate = "CPU";
    landmarker = await PoseLandmarker.createFromOptions(fileset, {
      ...common,
      baseOptions: { ...base, delegate: "CPU" },
    });
  }
  let closed = false;
  return {
    delegate,
    detect(video, timestampMs) {
      if (closed) return null;
      const res = landmarker.detectForVideo(video, timestampMs);
      const lm = res && res.landmarks && res.landmarks[0];
      if (!lm) return null;
      return poseToFrame(lm, timestampMs, video.videoWidth || video.width, video.videoHeight || video.height);
    },
    close() {
      closed = true;
      try { landmarker.close(); } catch (e) { /* ignore */ }
    },
  };
}
