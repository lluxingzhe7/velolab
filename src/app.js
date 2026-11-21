// bikefit/src/app.js —— 界面逻辑：演示/摄像头采样、测量、建议、导出
import {
  DISCIPLINES, POSITIONS, DEFAULT_RIDER, DEFAULT_BIKE,
  measureFrames, chooseSide, recommend, summarize, reportMarkdown, baselineSetup, targetsFor,
} from "./fit.js";
import { createPoseTracker, MODELS } from "./pose.js";
import { drawSkeleton, drawDemoScene, drawHud } from "./render.js";
import { demoContext, demoFrames, demoFrame } from "./demo.js";
import { angleAtDeg, angleFromHorizontalDeg } from "./geometry.js";
import { JOINTS, emptyPhoto, setPoint, undoPoint, nextJoint, missingRequired, photoMeas, photoAngles } from "./photo.js";
import { PAIN_AREAS, diagnoseAll } from "./pain.js";
import * as hist from "./history.js";
import { analyzeVideoFile } from "./video.js";
import { createLiveLink, fetchShareInfo } from "./live.js";
import { TIPS } from "./tips.js";

const STORE_KEY = "bikefit.state.v2";
const RECORD_MS = 7000;
// 手机联动第一次判定的门槛：30 帧（检测限速约 4–5 次/秒 ⇒ 6–8 秒出第一份结果）
const LIVE_MIN_FRAMES = 30;

const state = {
  mode: "demo",
  rider: { ...DEFAULT_RIDER },
  bike: { type: "road", ...DEFAULT_BIKE },
  demo: { saddle: 0, torso: 0, speed: 85 },
  recording: false,
  recordEnds: 0,
  frames: [],
  meas: null,
  res: null,
  tracker: null,
  stream: null,
  lastFrame: null,
  phase: 0,
  lastTs: 0,
  message: "",
  photo: emptyPhoto(),
  photoImg: null,
  photoSrc: null,
  pain: [],
  trendKey: "knee",
  videoFile: null,
  live: null,
  liveFrames: [],
  liveAt: 0,
  liveCad: 0,
};

const el = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
const num = (v, d) => (Number.isFinite(v) ? Number(v).toFixed(d == null ? 1 : d) : "—");
const FLEX_TEXT = [
  "",
  "僵硬：指尖离脚尖还有 10cm 以上",
  "偏紧：指尖距脚尖 0–10cm",
  "一般：指尖刚好碰到脚尖",
  "较好：指根碰到脚尖",
  "柔韧：掌心贴地、胸口近大腿",
];
const FLEX_HINT = "自测：坐地双腿伸直、手掌叠放缓慢前屈 —— ";

/** 车辆里留空的字段，按身体数据补一个估算值 */
function bikeEff() {
  const b = baselineSetup(state.rider);
  const est = {
    frameStack: 560, frameReach: 385, stemAngle: -6, spacers: 20, barReach: 80,
    stemLength: b.stemLength,
    saddleHeight: Math.round(b.saddleHeight),
    saddleSetback: Math.round(b.setback),
    crankLength: b.crank,
    barDrop: Math.round(b.barDrop),
    padStack: Math.round(b.padStack),
    padReach: Math.round(b.padReach),
  };
  const out = Object.assign({}, state.bike);
  for (const k of Object.keys(est)) {
    const raw = state.bike[k];
    const blank = raw === null || raw === undefined || String(raw).trim() === "";
    const v = Number(raw);
    out[k] = blank || !Number.isFinite(v) ? est[k] : v;
  }
  out.type = state.bike.type || state.rider.discipline || "road";
  return out;
}

function bikeIsBlank(key) {
  const v = state.bike[key];
  return v === null || v === undefined || v === "";
}

/* ---------------- 持久化 ---------------- */
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ rider: state.rider, bike: state.bike, demo: state.demo }));
  } catch (e) { /* 忽略隐私模式失败 */ }
}
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (d.rider) Object.assign(state.rider, d.rider);
    if (d.bike) Object.assign(state.bike, d.bike);
    if (d.demo) Object.assign(state.demo, d.demo);
  } catch (e) { /* 忽略损坏数据 */ }
  if (!state.bike.type) state.bike.type = "road";
}

/* ---------------- 表单 ---------------- */
function fillSelects() {
  const dSel = document.querySelector("[data-rider=discipline]");
  dSel.innerHTML = Object.keys(DISCIPLINES).map((k) => '<option value="' + k + '">' + esc(DISCIPLINES[k]) + "</option>").join("");
  fillPositions();
}
function fillPositions() {
  const pSel = document.querySelector("[data-rider=position]");
  const d = state.rider.discipline;
  const list = POSITIONS[d] || {};
  pSel.innerHTML = Object.keys(list).map((k) => '<option value="' + k + '">' + esc(list[k]) + "</option>").join("");
  if (!list[state.rider.position]) state.rider.position = Object.keys(list)[1] || Object.keys(list)[0];
  pSel.value = state.rider.position;
}
function fmtEst(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return Math.abs(n - Math.round(n)) > 0.01 ? n.toFixed(1) : String(Math.round(n));
}

function syncInputs() {
  document.querySelectorAll("[data-rider]").forEach((input) => {
    const k = input.getAttribute("data-rider");
    if (input.tagName === "SELECT") input.value = state.rider[k];
    else input.value = state.rider[k];
  });
  const eff = bikeEff();
  document.querySelectorAll("[data-bike]").forEach((input) => {
    const k = input.getAttribute("data-bike");
    const blank = bikeIsBlank(k);
    if (input.tagName === "SELECT") { input.value = state.bike[k] || ""; return; }
    input.value = blank ? "" : state.bike[k];
    input.classList.toggle("est", blank && k !== "stemAngle");
    if (blank) input.placeholder = "估算 " + fmtEst(eff[k]);
  });
  const fv = el("flex-val");
  if (fv) fv.textContent = state.rider.flexibility + " / 5";
  const fd = el("flex-desc");
  if (fd) fd.textContent = FLEX_HINT + (FLEX_TEXT[state.rider.flexibility] || "");
  const ss = el("demo-saddle");
  if (ss) ss.value = state.demo.saddle;
  const st = el("demo-torso");
  if (st) st.value = state.demo.torso;
  const sv = el("demo-saddle-val");
  if (sv) sv.textContent = (state.demo.saddle > 0 ? "+" : "") + state.demo.saddle + " mm";
  const tv = el("demo-torso-val");
  if (tv) tv.textContent = (state.demo.torso > 0 ? "+" : "") + state.demo.torso + "°";
  const sum = {
    "sum-saddle": [eff.saddleHeight, 0],
    "sum-setback": [eff.saddleSetback, 0],
    "sum-crank": [eff.crankLength, 1],
    "sum-stem": [eff.stemLength, 0],
    "sum-spacers": [eff.spacers, 0],
    "sum-drop": [eff.barDrop, 0],
  };
  for (const id of Object.keys(sum)) {
    const node = el(id);
    if (!node) continue;
    const v = Number(sum[id][0]);
    node.textContent = Number.isFinite(v) ? v.toFixed(sum[id][1]) : "—";
  }
  const tri = (state.bike.type || state.rider.discipline) === "tri";
  const fsTri = el("fs-tri");
  if (fsTri) fsTri.style.display = tri ? "block" : "none";
}

function bindForms() {
  document.querySelectorAll("[data-rider]").forEach((input) => {
    input.addEventListener("input", () => {
      const k = input.getAttribute("data-rider");
      const v = input.tagName === "SELECT" || k === "discipline" || k === "position" ? input.value : Number(input.value);
      state.rider[k] = v;
      if (k === "discipline") {
        fillPositions();
        state.bike.type = v === "tri" ? "tri" : "road";
        syncInputs();
      }
      if (k === "flexibility") {
        const fv = el("flex-val");
        if (fv) fv.textContent = v + " / 5";
        const fd = el("flex-desc");
        if (fd) fd.textContent = FLEX_HINT + (FLEX_TEXT[v] || "");
        syncInputs();
      }
      save();
    });
  });
  document.querySelectorAll("[data-bike]").forEach((input) => {
    input.addEventListener("input", () => {
      const k = input.getAttribute("data-bike");
      if (input.tagName === "SELECT") {
        state.bike[k] = input.value;
        if (k === "type") {
          state.rider.discipline = input.value === "tri" ? "tri" : "road";
          fillPositions();
          syncInputs();
        }
      } else {
        const raw = String(input.value).trim();
        state.bike[k] = raw === "" ? null : Number(raw);
        const blank = raw === "";
        input.classList.toggle("est", blank && k !== "stemAngle");
        if (blank) input.placeholder = "估算 " + fmtEst(bikeEff()[k]);
        const eff = bikeEff();
        const map = { saddleHeight: ["sum-saddle", 0], saddleSetback: ["sum-setback", 0], crankLength: ["sum-crank", 1], stemLength: ["sum-stem", 0], spacers: ["sum-spacers", 0], barDrop: ["sum-drop", 0] };
        const m = map[k];
        if (m && el(m[0])) el(m[0]).textContent = Number(eff[k]).toFixed(m[1]);
        if (state.res) renderReport();
      }
      save();
    });
  });
  const ss = el("demo-saddle");
  if (ss) ss.addEventListener("input", () => { state.demo.saddle = Number(ss.value); syncInputs(); save(); });
  const st = el("demo-torso");
  if (st) st.addEventListener("input", () => { state.demo.torso = Number(st.value); syncInputs(); save(); });
}

/* ---------------- 画布布局 ---------------- */
function stageInner() { return document.querySelector(".stage-inner"); }

function dprNow() {
  const d = typeof window !== "undefined" && window.devicePixelRatio ? window.devicePixelRatio : 1;
  return Math.min(2, Math.max(1, d));
}

function layoutCanvas(mode) {
  const canvas = el("overlay");
  const video = el("video");
  const box = stageInner();
  const rect = box.getBoundingClientRect();
  const dpr = dprNow();
  if (mode === "camera" && video.videoWidth) {
    const k = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight);
    const w = Math.round(video.videoWidth * k);
    const h = Math.round(video.videoHeight * k);
    for (const node of [canvas, video]) {
      node.style.width = w + "px";
      node.style.height = h + "px";
      node.style.left = Math.round((rect.width - w) / 2) + "px";
      node.style.top = Math.round((rect.height - h) / 2) + "px";
      node.style.right = "auto";
      node.style.bottom = "auto";
    }
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    canvas.__dpr = 1;
    canvas.style.transform = "scaleX(-1)";
  } else {
    for (const node of [canvas, video]) {
      node.style.width = "100%";
      node.style.height = "100%";
      node.style.left = "0px";
      node.style.top = "0px";
      node.style.right = "auto";
      node.style.bottom = "auto";
    }
    canvas.style.transform = "none";
    const w = Math.round((rect.width || 1240) * dpr);
    const h = Math.round((rect.height || 740) * dpr);
    canvas.__dpr = dpr;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }
}

/** 按 dpr 建立坐标系，返回逻辑宽高（CSS 像素） */
function beginDraw(canvas) {
  const g = canvas.getContext("2d");
  const dpr = canvas.__dpr || 1;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w: canvas.width / dpr, h: canvas.height / dpr, dpr };
}

function demoCtx(canvas) {
  const w = canvas.width || 1240;
  const h = canvas.height || 740;
  // 整车 + 骑手约 1750mm 长、1680mm 高（含头顶），留 10% 边距按视口等比缩放
  const s = Math.min((w * 0.82) / 1750, (h * 0.78) / 1680);
  return demoContext(state.rider, bikeEff(), { saddle: state.demo.saddle, torso: state.demo.torso }, {
    origin: { x: w * 0.5 - 120 * s, y: h * 0.9 },
    scale: s,
  });
}

/* ---------------- 实时角度 ---------------- */
function liveAngles(frame) {
  if (!frame) return null;
  const side = chooseSide([frame]);
  const s = frame[side];
  if (!s || !s.hip || !s.knee || !s.ankle) return null;
  const fwd = Math.sign(((frame.mid && frame.mid.shoulder) || s.shoulder).x - ((frame.mid && frame.mid.hip) || s.hip).x) || 1;
  return {
    side,
    knee: 180 - angleAtDeg(s.hip, s.knee, s.ankle),
    hip: angleAtDeg(s.shoulder, s.hip, s.knee),
    torso: angleFromHorizontalDeg(s.hip, s.shoulder, fwd),
  };
}

/* ---------------- 实时 HUD（HTML 卡片） ---------------- */
function bandStatus(v, range) {
  if (!Number.isFinite(v) || !range || !Number.isFinite(range[0])) return "na";
  if (v < range[0]) return "low";
  if (v > range[1]) return "high";
  return "ok";
}
function hudSet(id, v, digits) {
  const n = el(id);
  if (n) n.textContent = Number.isFinite(v) ? Number(v).toFixed(digits == null ? 1 : digits) : "—";
}
function hudCard(id, status) {
  const c = el(id);
  if (!c || !c.classList) return;
  c.classList.remove("ok", "warn", "bad");
  if (status === "ok") c.classList.add("ok");
  else if (status === "high" || status === "low") c.classList.add("warn");
}
function targetLine(id, range, unit, prefix) {
  const n = el(id);
  if (!n) return;
  n.textContent = range && Number.isFinite(range[0])
    ? (prefix || "目标 ") + range[0] + "–" + range[1] + unit
    : "目标 —";
}
function hudBand(bandId, v, range, pad) {
  const box = el(bandId);
  if (!box || !box.querySelector) return;
  const fill = box.querySelector("i");
  const mark = box.querySelector("u");
  const lo = Array.isArray(range) ? range[0] : NaN;
  const hi = Array.isArray(range) ? range[1] : NaN;
  if (!fill || !mark || !Number.isFinite(lo) || !Number.isFinite(hi)) {
    if (fill) fill.style.display = "none";
    if (mark) mark.style.display = "none";
    return;
  }
  const p = pad == null ? Math.max(8, (hi - lo) * 0.7) : pad;
  const d0 = lo - p;
  const d1 = hi + p;
  const pos = (x) => Math.max(0, Math.min(1, (x - d0) / (d1 - d0))) * 100;
  fill.style.display = "block";
  mark.style.display = "block";
  fill.style.left = pos(lo) + "%";
  fill.style.width = (pos(hi) - pos(lo)) + "%";
  mark.style.left = Number.isFinite(v) ? pos(v) + "%" : "0%";
}
function setLinkState(on, text) {
  const box = el("link-state");
  if (!box) return;
  box.classList.toggle("on", !!on);
  const s = box.querySelector("span");
  if (s) s.textContent = text;
}
function updateHud(frame) {
  const a = liveAngles(frame);
  const t = targetsFor(state.rider);
  hudSet("hud-knee", a ? a.knee : NaN, 1);
  hudSet("hud-hip", a ? a.hip : NaN, 1);
  hudSet("hud-torso", a ? a.torso : NaN, 1);
  hudCard("hud-knee-card", "na");
  hudCard("hud-hip-card", "na");
  hudCard("hud-torso-card", a ? bandStatus(a.torso, t.torso) : "na");
  hudBand("hud-knee-band", a ? a.knee : NaN, t.knee);
  hudBand("hud-hip-band", a ? a.hip : NaN, t.hipBdc);
  hudBand("hud-torso-band", a ? a.torso : NaN, t.torso);
  targetLine("hud-knee-t", t.knee, "°", "目标（下死点）");
  targetLine("hud-hip-t", t.hipBdc, "°", "目标（下死点）");
  targetLine("hud-torso-t", t.torso, "°", "");
  const side = el("hud-side");
  if (side) side.textContent = a ? "采样侧 " + (a.side === "left" ? "左" : "右") : "采样侧 —";
  const cad = el("hud-cad");
  if (cad) cad.textContent = "踏频 " + (state.liveCad ? Math.round(state.liveCad) : Number(state.rider.cadence) || 85) + " rpm";
}

function drawLive(g, canvas, frame) {
  updateHud(frame);
}

/* ---------------- 手机联动 ---------------- */
/* 性能策略（卡顿根因：MediaPipe 推理是同步的，堵在主线程里一次就是几百毫秒）
   1) 收帧只保留「最新一帧」，处理不过来就丢旧帧，永不排队
   2) 画面每帧立刻画（解码 + drawImage，几毫秒）
   3) 推理丢进 Web Worker，主线程只负责画图，推理再慢也不卡画面
   4) 检测限速 + 在飞帧数上限；只把 480px 缩略图送进模型
   5) Worker 不可用时退回主线程，并按实测耗时降频（占用约 ≤50%）
   6) 布局不必每帧算，400ms 复核一次 */
let phoneCanvas = null;        // 检测用的缩略画布
let phonePumping = false;
const phonePerf = { recv: 0, drawn: 0, detect: 0, drawTotal: 0, detTotal: 0, maxDraw: 0, maxDet: 0 };
if (typeof window !== "undefined") window.__phonePerf = phonePerf;
let phoneLayoutAt = 0;
const PHONE_DET_MAX_W = 480;
const POSE_MIN_GAP = 60;          // 两次检测最小间隔（推理快时可以到 ~16Hz）
const POSE_MAX_INFLIGHT = 2;      // worker 排队上限，超过就跳过本次
let poseWorker = null;
let poseWorkerReady = false;
let poseWorkerDead = false;
let poseInFlight = 0;
let poseSentAt = 0;
let poseSeq = 0;
let poseCostEma = 0;

let liveProgressAt = 0;

function onPhoneFrame(blob) {
  phonePerf.recv += 1;
  // 手机一开推流就自动切到「手机联动」视图：电脑页面开着就行，不用先点模式按钮
  if (state.mode !== "phone") {
    try { setMode("phone"); } catch (e) { /* 忽略：DOM 桩环境 */ }
  }
  state.liveCount = (state.liveCount || 0) + 1;
  state.liveLast = performance.now();
  if (state.liveCount === 1) setStatus("已收到手机画面，正在识别骑手姿态…");
  if (performance.now() - liveProgressAt > 500) { liveProgressAt = performance.now(); updateLiveProgress(); }
  state.phoneBlob = blob;          // 只留最新一帧
  if (!phonePumping) pumpPhone();
}

async function pumpPhone() {
  phonePumping = true;
  try {
    while (state.phoneBlob) {
      const blob = state.phoneBlob;
      state.phoneBlob = null;
      await drawPhoneFrame(blob);
    }
  } finally {
    phonePumping = false;
  }
}

function scaleFrameInPlace(frame, s) {
  if (!(s > 0) || s === 1) return frame;
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
  return frame;
}

/* ---- 姿态检测：优先 Worker，失败退回主线程 ---- */
function ensurePoseWorker() {
  if (poseWorker || poseWorkerDead) return poseWorker;
  if (typeof Worker !== "function") { poseWorkerDead = true; return null; }
  try {
    poseWorker = new Worker(new URL("./pose-worker.js", import.meta.url), { type: "module" });
  } catch (e) {
    poseWorkerDead = true;
    poseWorker = null;
    return null;
  }
  poseWorker.onmessage = (ev) => onPoseMessage(ev.data || {});
  poseWorker.onerror = () => { poseWorkerDead = true; poseWorkerReady = false; ensureFallbackTracker(); };
  poseWorker.postMessage({
    t: "init",
    wasmBase: new URL("./vendor/mediapipe/wasm", location.href).href,
    modelPath: new URL("./vendor/mediapipe/models/pose_landmarker_lite.task", location.href).href,
  });
  return poseWorker;
}

/* Worker 不可用时的兜底：主线程加载模型（会慢一点，但功能不丢） */
function ensureFallbackTracker() {
  if (state.tracker || state.trackerLoading) return;
  state.trackerLoading = true;
  setStatus("Worker 不可用，改用本机推理加载模型…");
  createPoseTracker({})
    .then((t) => { state.tracker = t; state.trackerLoading = false; })
    .catch((e) => {
      state.trackerLoading = false;
      setStatus("姿态模型加载失败：" + (e && e.message ? e.message : e));
    });
}

function recordPoseCost(ms) {
  phonePerf.detect += 1;
  phonePerf.detTotal += ms || 0;
  if ((ms || 0) > phonePerf.maxDet) phonePerf.maxDet = ms;
  poseCostEma = poseCostEma ? poseCostEma * 0.7 + (ms || 0) * 0.3 : (ms || 0);
}

function onPoseMessage(m) {
  if (m.t === "ready") { poseWorkerReady = true; return; }
  if (m.t === "error") { poseWorkerDead = true; poseWorkerReady = false; ensureFallbackTracker(); return; }
  if (m.t !== "frame") return;
  poseInFlight = Math.max(0, poseInFlight - 1);
  recordPoseCost(m.ms);
  applyPhoneFrame(m.frame || null);
}

async function requestPose(bmp, pw, ph) {
  const now = performance.now();
  const gap = Math.max(POSE_MIN_GAP, poseCostEma * 1.3);
  if (now - poseSentAt < gap) return;

  const w = ensurePoseWorker();
  if (w && poseWorkerReady) {
    if (poseInFlight >= POSE_MAX_INFLIGHT) return;
    poseSentAt = now;
    const s = Math.min(1, PHONE_DET_MAX_W / pw);
    const dw = Math.max(2, Math.round(pw * s));
    const dh = Math.max(2, Math.round(ph * s));
    if (!phoneCanvas) phoneCanvas = document.createElement("canvas");
    if (phoneCanvas.width !== dw || phoneCanvas.height !== dh) {
      phoneCanvas.width = dw;
      phoneCanvas.height = dh;
    }
    const pg = phoneCanvas.getContext("2d");
    if (!pg) return;
    pg.drawImage(bmp, 0, 0, dw, dh);
    createImageBitmap(phoneCanvas).then((small) => {
      if (!poseWorker) { if (small.close) small.close(); return; }
      poseInFlight += 1;
      poseSeq += 1;
      poseWorker.postMessage(
        { t: "frame", id: poseSeq, bitmap: small, ts: Math.round(performance.now()), w: pw, h: ph },
        [small],
      );
    }).catch(() => {});
    return;
  }

  // 回退：主线程同步推理，按实测耗时降频，保证主线程占用不至于 100%
  if (!state.tracker) return;
  poseSentAt = now;
  if (!phoneCanvas) phoneCanvas = document.createElement("canvas");
  const s = Math.min(1, PHONE_DET_MAX_W / pw);
  const dw = Math.max(2, Math.round(pw * s));
  const dh = Math.max(2, Math.round(ph * s));
  if (phoneCanvas.width !== dw || phoneCanvas.height !== dh) {
    phoneCanvas.width = dw;
    phoneCanvas.height = dh;
  }
  const pg = phoneCanvas.getContext("2d");
  if (!pg) return;
  pg.drawImage(bmp, 0, 0, dw, dh);
  const t1 = performance.now();
  let frame = null;
  try { frame = state.tracker.detect(phoneCanvas, Math.round(performance.now())); } catch (e) { frame = null; }
  recordPoseCost(performance.now() - t1);
  if (frame) frame = scaleFrameInPlace(frame, pw / dw);
  applyPhoneFrame(frame);
}

/* 识别质量提示：看不见人/看不清时明确告诉用户该怎么摆，比一直显示「—」有用 */
let poseHintAt = 0;
function notePoseVisibility(frame) {
  const now = performance.now();
  if (now - poseHintAt < 3500) return;
  if (!frame) {
    poseHintAt = now;
    setStatus("识别不到骑手：整车放进画面、人与车保持侧面、光线足一点");
    return;
  }
  const vis = Math.max((frame.vis && frame.vis.left) || 0, (frame.vis && frame.vis.right) || 0);
  if (vis < 0.55) {
    poseHintAt = now;
    setStatus("能追到人，但关键点不够清楚：靠近一点、调亮，或让腿不被车架挡住");
  }
}

/** 用当前画面 + 最新骨架重绘（骨架比画面晚到，重绘一次即可，不产生残影） */
function applyPhoneFrame(frame) {
  const pv = state.phoneView;
  const canvas = el("overlay");
  notePoseVisibility(frame);
  if (!pv || !canvas) return;
  const view = beginDraw(canvas);
  const g = view.g;
  g.clearRect(0, 0, view.w, view.h);
  if (state.phoneBmp && g.drawImage) {
    g.drawImage(state.phoneBmp, pv.ox, pv.oy, pv.pw * pv.k, pv.ph * pv.k);
  }
  if (!frame) { updateHud(null); return; }
  g.save();
  g.translate(pv.ox, pv.oy);
  g.scale(pv.k, pv.k);
  drawSkeleton(g, frame, chooseSide([frame]), { color: "#c9f25c", width: 2.6 / pv.k });
  g.restore();
  state.lastFrame = frame;
  state.liveFrames.push(frame);
  if (state.liveFrames.length > 420) state.liveFrames.splice(0, state.liveFrames.length - 420);
  updateHud(frame);
  maybeLiveAnalyze();
}

async function drawPhoneFrame(blob) {
  const t0 = performance.now();
  let bmp = null;
  try { bmp = await createImageBitmap(blob); } catch (e) { return; }
  const pw = bmp.width, ph = bmp.height;
  const canvas = el("overlay");
  const now = performance.now();
  if (now - phoneLayoutAt > 400) { phoneLayoutAt = now; layoutCanvas("phone"); }
  const view = beginDraw(canvas);
  const g = view.g;
  const k = Math.min(view.w / pw, view.h / ph);
  const dw = pw * k, dh = ph * k;
  const ox = (view.w - dw) / 2, oy = (view.h - dh) / 2;
  g.clearRect(0, 0, view.w, view.h);
  if (g.drawImage) g.drawImage(bmp, ox, oy, dw, dh);

  // 保留这一帧给骨架叠加用
  if (state.phoneBmp && state.phoneBmp !== bmp && state.phoneBmp.close) state.phoneBmp.close();
  state.phoneBmp = bmp;
  state.phoneView = { ox, oy, k, pw, ph };

  phonePerf.drawn += 1;
  const drawMs = performance.now() - t0;
  phonePerf.drawTotal += drawMs;
  if (drawMs > phonePerf.maxDraw) phonePerf.maxDraw = drawMs;

  requestPose(bmp, pw, ph);
}

function maybeLiveAnalyze() {
  const now = performance.now();
  if (state.liveFrames.length < LIVE_MIN_FRAMES || now - state.liveAt < 2400) return;
  state.liveAt = now;
  const frames = state.liveFrames.slice(-260);
  const side = chooseSide(frames);
  const bike = bikeEff();
  const crank = Number(bike.crankLength) || 0;
  const pxPerMm = estimatePxPerMm(frames, side, crank);
  const meas = measureFrames(frames, { side, pxPerMm });
  if (!meas || meas.ok === false) {
    setStatus("实时：还没凑够可用的踩踏周期，请整车入镜、按正常踏频踩");
    updateLiveProgress();
    return;
  }
  const rec = recommend(meas, state.rider, bike);
  const res = summarize(meas, rec, state.rider, bike);
  state.meas = meas;
  state.res = res;
  state.liveCad = meas.cadence;
  state.liveMeas = { at: now, knee: meas.kneeFlexBdc, hip: meas.hipBdc, cadence: meas.cadence, strokes: meas.strokesFound };
  renderResult(res, meas);
  renderReport();
  updateLiveProgress();
  const first = (res.items || []).filter((i) => i.amount > 0)[0];
  const head = first ? first.action + " " + first.amount + first.unit : "保持";
  setStatus("实时建议：" + (first ? first.part + " " + head : "姿态良好") + " · 膝角 " + num(meas.kneeFlexBdc) + "° · 髋角 " + num(meas.hipBdc) + "°（结果页已更新，可保存为记录）");
  if (state.live && state.live.send) {
    state.live.send({ t: "hint", text: (first ? first.part + " " + head : "姿态良好") + "（膝 " + num(meas.kneeFlexBdc) + "°）" });
  }
}

/* 手机联动是自动的：不用点「开始采样」。这行文字告诉用户现在收到几帧、
   什么时候出下一次判定，避免对着灰按钮发呆。 */
function updateLiveProgress() {
  const box = el("live-progress");
  if (!box) return;
  if (!state.liveCount) { box.textContent = "等待手机画面…"; return; }
  const got = state.liveCount;
  const n = state.liveFrames.length;
  const rate = state.liveRate || 8;
  if (!n) {
    box.textContent = "已收 " + got + " 帧，但还没识别到骑手（整车入镜、正侧面、光线足一点）";
    return;
  }
  if (n < LIVE_MIN_FRAMES) {
    const need = Math.max(1, Math.ceil((LIVE_MIN_FRAMES - n) / Math.max(rate, 4)));
    box.textContent = "已收 " + got + " 帧 · 可用 " + n + " 帧，约 " + need + " 秒后出第一次判定";
    return;
  }
  const m = state.liveMeas;
  if (m) {
    const sec = Math.max(0, Math.round((performance.now() - m.at) / 1000));
    box.textContent = "最近判定 " + sec + " 秒前 · 膝 " + num(m.knee) + "° 髋 " + num(m.hip) + "° · 结果页已更新";
    return;
  }
  box.textContent = "已收 " + got + " 帧 · 可用 " + n + " 帧，正在等一个完整的踩踏周期";
}

function refreshLinkState() {
  const rate = state.liveRate || 0;
  const fresh = state.liveLast && performance.now() - state.liveLast < 1600;
  if (!state.livePhones) { setLinkState(true, "等待手机"); return; }
  if (fresh && !state.liveFrames.length) { putLinkState(true, "画面已到，未识别到骑手"); return; }
  if (fresh && rate > 0) { putLinkState(true, "手机画面 " + Math.round(rate) + " fps"); return; }
  if (fresh) { putLinkState(true, "画面已到"); return; }
  putLinkState(true, "手机已连接，等待画面");
}

function putLinkState(on, text) {
  setLinkState(on, text);
}

function screenCode() {
  if (state.shareCode) return state.shareCode;
  if (typeof location === "undefined") return "";
  const p = new URLSearchParams(location.search).get("code");
  return p ? p.toUpperCase() : "";
}

// GitHub Pages 之类的纯静态托管没有 server.mjs 的 WebSocket 中继，手机联动要退回本机
const STATIC_HOST = typeof location !== "undefined" && /\.github\.io$/i.test(location.hostname);

function connectLive() {
  if (STATIC_HOST) return null;
  if (state.live && state.live.code === screenCode()) return state.live;
  if (state.live) { state.live.close(); state.live = null; }
  state.live = createLiveLink({
    role: "screen",
    code: screenCode(),
    onFrame: (blob) => { onPhoneFrame(blob); },
    onStatus: (kind) => {
      const inPhone = state.mode === "phone";
      if (kind === "open") {
        setLinkState(true, "手机待命");
        if (inPhone) setStatus("电脑已连上中继，等手机打开页面后开始推流");
      }
      if (kind === "close") setLinkState(false, inPhone ? "未连接" : "待命断开");
      if (kind === "joined") { setLinkState(true, "手机待命"); if (inPhone) refreshLinkState(); }
    },
    onPeers: (info) => {
      if (!info) return;
      // pumping = 真正在推流的手机数（被接管/旧标签页不算），用它决定状态，避免「假等待」
      state.livePhones = info.pumping != null ? info.pumping : (info.phones || 0);
      refreshLinkState();
    },
  });
  return state.live;
}

/* 打开电脑页面就自动进入房间待命：手机一开推流就能连上，
   不用先手点「手机联动」。想关掉可在地址后加 ?nolink=1。 */
let autoLinkTried = false;
let autoLinkTimer = null;
async function autoStartLink() {
  if (STATIC_HOST) return;
  if (typeof WebSocket !== "function") return;
  if (typeof location !== "undefined" && /[?&]nolink=1/.test(location.search)) return;
  if (autoLinkTried) return;
  autoLinkTried = true;
  // 房间码必须和手机一致：先问服务器要当前码，再用它进房间
  try {
    const info = await fetchShareInfo();
    if (info && info.code) state.shareCode = String(info.code).toUpperCase();
  } catch (e) { /* 取不到就用 URL 里的 code */ }
  try { connectLive(); } catch (e) { return; }
  refreshLinkState();
  // 首次连接可能撞上服务刚启动/网络抖动：每 5 秒补一次，连上就不再折腾
  if (!autoLinkTimer) {
    autoLinkTimer = setInterval(() => {
      if (state.linkOff) return;
      if (state.live && state.live.ready) return;
      try { connectLive(); } catch (e) { /* 忽略 */ }
    }, 5000);
  }
}

async function enterPhoneMode() {
  if (STATIC_HOST) {
    const a = el("phone-url");
    if (a) {
      // 静态版没有中继：直接把用户指到本机版，免得在这页等手机
      a.textContent = "点这里打开本机版 http://127.0.0.1:4173/（先双击「启动手机联动.bat」）";
      a.href = "http://127.0.0.1:4173/";
      a.target = "_blank";
      a.rel = "noopener";
    }
    const ping = el("phone-ping");
    if (ping) ping.parentNode && ping.parentNode.classList.add("is-hidden");
    setLinkState(false, "静态托管");
    setStatus("这是 GitHub Pages 的静态版本：照片/视频/演示都能用，手机实时联动请在本机运行 server.mjs");
    return;
  }
  try {
    const info = await fetchShareInfo();
    if (info) {
      state.shareCode = String(info.code || "").toUpperCase();
      const ip = (info.ips && info.ips.filter((x) => x !== "127.0.0.1")[0]) || location.hostname;
      const port = info.phonePort || info.httpPort || location.port || 4173;
      // 手机必须是安全上下文（https）才能开摄像头；HTTP/HTTPS 同端口，所以固定用 https + 局域网 IP
      const url = "https://" + ip + ":" + port + "/phone.html?code=" + info.code;
      const a = el("phone-url");
      if (a) { a.textContent = url; a.href = url; }
      const short = el("phone-short");
      if (short) short.textContent = "https://" + ip + ":" + port + "/phone.html";
      const ping = el("phone-ping");
      if (ping) {
        const pingUrl = "http://" + ip + ":" + (info.httpPort || 4173) + "/ping";
        ping.textContent = pingUrl;
        ping.href = pingUrl;
      }
    }
  } catch (e) { /* 忽略 */ }
  // 姿态模型交给 Worker 加载（主线程不参与推理）；Worker 不可用时才回退到主线程
  ensurePoseWorker();
  if (poseWorkerDead) ensureFallbackTracker();
  connectLive();
  if (!state.liveTimer) {
    let last = 0, lastCount = 0;
    state.liveTimer = setInterval(() => {
      const now = performance.now();
      const c = state.liveCount || 0;
      state.liveRate = last ? Math.max(0, ((c - lastCount) * 1000) / (now - last)) : 0;
      last = now;
      lastCount = c;
      if (state.mode === "phone") { refreshLinkState(); updateLiveProgress(); }
    }, 1000);
  }
}

/* ---------------- 主循环 ---------------- */
function loop(ts) {
  const canvas = el("overlay");
  const g = canvas.getContext("2d");
  const dt = state.lastTs ? Math.min(80, ts - state.lastTs) : 16;
  state.lastTs = ts;

  if (state.mode === "demo") {
    layoutCanvas("demo");
    const view = beginDraw(canvas);
    const ctx = demoCtx({ width: view.w, height: view.h });
    state.phase = (state.phase + (dt / 1000) * ((Number(state.rider.cadence) || state.demo.speed) / 60) * 360) % 360;
    const frame = demoFrame(ctx, ts, state.phase, Math.random);
    state.lastFrame = frame;
    drawDemoScene(g, { width: view.w, height: view.h }, frame, ctx);
    drawLive(g, canvas, frame);
  } else if (state.mode === "camera") {
    if (!state.stream) { requestAnimationFrame(loop); return; }
    layoutCanvas("camera");
    const video = el("video");
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    if (state.tracker && video.readyState >= 2) {
      try {
        const frame = state.tracker.detect(video, ts);
        if (frame) {
          state.lastFrame = frame;
          drawSkeleton(g, frame, chooseSide([frame]), { color: "#c9f25c", width: 3 });
          if (state.recording) state.frames.push(frame);
        }
      } catch (e) { /* 单帧失败忽略 */ }
    }
    drawLive(g, canvas, state.lastFrame);
    if (state.recording && performance.now() > state.recordEnds) stopRecord();
  }
  requestAnimationFrame(loop);
}

/* ---------------- 采样 ---------------- */
function setStatus(text) {
  state.message = text;
  const s = el("record-status");
  if (s) s.textContent = text;
}

async function ensureCamera() {
  if (state.stream) return true;
  const video = el("video");
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "environment" },
      audio: false,
    });
  } catch (err) {
    setStatus("摄像头不可用：" + (err && err.message ? err.message : err));
    return false;
  }
  video.srcObject = state.stream;
  try { await video.play(); } catch (e) { /* 自动播放可能被限制 */ }
  await new Promise((resolve) => {
    if (video.videoWidth) return resolve();
    video.onloadedmetadata = () => resolve();
  });
  layoutCanvas("camera");
  setStatus("正在加载姿态模型…");
  try {
    if (!state.tracker) state.tracker = await createPoseTracker({ modelPath: MODELS.lite });
    setStatus("模型就绪（" + state.tracker.delegate + "），可以采样");
  } catch (err) {
    setStatus("模型加载失败：" + (err && err.message ? err.message : err));
    return false;
  }
  return true;
}

function startRecord() {
  if (state.recording) return;
  if (state.mode === "demo") {
    const canvas = el("overlay");
    const ctx = demoCtx(canvas);
    const frames = demoFrames(ctx, {
      seconds: 6,
      fps: 30,
      cadence: Number(state.rider.cadence) || 85,
      seed: 20260101,
      startPhase: state.phase,
    });
    setStatus("演示采样完成：" + frames.length + " 帧");
    analyze(frames);
    return;
  }
  state.recording = true;
  state.frames = [];
  state.recordEnds = performance.now() + RECORD_MS;
  el("btn-record").disabled = true;
  el("btn-stop").disabled = false;
  setStatus("采样中，保持踏频…");
}

function stopRecord() {
  if (!state.recording) return;
  state.recording = false;
  el("btn-record").disabled = false;
  el("btn-stop").disabled = true;
  const frames = state.frames.slice();
  setStatus("采样结束：" + frames.length + " 帧，正在计算…");
  analyze(frames);
}

/* ---------------- 尺寸标定与分析 ---------------- */
function estimatePxPerMm(frames, side, crank) {
  const ys = frames.map((f) => (f[side] && f[side].ankle ? f[side].ankle.y : NaN)).filter((v) => Number.isFinite(v));
  if (ys.length < 12 || !(crank > 0)) return null;
  const sorted = ys.slice().sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.02)];
  const hi = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.98))];
  const travel = hi - lo;
  if (!(travel > 1)) return null;
  return travel / (2 * crank);
}

function analyze(frames, opts = {}) {
  if (!frames.length) { setStatus("没有采到有效帧"); return; }
  const side = chooseSide(frames);
  const bike = bikeEff();
  const crank = Number(bike.crankLength) || 0;
  const pxPerMm = estimatePxPerMm(frames, side, crank);
  const meas = measureFrames(frames, { side, pxPerMm });
  if (!meas || meas.ok === false) {
    setStatus("测量失败：" + (meas && meas.reason ? meas.reason : "样本不足") + "，请重新采样");
    return;
  }
  meas.pxPerMm = pxPerMm;
  const rec = recommend(meas, state.rider, bike);
  const res = summarize(meas, rec, state.rider, bike);
  state.meas = meas;
  state.res = res;
  renderResult(res, meas);
  renderReport();
  setStatus("已完成：置信度 " + res.confidence + "，打开「结果」页查看");
  if (!opts.silent) {
    const tab = document.querySelector(".tab[data-pane=result]");
    if (tab) tab.click();
  }
}

/* ---------------- 视频文件分析 ---------------- */
async function startVideoAnalyze() {
  if (!state.videoFile) { setStatus("先选择一个视频文件"); return; }
  const runBtn = el("btn-video-run");
  if (runBtn) runBtn.disabled = true;
  const bar = el("video-progress");
  if (bar) bar.hidden = false;
  setStatus("正在分析视频，请稍候…");
  try {
    if (!state.tracker) state.tracker = await createPoseTracker({});
    const out = await analyzeVideoFile(state.videoFile, {
      tracker: state.tracker,
      fps: 12,
      onProgress: (p) => {
        const fill = el("video-progress-bar");
        if (fill) fill.style.width = Math.round(p * 100) + "%";
      },
      onFrame: (f) => { if (f) state.lastFrame = f; },
    });
    if (!out.frames.length) {
      setStatus("视频里没识别到骑手：换一段侧面、整车入镜、光线更好的片段");
      return;
    }
    setStatus("视频分析完成，" + out.frames.length + " 帧有效，正在计算角度…");
    analyze(out.frames, { silent: true });
    const tab = document.querySelector(".tab[data-pane=result]");
    if (tab) tab.click();
  } catch (err) {
    setStatus("视频分析失败：" + (err && err.message ? err.message : err));
  } finally {
    if (bar) bar.hidden = true;
    if (runBtn) runBtn.disabled = false;
  }
}


/* ---------------- 结果渲染 ---------------- */
const STATUS_TEXT = { ok: "正常", high: "偏高", low: "偏低", na: "需校准" };

function renderResult(res, meas) {
  const body = el("result-body");
  if (!body) return;
  body.classList.remove("empty");
  const parts = [];
  const off = res.readings.filter((r) => r.status === "high" || r.status === "low").length;
  const actionable = (res.items || []).filter((i) => i.amount > 0);
  const first = actionable[0];
  const verdictClass = off === 0 ? "" : off <= 2 ? "warn" : "bad";
  const title = off === 0 ? "姿态在目标区间内" : off + " 项角度偏离目标";
  const text = off === 0
    ? "关键角度都在目标区间内，保持当前设定，两周后复测对比趋势"
    : first
      ? "优先处理：" + first.part + " " + first.action + " " + first.amount + first.unit
      : "偏离项没有明确的单向调整，先复查机位、光照与踩踏周期再判断";
  parts.push('<div class="verdict ' + verdictClass + '"><div class="dot"></div><div><h3>' + esc(title) + '</h3><p>' + esc(text) + '</p></div><div class="conf">置信度 ' + esc(res.confidence || "—") + '</div></div>');

  parts.push('<h3 class="sub">实测角度</h3>');
  // 偏离项优先，避免判定与证据分屏
  const ordered = res.readings.slice().sort((a, b) => (a.status === "ok" ? 1 : 0) - (b.status === "ok" ? 1 : 0));
  for (const r of ordered) {
    const lo = r.range ? r.range[0] : NaN;
    const hi = r.range ? r.range[1] : NaN;
    parts.push('<div class="metric' + (r.status === "ok" || r.status === "na" ? "" : " off") + '">');
    parts.push('<div class="metric-head"><span class="metric-label">' + esc(r.label) + '</span><span class="metric-range">' + (Number.isFinite(lo) ? "目标 " + lo + "–" + hi + esc(r.unit) : "需视频采样") + '</span></div>');
    const pill = r.status === "ok" || r.status === "na" ? "" : '<span class="pill ' + r.status + '">' + (STATUS_TEXT[r.status] || "—") + "</span>";
    parts.push('<div class="metric-body"><strong>' + (r.status === "na" || !Number.isFinite(r.value) ? "—" : num(r.value, r.digits)) + '<span>' + esc(r.unit) + '</span></strong>' + pill + "</div>");
    if (Number.isFinite(lo) && Number.isFinite(hi)) {
      const pad = (hi - lo) * 0.45 || 1;
      const min = lo - pad, max = hi + pad;
      const pct = (v) => Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
      parts.push('<div class="track"><i class="band" style="left:' + pct(lo).toFixed(1) + '%;width:' + Math.max(2, pct(hi) - pct(lo)).toFixed(1) + '%"></i>');
      if (r.status !== "na" && Number.isFinite(r.value)) {
        parts.push('<i class="mark ' + (r.status === "ok" ? "" : "warn") + '" style="left:' + pct(r.value).toFixed(1) + '%"></i>');
      }
      parts.push('</div><div class="track-axis"><span>' + lo + esc(r.unit) + "</span><span>" + hi + esc(r.unit) + "</span></div>");
    }
    if (r.hint) parts.push('<p class="metric-hint">' + esc(r.hint) + '</p>');
    parts.push('</div>');
  }

  parts.push('<h3 class="sub">调整建议</h3>');
  if (!res.items.length) parts.push('<div class="item"><div class="body"><div class="part">无需调整</div><div class="why">继续观察骑行感受，保持踏频与坐姿稳定。</div></div></div>');
  for (const it of res.items) {
    const has = it.amount > 0;
    parts.push('<div class="item"><div class="body"><div class="part">' + esc(it.part) + '<span class="amt' + (has ? "" : " zero") + '">' + esc(has ? it.action + " " + it.amount + it.unit : it.action) + '</span></div><div class="why">' + esc(it.why) + (it.expected ? " · 预期：" + esc(it.expected) : "") + '</div></div><div class="conf">' + esc(it.confidence) + '</div></div>');
  }

  const info = [];
  info.push("样本 " + (Number.isFinite(meas.frames) ? meas.frames : 0) + " 帧");
  if (Number.isFinite(meas.strokes)) info.push(meas.strokes + " 个踏频周期");
  if (Number.isFinite(meas.cadence)) info.push("踏频 " + num(meas.cadence, 0) + " rpm");
  if (meas.pxPerMm) info.push("标定 " + num(1 / meas.pxPerMm, 2) + " mm/px");
  if (meas.visibility) info.push("可见度 " + Math.round(meas.visibility * 100) + "%");
  parts.push('<p class="hint" style="margin-top:14px">' + esc(info.join(" · ")) + '</p>');
  if (res.notes && res.notes.length) {
    parts.push('<h3 class="sub">提示</h3><ul class="notes">' + res.notes.map((n) => "<li>" + esc(n) + "</li>").join("") + "</ul>");
  }
  if (res.diffs && res.diffs.length) {
    parts.push('<h3 class="sub">当前 vs 按身高估算</h3>');
    for (const d of res.diffs) {
      parts.push('<div class="diff-row"><span>' + esc(d.label) + '</span><span class="cur">' + num(d.current, 1) + esc(d.unit) + '</span><span class="est">估算 ' + num(d.recommended, 1) + esc(d.unit) + '</span></div>');
    }
  }
  body.innerHTML = parts.join("");
  const actions = el("result-actions");
  if (actions) actions.style.display = "flex";
}

/* ---------------- 导出 ---------------- */
function download(name, text, type) {
  const blob = new Blob([text], { type: type || "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes());
}

function exportMd() {
  if (!state.res || !state.meas) return;
  const md = reportMarkdown(state.res, state.meas, state.rider, bikeEff());
  download("bikefit-" + stamp() + ".md", md, "text/markdown;charset=utf-8");
}

function exportJson() {
  if (!state.res || !state.meas) return;
  const payload = {
    exportedAt: new Date().toISOString(),
    rider: state.rider,
    bike: bikeEff(),
    measurement: state.meas,
    result: state.res,
  };
  download("bikefit-" + stamp() + ".json", JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
}

/* ---------------- 照片模式（单张侧拍 → 角度） ---------------- */
function photoRect(canvas) {
  const img = state.photoImg;
  if (!img || !img.width) return null;
  const k = Math.min(canvas.width / img.width, canvas.height / img.height);
  const w = img.width * k; const h = img.height * k;
  return { x: (canvas.width - w) / 2, y: (canvas.height - h) / 2, w: w, h: h, k: k };
}

function drawPhoto() {
  const canvas = el("overlay");
  if (!canvas || !canvas.getContext) return;
  layoutCanvas("photo");
  const view = beginDraw(canvas);
  const g = view.g;
  const plane = { width: view.w, height: view.h };
  g.clearRect(0, 0, view.w, view.h);
  const img = state.photoImg;
  if (!img) {
    g.fillStyle = "#171c22";
    g.fillRect(0, 0, view.w, view.h);
    g.fillStyle = "#93a0af";
    g.font = "15px sans-serif";
    g.fillText("点「选择照片」载入一张侧面骑行照，再按顺序点关节：髋 → 膝 → 踝 → 肩 → 肘 → 腕", 24, 42);
    g.fillText("拍照要点：与车垂直、镜头与车同高、脚踩到最低点（下死点）时按快门。", 24, 68);
    return;
  }
  const r = photoRect(plane);
  g.drawImage(img, r.x, r.y, r.w, r.h);
  const bones = [["shoulder", "hip"], ["hip", "knee"], ["knee", "ankle"], ["shoulder", "elbow"], ["elbow", "wrist"], ["heel", "toe"]];
  g.lineWidth = 3;
  for (const b of bones) {
    const p1 = state.photo.points[b[0]]; const p2 = state.photo.points[b[1]];
    if (!p1 || !p2) continue;
    g.strokeStyle = "rgba(45,212,191,.9)";
    g.beginPath();
    g.moveTo(r.x + p1.x * r.k, r.y + p1.y * r.k);
    g.lineTo(r.x + p2.x * r.k, r.y + p2.y * r.k);
    g.stroke();
  }
  for (const j of JOINTS) {
    const p = state.photo.points[j.id];
    if (!p) continue;
    const x = r.x + p.x * r.k; const y = r.y + p.y * r.k;
    g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2);
    g.fillStyle = j.color; g.fill();
    g.strokeStyle = "#0f1216"; g.lineWidth = 2; g.stroke();
    g.fillStyle = "#e8edf3"; g.font = "12px sans-serif";
    g.fillText(j.label, x + 9, y - 8);
  }
  const ang = photoAngles(state.photo);
  const lines = [];
  if (ang) {
    lines.push({ text: "膝屈曲 " + ang.knee + "°", color: "#2dd4bf" });
    lines.push({ text: "髋角 " + ang.hip + "°", color: "#e2e8f0" });
    lines.push({ text: "躯干角 " + ang.torso + "°", color: "#94a3b8" });
    lines.push({ text: "肘角 " + ang.elbow + "°", color: "#94a3b8" });
    if (ang.foot != null) lines.push({ text: "足角 " + ang.foot + "°", color: "#64748b" });
  } else {
    const nxt = nextJoint(state.photo);
    lines.push({ text: "下一个点：" + (nxt ? nxt.label + "（" + nxt.full + "）" : "已完成"), color: "#fbbf24" });
  }
  drawHud(g, lines);
}

function canvasPoint(e) {
  const canvas = el("overlay");
  const box = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
  const cw = box && box.width ? box.width : canvas.width || 1;
  const ch = box && box.height ? box.height : canvas.height || 1;
  const left = box && box.left ? box.left : 0;
  const top = box && box.top ? box.top : 0;
  return {
    x: ((Number(e && e.clientX) || 0) - left) * (canvas.width / cw),
    y: ((Number(e && e.clientY) || 0) - top) * (canvas.height / ch),
  };
}

function onPhotoClick(e) {
  if (!state.photoImg) { setStatus("先点「选择照片」载入一张侧面照"); return; }
  const canvas = el("overlay");
  const r = photoRect(canvas);
  const pt = canvasPoint(e);
  if (!r || pt.x < r.x || pt.x > r.x + r.w || pt.y < r.y || pt.y > r.y + r.h) return;
  const j = nextJoint(state.photo);
  if (!j) { setStatus("关节已全部标定，可看结果，或点「重新标定」重来"); return; }
  state.photo = setPoint(state.photo, j.id, (pt.x - r.x) / r.k, (pt.y - r.y) / r.k);
  drawPhoto();
  const miss = missingRequired(state.photo);
  if (miss.length) {
    const nxt = nextJoint(state.photo);
    setStatus("已标「" + j.label + "」，下一个：" + (nxt ? nxt.full : "可选点"));
  } else {
    analyzePhoto();
  }
}

function loadPhotoFile(file) {
  if (!file) { setStatus("没有选中照片"); return; }
  if (typeof Image === "undefined") { setStatus("当前环境不支持读取图片"); return; }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = function () {
    state.photoImg = img;
    state.photoSrc = url;
    state.photo = emptyPhoto();
    drawPhoto();
    setStatus("照片已载入 " + img.width + "×" + img.height + "，从「髋」开始点关节");
  };
  img.onerror = function () { setStatus("照片读取失败，换一张试试（JPG/PNG）"); };
  img.src = url;
}

function analyzePhoto() {
  const meas = photoMeas(state.photo);
  if (!meas.ok) { setStatus(meas.reason || "照片标定不完整"); return; }
  const rec = recommend(meas, state.rider, bikeEff());
  rec.items = (rec.items || []).filter(function (it) { return it.id !== "setback"; });
  rec.notes = (rec.notes || []).slice();
  rec.notes.push("照片模式只评价下死点姿态：坐垫前后、上死点与踏频请用视频采样。");
  const res = summarize(meas, rec, state.rider, bikeEff());
  state.meas = meas;
  state.res = res;
  renderResult(res, meas);
  renderReport();
  setStatus("照片分析完成：膝角 " + num(meas.kneeFlexBdc) + "°，见「结果」页");
  const tab = document.querySelector(".tab[data-pane=result]");
  if (tab) tab.click();
}

/* ---------------- 疼痛定位 ---------------- */
// 侧视骑手骨架（viewBox 0 0 100 160）：面朝右，坐在坐垫上，手在把上
const BODY_BONES = [
  [56, 44, 40, 70],   // 躯干：肩 → 髋
  [56, 44, 70, 50],   // 上臂
  [70, 50, 78, 56],   // 前臂
  [40, 70, 62, 88],   // 大腿
  [62, 88, 52, 106],  // 小腿
  [52, 106, 66, 110], // 脚掌
  [56, 44, 58, 37],   // 颈
];
const BODY_BIKE = [
  [32, 104, 54, 104], // 后下叉
  [32, 104, 38, 72],  // 后上叉
  [54, 104, 38, 72],  // 座管
  [38, 72, 66, 66],   // 上管
  [66, 66, 54, 104],  // 下管
  [66, 66, 76, 104],  // 前叉
  [66, 66, 78, 56],   // 把立与把
];
const BODY_WHEELS = [[32, 104, 12], [76, 104, 12]];
const BODY_HEAD = [63, 30, 8];
const BODY_SADDLE = [31, 72, 45, 71];
const BODY_CRANK = [54, 104, 7];

function renderPainMap() {
  const host = el("pain-map");
  if (!host) return;
  let svg = '<svg viewBox="0 0 100 160" class="body-map" role="img" aria-label="疼痛位置">';
  svg += '<line x1="14" y1="116.5" x2="90" y2="116.5" class="bm-ground"/>';
  for (const w of BODY_WHEELS) {
    svg += '<circle cx="' + w[0] + '" cy="' + w[1] + '" r="' + w[2] + '" class="bm-bike"/>';
    svg += '<circle cx="' + w[0] + '" cy="' + w[1] + '" r="1.4" class="bm-hub"/>';
  }
  for (const b of BODY_BIKE) {
    svg += '<line x1="' + b[0] + '" y1="' + b[1] + '" x2="' + b[2] + '" y2="' + b[3] + '" class="bm-bike"/>';
  }
  svg += '<line x1="' + BODY_SADDLE[0] + '" y1="' + BODY_SADDLE[1] + '" x2="' + BODY_SADDLE[2] + '" y2="' + BODY_SADDLE[3] + '" class="bm-saddle"/>';
  svg += '<circle cx="' + BODY_CRANK[0] + '" cy="' + BODY_CRANK[1] + '" r="' + BODY_CRANK[2] + '" class="bm-bike"/>';
  for (const b of BODY_BONES) {
    svg += '<line x1="' + b[0] + '" y1="' + b[1] + '" x2="' + b[2] + '" y2="' + b[3] + '" class="bm-bone"/>';
  }
  svg += '<circle cx="' + BODY_HEAD[0] + '" cy="' + BODY_HEAD[1] + '" r="' + BODY_HEAD[2] + '" class="bm-head"/>';
  for (const a of PAIN_AREAS) {
    const on = state.pain.indexOf(a.id) >= 0 ? " on" : "";
    svg += '<circle class="spot' + on + '" cx="' + a.x + '" cy="' + a.y + '" r="3.1"><title>' + esc(a.label) + '</title></circle>';
    if (on) {
      const short = a.label.split(" / ")[0];
      svg += '<text class="spot-label" x="' + (a.x + 5.4) + '" y="' + (a.y + 1.6) + '">' + esc(short) + "</text>";
    }
    svg += '<circle class="spot-hit" data-pain="' + a.id + '" cx="' + a.x + '" cy="' + a.y + '" r="7"><title>' + esc(a.label) + "</title></circle>";
  }
  svg += '</svg>';
  host.innerHTML = svg;
}

function renderPainResult() {
  const host = el("pain-result");
  if (!host) return;
  if (!state.pain.length) {
    host.innerHTML = '<p class="empty">点上面的圆点选疼痛位置（可多选）。有实测角度时，诊断会引用具体数值。</p>';
    return;
  }
  const results = diagnoseAll(state.pain, state.meas, targetsFor(state.rider));
  const withData = Boolean(state.meas && state.meas.ok);
  let html = "";
  if (!withData) html += '<p class="hint">还没有实测角度：先跑一次视频采样或照片标定，诊断才有依据。</p>';
  for (const r of results) {
    html += '<div class="item"><div class="body"><div class="part">' + esc(r.area.label) + "</div>";
    for (const h of r.hits) {
      html += '<div class="why">· ' + esc(h.cause) + "<br>→ " + esc(h.fix) + '<span class="src">（依据 ' + esc(h.metricLabel) + " " + num(h.value) + "°）</span></div>";
    }
    for (const n of r.notes) html += '<div class="why">· ' + esc(n) + "</div>";
    html += "</div></div>";
  }
  host.innerHTML = html;
}

function onPainMapClick(e) {
  const t = e && e.target;
  if (!t || !t.getAttribute) return;
  const id = t.getAttribute("data-pain");
  if (!id) return;
  const i = state.pain.indexOf(id);
  if (i >= 0) state.pain.splice(i, 1); else state.pain.push(id);
  renderPainMap();
  renderPainResult();
}

/* ---------------- 记录与趋势 ---------------- */
function saveRecord() {
  if (!state.meas || !state.res) { setStatus("先做一次测量再保存记录"); return; }
  const entry = hist.makeEntry({
    rider: state.rider, bike: bikeEff(), meas: state.meas, items: state.res.items,
    source: state.meas.photo ? "photo" : state.mode, pain: state.pain,
  });
  hist.addEntry(entry);
  renderHistory();
  setStatus("已保存为第 " + hist.listHistory().length + " 条记录");
}

function drawTrend(list) {
  const canvas = el("trend");
  if (!canvas || !canvas.getContext) return;
  const dpr = dprNow();
  const cssW = Math.round(canvas.clientWidth || 320);
  if (canvas.width !== Math.round(cssW * dpr)) {
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(140 * dpr);
  }
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = cssW;
  const h = canvas.height / dpr;
  g.clearRect(0, 0, w, h);
  const series = hist.trendSeries(list, state.trendKey || "knee");
  g.font = "12px sans-serif";
  if (series.length < 2) {
    g.fillStyle = "#93a0af";
    g.fillText("至少 2 次记录后显示趋势线", 12, h / 2);
    return;
  }
  const vals = series.map(function (p) { return p.value; });
  const tKey = state.trendKey === "hip" ? "hipBdc" : state.trendKey === "torso" ? "torso" : "knee";
  let band = (typeof targetsFor === "function" ? targetsFor(state.rider) : {})[tKey];
  let lo = Math.min.apply(null, vals); let hi = Math.max.apply(null, vals);
  if (band && Number.isFinite(band[0])) {
    lo = Math.min(lo - 2, band[0] - 6);
    hi = Math.max(hi + 2, band[1] + 6);
  } else {
    if (hi - lo < 4) { const mid = (hi + lo) / 2; lo = mid - 3; hi = mid + 3; }
  }
  const pad = 18;
  const xAt = function (i) { return pad + (w - pad * 2) * (series.length === 1 ? 0 : i / (series.length - 1)); };
  const yAt = function (v) { return h - pad - (h - pad * 2) * ((v - lo) / (hi - lo)); };
  g.strokeStyle = "#e6eaf1"; g.lineWidth = 1;
  g.beginPath(); g.moveTo(pad, h - pad); g.lineTo(w - pad, h - pad); g.stroke();
  if (band && Number.isFinite(band[0])) {
    const yTop = yAt(band[1]); const yBot = yAt(band[0]);
    g.fillStyle = "rgba(183,224,74,.22)";
    g.fillRect(pad, Math.min(yTop, yBot), w - pad * 2, Math.abs(yBot - yTop) || 2);
    g.strokeStyle = "rgba(122,157,32,.55)"; g.lineWidth = 1;
    g.beginPath(); g.moveTo(pad, yTop); g.lineTo(w - pad, yTop);
    g.moveTo(pad, yBot); g.lineTo(w - pad, yBot); g.stroke();
  }
  g.strokeStyle = "#0b0f14"; g.lineWidth = 2;
  g.beginPath();
  series.forEach(function (p, i) {
    if (i === 0) g.moveTo(xAt(i), yAt(p.value)); else g.lineTo(xAt(i), yAt(p.value));
  });
  g.stroke();
  g.fillStyle = "#b7e04a";
  series.forEach(function (p, i) { g.beginPath(); g.arc(xAt(i), yAt(p.value), 3.6, 0, Math.PI * 2); g.fill(); });
  g.strokeStyle = "#0b0f14"; g.lineWidth = 1.4;
  series.forEach(function (p, i) { g.beginPath(); g.arc(xAt(i), yAt(p.value), 3.6, 0, Math.PI * 2); g.stroke(); });
  const unit = "°";
  g.font = "10px sans-serif";
  g.fillStyle = "#9aa1ab";
  g.textAlign = "right";
  g.fillText(hi.toFixed(1) + unit, w - 6, 12);
  g.fillText(lo.toFixed(1) + unit, w - 6, h - 6);
  g.textAlign = "left";
  if (band && Number.isFinite(band[0])) {
    g.fillStyle = "rgba(183,224,74,.9)";
    g.fillRect(pad, 5, 10, 6);
    g.fillStyle = "#6f7a8a";
    g.fillText("目标 " + band[0] + "–" + band[1] + unit, pad + 14, 11);
  }
}

function renderHistory() {
  const body = el("history-body");
  const cmp = el("history-compare");
  const list = hist.listHistory();
  if (body) {
    if (!list.length) {
      body.innerHTML = '<p class="empty">还没有记录。做一次测量后点「保存本次为记录」。</p>';
    } else {
      let html = "";
      for (const e of list.slice(0, 12)) {
        const a = e.angles || {};
        const b = e.bike || {};
        const acts = (e.actions && e.actions.length) ? e.actions.map(function (x) { return esc(x.part + " " + x.action + " " + x.amount + x.unit); }).join("、") : "无需调整";
        html += '<div class="hist-row">';
        html += '<div class="hist-meta"><b>' + esc(hist.formatDate(e.at)) + "</b> · " + esc(DISCIPLINES[e.discipline] || "") + " · " + esc((POSITIONS[e.discipline] || {})[e.position] || "") + (e.source === "photo" ? " · 照片" : "") + "</div>";
        html += '<div class="hist-vals">膝 ' + num(a.knee) + "° · 髋 " + num(a.hip) + "° · 躯干 " + num(a.torso) + "° · 坐垫 " + num(b.saddleHeight, 0) + "mm</div>";
        html += '<div class="hist-act">' + acts + "</div>";
        html += '<button class="mini" data-del="' + esc(e.id) + '">删除</button></div>';
      }
      body.innerHTML = html;
    }
  }
  if (cmp) {
    const diffs = hist.compareLatest(list);
    if (!diffs.length) cmp.innerHTML = '<p class="hint">记录 2 条以上才能对比前后变化。</p>';
    else {
      cmp.innerHTML = '<div class="cmp-head"><span>指标</span><span>本次</span><span>上次</span><span>Δ</span></div>' + diffs.map(function (d) {
        const sign = d.delta > 0 ? "+" : "";
        return '<div class="cmp-row"><span class="cmp-label">' + esc(d.label) + '</span><b class="cmp-now">' + num(d.now) + esc(d.unit) + '</b><span class="cmp-before">上次 ' + num(d.before) + esc(d.unit) + '</span><span class="delta ' + d.direction + '">' + sign + d.delta + esc(d.unit) + "</span></div>";
      }).join("");
    }
  }
  drawTrend(list);
}

function onHistoryClick(e) {
  const t = e && e.target;
  if (!t || !t.closest) return;
  const btn = t.closest("[data-del]");
  if (!btn) return;
  hist.removeEntry(btn.getAttribute("data-del"));
  renderHistory();
}

/* ---------------- 报告（可打印 / 存 PDF） ---------------- */
function renderReport() {
  const host = el("report-body");
  if (!host) return;
  if (!state.meas || !state.res) {
    host.innerHTML = '<p class="empty">先完成一次测量（演示 / 摄像头 / 照片），再生成报告。</p>';
    return;
  }
  const m = state.meas; const res = state.res; const r = state.rider; const b = bikeEff();
  const when = hist.formatDate(Date.now());
  let html = '<article class="report">';
  html += "<h1>骑行姿态拟合报告</h1>";
  html += '<p class="hint">生成时间 ' + esc(when) + " · 数据来源 " + (m.photo ? "单张照片" : "视频采样") + " · 置信度 " + esc(res.confidence) + "</p>";
  html += "<h2>一、骑手与车辆</h2>";
  html += '<p>身高 ' + num(r.height, 0) + "mm · 跨高 " + num(r.inseam, 0) + "mm · 柔韧度 " + num(r.flexibility, 0) + "/5 · 车型 " + esc(DISCIPLINES[r.discipline] || "") + " · 姿态 " + esc((POSITIONS[r.discipline] || {})[r.position] || "") + "</p>";
  html += '<p>坐垫高 ' + num(b.saddleHeight, 0) + "mm · 后移 " + num(b.saddleSetback, 0) + "mm · 曲柄 " + num(b.crankLength, 1) + "mm · 把立 " + num(b.stemLength, 0) + "mm · 垫圈 " + num(b.spacers, 0) + "mm · Drop " + num(b.barDrop, 0) + "mm</p>";
  html += "<h2>二、实测角度</h2><table><thead><tr><th>指标</th><th>实测</th><th>目标区间</th><th>判定</th></tr></thead><tbody>";
  for (const x of (res.readings || [])) {
    html += "<tr><td>" + esc(x.label) + '</td><td class="num">' + (x.status === "na" ? "—" : num(x.value, x.digits) + esc(x.unit)) + "</td><td>" + (Number.isFinite(x.range[0]) ? x.range[0] + "–" + x.range[1] + esc(x.unit) : "—") + "</td><td>" + (STATUS_TEXT[x.status] || "—") + "</td></tr>";
  }
  html += "</tbody></table>";
  html += "<h2>三、调整建议</h2>";
  if (!res.items || !res.items.length) html += "<p>关键角度都在目标区间内，保持当前设定。</p>";
  else {
    html += "<ul>";
    for (const it of res.items) {
      html += "<li><b>" + esc(it.part) + "</b>：" + esc(it.amount > 0 ? it.action + " " + it.amount + it.unit : it.action) + " —— " + esc(it.why) + "</li>";
    }
    html += "</ul>";
  }
  const pains = state.pain.length ? diagnoseAll(state.pain, m, targetsFor(r)) : [];
  if (pains.length) {
    html += "<h2>四、疼痛定位</h2><ul>";
    for (const p of pains) {
      html += "<li><b>" + esc(p.area.label) + "</b>：" + (p.hits.length ? p.hits.map(function (h) { return esc(h.cause) + " → " + esc(h.fix); }).join("；") : esc(p.notes.join(" "))) + "</li>";
    }
    html += "</ul>";
  }
  html += '<p class="hint">说明：角度测量误差约 ±2°，单次调整不超过 10mm 并重测；持续疼痛请找专业 fitter 或运动医学医生。</p>';
  html += "</article>";
  host.innerHTML = html;
}

function printReport() {
  renderReport();
  const tab = document.querySelector(".tab[data-pane=report]");
  if (tab) tab.click();
  const go = function () { if (typeof window !== "undefined" && typeof window.print === "function") window.print(); };
  setTimeout(go, 80);
}

function refreshPanes() {
  renderPainMap();
  renderPainResult();
  renderHistory();
  renderReport();
}
/* ---------------- 模式与初始化 ---------------- */
function setMode(mode) {
  if (state.mode === mode) return;
  const prev = state.mode;
  state.mode = mode;
  state.lastTs = 0;
  document.querySelectorAll(".mode-btn").forEach((b) => b.classList.toggle("active", b.getAttribute("data-mode") === mode));
  const dctrl = el("demo-controls");
  if (dctrl) dctrl.style.display = mode === "demo" ? "grid" : "none";
  const show = (id, on) => { const n = el(id); if (n) n.style.display = on ? "flex" : "none"; };
  show("photo-controls", mode === "photo");
  show("video-controls", mode === "video");
  show("phone-controls", mode === "phone");
  const bodyEl = document.body;
  if (bodyEl && bodyEl.classList) {
    bodyEl.classList.toggle("photo-mode", mode === "photo");
    bodyEl.classList.toggle("camera-mode", mode === "camera");
    bodyEl.classList.toggle("phone-mode", mode === "phone");
  }
  const hint = el("stage-hint");
  const setHintText = (txt) => { if (hint) hint.textContent = txt; };
  const br = el("btn-record");
  const bs = el("btn-stop");
  const recOn = mode === "demo" || mode === "camera";
  const liveMode = mode === "phone";
  // 手机联动是持续分析的，不需要「开始采样」；把它藏起来，换成一个进度条 + 保存按钮
  if (br) { br.disabled = !recOn; br.style.display = liveMode ? "none" : ""; }
  if (bs) { bs.disabled = true; bs.style.display = liveMode ? "none" : ""; }
  const pill = el("live-pill");
  if (pill) pill.style.display = liveMode ? "inline-flex" : "none";
  const prog = el("live-progress");
  if (prog) prog.style.display = liveMode ? "inline-flex" : "none";
  const liveSave = el("btn-live-save");
  if (liveSave) liveSave.style.display = liveMode ? "" : "none";
  if (mode === "demo") {
    setHintText("演示模式：用滑杆模拟坐垫高低与前部姿态，点「开始采样」看判定结果。");
    if (state.tracker) { try { state.tracker.close(); } catch (e) { /* ignore */ } state.tracker = null; }
    if (state.stream) { state.stream.getTracks().forEach((t) => t.stop()); state.stream = null; el("video").srcObject = null; }
    layoutCanvas("demo");
  } else if (mode === "camera") {
    setHintText("摄像头模式：相机与车垂直、整车入镜，点「开始采样」录 7 秒。");
    ensureCamera();
  } else if (mode === "photo") {
    state.recording = false;
    setHintText("照片模式：载入一张侧面骑行照，按顺序点关节：髋 → 膝 → 踝 → 肩 → 肘 → 腕（脚跟/脚尖可选）。");
    layoutCanvas("photo");
    drawPhoto();
  } else if (mode === "video") {
    state.recording = false;
    setHintText("视频模式：选一段侧面拍摄的视频，程序按 12 帧/秒抽帧分析，自动找下死点与多个踩踏周期。");
    layoutCanvas("video");
  } else if (mode === "phone") {
    state.recording = false;
    state.linkOff = false;        // 手动进来就重新待命
    state.liveFrames = [];
    layoutCanvas("phone");
    // 进入手机联动先清掉演示模式的旧数值，等手机推流后由 updateHud 填回
    hudSet("hud-knee", NaN); hudSet("hud-hip", NaN); hudSet("hud-torso", NaN);
    hudCard("hud-knee-card", null); hudCard("hud-hip-card", null); hudCard("hud-torso-card", null);
    hudBand("hud-knee-band", NaN, null); hudBand("hud-hip-band", NaN, null); hudBand("hud-torso-band", NaN, null);
    const sideEl = el("hud-side"); if (sideEl) sideEl.textContent = "采样侧 —";
    const cadEl = el("hud-cad"); if (cadEl) cadEl.textContent = "踏频 —";
    setHintText("手机联动：手机打开上面的地址并允许摄像头，画面实时传到电脑，角度与建议同步回手机。");
    const rs = el("record-status");
    if (rs) rs.textContent = "自动实时分析中";
    updateLiveProgress();
    enterPhoneMode();
  }
  if (prev === "phone" && mode !== "phone") {
    state.linkOff = true;         // 主动离开，别被自动重连/手机推流拉回来
    if (state.live) { state.live.close(); state.live = null; }
    state.phoneBlob = null;
    if (state.phoneBmp && state.phoneBmp.close) state.phoneBmp.close();
    state.phoneBmp = null;
    state.phoneView = null;
    if (state.liveTimer) { clearInterval(state.liveTimer); state.liveTimer = null; }
    state.livePhones = 0;
    state.liveRate = 0;
    setLinkState(false, "未连接");
  }
  if (prev === "camera" && mode !== "camera") {
    if (state.stream) { state.stream.getTracks().forEach((t) => t.stop()); state.stream = null; el("video").srcObject = null; }
  }
  save();
}

function applyBaseline() {
  const b = baselineSetup(state.rider);
  state.bike.saddleHeight = Math.round(b.saddleHeight * 2) / 2;
  state.bike.saddleSetback = Math.round(b.setback);
  state.bike.crankLength = b.crank;
  if (state.rider.discipline === "tri") {
    state.bike.padStack = Math.round(b.padStack);
    state.bike.padReach = Math.round(b.padReach);
  }
  state.bike.barDrop = Math.round(b.barDrop);
  state.bike.stemLength = b.stemLength;
  syncInputs();
  save();
  setStatus("已按身高/跨高载入估算设定（坐垫高 " + state.bike.saddleHeight + "mm），请以此为起点微调");
}

/* ---------------- 参数说明浮层（悬停 / 点按，含量法图解） ---------------- */
let tipTimer = 0;
let tipAnchor = null;

function tipBox() {
  return el("tip");
}

function renderTip(key) {
  const t = TIPS[key];
  const box = tipBox();
  if (!t || !box) return false;
  box.innerHTML =
    "<h4>" + esc(t.title) + "</h4>" +
    '<div class="tip-fig">' + t.fig + "</div>" +
    (t.body || []).map((p) => "<p>" + esc(p) + "</p>").join("") +
    (t.range ? '<p class="tip-range">' + esc(t.range) + "</p>" : "");
  return true;
}

function placeTip(anchor) {
  const box = tipBox();
  const r = anchor.getBoundingClientRect();
  const bw = box.offsetWidth || 328;
  const bh = box.offsetHeight || 340;
  const inPanel = !!(anchor.closest && anchor.closest(".panel"));
  let left = inPanel ? r.left - bw - 12 : r.right + 12;
  if (!inPanel && left + bw > window.innerWidth - 10) left = r.left - bw - 12;
  if (left < 12) left = 12;
  let top = r.top + r.height / 2 - bh / 2;
  top = Math.max(68, Math.min(top, window.innerHeight - bh - 10));
  box.style.left = Math.round(left) + "px";
  box.style.top = Math.round(top) + "px";
}

function showTip(anchor) {
  if (!anchor || !renderTip(anchor.getAttribute("data-tip"))) return;
  tipAnchor = anchor;
  placeTip(anchor);
  const box = tipBox();
  if (box) box.classList.add("on");
}

function hideTip() {
  tipAnchor = null;
  const box = tipBox();
  if (box) box.classList.remove("on");
}

function setupTips() {
  const box = tipBox();
  if (!box) return;
  const hit = (e) => (e.target && e.target.closest ? e.target.closest("[data-tip]") : null);
  document.addEventListener("mouseover", (e) => {
    const a = hit(e);
    if (!a) return;
    clearTimeout(tipTimer);
    showTip(a);
  });
  document.addEventListener("mouseout", (e) => {
    const a = hit(e);
    if (!a) return;
    const to = e.relatedTarget;
    if (to && (a.contains(to) || box.contains(to))) return;
    tipTimer = setTimeout(hideTip, 170);
  });
  box.addEventListener("mouseenter", () => clearTimeout(tipTimer));
  box.addEventListener("mouseleave", () => { tipTimer = setTimeout(hideTip, 130); });
  document.addEventListener("click", (e) => {
    const a = hit(e);
    if (a) {
      e.preventDefault();
      if (tipAnchor === a && box.classList.contains("on")) hideTip();
      else showTip(a);
      return;
    }
    if (!box.contains(e.target)) hideTip();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideTip(); });
  window.addEventListener("scroll", () => hideTip(), true);
  window.addEventListener("resize", () => hideTip());
}

function init() {
  load();
  setupTips();
  fillSelects();
  syncInputs();
  bindForms();

  document.querySelectorAll(".mode-btn").forEach((b) => {
    b.addEventListener("click", () => setMode(b.getAttribute("data-mode")));
  });
  document.querySelectorAll(".tab").forEach((t) => {
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === t));
      document.querySelectorAll(".pane").forEach((p) => p.classList.toggle("active", p.id === "pane-" + t.getAttribute("data-pane")));
      const pane = t.getAttribute("data-pane");
      if (pane === "pain") { renderPainMap(); renderPainResult(); }
      if (pane === "history") renderHistory();
      if (pane === "report") renderReport();
    });
  });
  el("btn-record").addEventListener("click", startRecord);
  el("btn-stop").addEventListener("click", stopRecord);
  el("btn-recommend").addEventListener("click", applyBaseline);
  el("btn-md").addEventListener("click", exportMd);
  el("btn-json").addEventListener("click", exportJson);
  window.addEventListener("resize", () => { layoutCanvas(state.mode); if (state.mode === "photo") drawPhoto(); });

  const dctrl = el("demo-controls");
  if (dctrl) dctrl.style.display = state.mode === "demo" ? "grid" : "none";

  const canvasEl = el("overlay");
  if (canvasEl && canvasEl.addEventListener) {
    canvasEl.addEventListener("click", (ev) => { if (state.mode === "photo") onPhotoClick(ev); });
  }
  const pf = el("photo-file");
  if (pf) pf.addEventListener("change", () => { const f = pf.files && pf.files[0]; loadPhotoFile(f); });
  const undoBtn = el("btn-photo-undo");
  if (undoBtn) undoBtn.addEventListener("click", () => { state.photo = undoPoint(state.photo); drawPhoto(); setStatus("已撤销上一个标定点"); });
  const resetBtn = el("btn-photo-reset");
  if (resetBtn) resetBtn.addEventListener("click", () => { state.photo = emptyPhoto(); drawPhoto(); setStatus("已清空标定点，从髋开始"); });
  const pmap = el("pain-map");
  if (pmap) pmap.addEventListener("click", onPainMapClick);
  const saveBtn = el("btn-save-record");
  if (saveBtn) saveBtn.addEventListener("click", saveRecord);
  const liveSaveBtn = el("btn-live-save");
  if (liveSaveBtn) liveSaveBtn.addEventListener("click", saveRecord);
  const saveBtn2 = el("btn-save-record2");
  if (saveBtn2) saveBtn2.addEventListener("click", saveRecord);
  const clearBtn = el("btn-clear-history");
  if (clearBtn) clearBtn.addEventListener("click", () => { hist.clearHistory(); renderHistory(); setStatus("记录已清空"); });
  const trendSel = el("trend-key");
  if (trendSel && trendSel.addEventListener) trendSel.addEventListener("change", () => { state.trendKey = trendSel.value; renderHistory(); });
  const hbody = el("history-body");
  if (hbody) hbody.addEventListener("click", onHistoryClick);
  const printBtn = el("btn-print");
  if (printBtn) printBtn.addEventListener("click", printReport);
  const printBtn2 = el("btn-print2");
  if (printBtn2) printBtn2.addEventListener("click", printReport);

  const vf = el("video-file");
  if (vf) vf.addEventListener("change", () => {
    const f = (vf.files && vf.files[0]) || null;
    if (!f) return;
    state.videoFile = f;
    const nameEl = el("video-name");
    if (nameEl) nameEl.textContent = f.name + " · " + (f.size / 1048576).toFixed(1) + " MB";
    const run = el("btn-video-run");
    if (run) run.disabled = false;
  });
  const vrun = el("btn-video-run");
  if (vrun) vrun.addEventListener("click", startVideoAnalyze);
  const copyBtn = el("btn-phone-copy");
  if (copyBtn) copyBtn.addEventListener("click", () => {
    const a = el("phone-url");
    const text = a ? a.textContent : "";
    if (navigator.clipboard && text && text.indexOf("http") === 0) {
      navigator.clipboard.writeText(text).then(() => setStatus("手机链接已复制")).catch(() => setStatus("复制失败，可手动选中链接"));
    } else {
      setStatus("先把电脑切到「手机联动」模式获取地址");
    }
  });
  refreshPanes();
  autoStartLink();

  // 顶栏连接状态可以点：连不上时手动重连一次
  const linkBox = el("link-state");
  if (linkBox) {
    linkBox.addEventListener("click", () => {
      if (STATIC_HOST) { setStatus("静态托管版没有手机联动，需要在本机运行 node server.mjs"); return; }
      state.linkOff = false;
      if (state.live) { try { state.live.close(); } catch (e) { /* ignore */ } state.live = null; }
      try { connectLive(); } catch (e) { setStatus("重连失败：本机服务没起来？先双击「启动手机联动.bat」"); return; }
      setStatus("已重新连接中继，等手机打开页面推流");
    });
  }

  // 开发/自检用入口：让无头浏览器能喂合成帧，验证「实时判定 → 结果页」这条链
  if (typeof window !== "undefined") {
    window.__velolab = { state, demoContext, demoFrames, bikeEff, maybeLiveAnalyze, updateLiveProgress };
  }

  requestAnimationFrame(loop);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
