// 视频文件分析：把一段侧面拍摄的视频抽帧跑姿态识别，产出与摄像头采样同格式的骨架帧
import { createPoseTracker } from "./pose.js";

function seekTo(video, time) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; video.removeEventListener("seeked", finish); resolve(); } };
    video.addEventListener("seeked", finish);
    try { video.currentTime = time; } catch (e) { finish(); }
    setTimeout(finish, 900);
  });
}

/**
 * 逐帧分析视频文件
 * @param {File|Blob} file
 * @param {object} opts { tracker, fps, maxSeconds, onProgress, onFrame }
 * @returns {Promise<{frames:Array, duration:number, analysed:number}>}
 */
export async function analyzeVideoFile(file, opts = {}) {
  const fps = opts.fps || 12;
  const maxSeconds = opts.maxSeconds || 90;
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error("这个视频浏览器解不开，试试 mp4（H.264）"));
      setTimeout(() => reject(new Error("读取视频超时")), 12000);
    });
    const duration = Math.min(video.duration || 0, maxSeconds);
    if (!duration || !Number.isFinite(duration)) throw new Error("视频时长不可用");
    const tracker = opts.tracker || (await createPoseTracker({}));
    const frames = [];
    const step = 1 / fps;
    let analysed = 0;
    for (let t = 0; t < duration - step / 2; t += step) {
      await seekTo(video, t);
      const ts = Math.round(t * 1000) + 1;
      analysed += 1;
      let frame = null;
      try { frame = tracker.detect(video, ts); } catch (e) { frame = null; }
      if (frame) {
        frames.push(frame);
        if (opts.onFrame) opts.onFrame(frame, t);
      }
      if (opts.onProgress) opts.onProgress(Math.min(1, (t + step) / duration));
    }
    return { frames, duration, analysed };
  } finally {
    URL.revokeObjectURL(url);
    video.src = "";
  }
}
