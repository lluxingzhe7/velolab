// 手机端：摄像头 -> 压缩 JPEG -> WebSocket 推流给电脑
// 支持：镜头选择（主摄/超广角）、变焦（硬件优先，退化为数码裁切）、横屏全屏
import { createLiveLink, fetchShareInfo } from "./live.js";
import { viewport, zoomCapability, pickDefaultDevice, zoomLabel, clampZoom } from "./zoom.js";

const el = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const params = new URLSearchParams(location.search);
const PREF_KEY = "velolab.phone.v1";

let code = (params.get("code") || "").toUpperCase();
let stream = null;
let facing = "environment";
let timer = null;
let link = null;
let sent = 0;
let sentAt = 0;
let busy = false;

const prefs = (() => {
  try { return JSON.parse(localStorage.getItem(PREF_KEY) || "{}") || {}; } catch (e) { return {}; }
})();
let deviceId = prefs.deviceId || "";
let aspect = prefs.aspect === "4:3" ? "4:3" : "16:9";
let zoom = Number(prefs.zoom) || 1;          // 硬件引擎时是镜头倍率，数码引擎时是裁切倍率
let engine = "digital";
let zoomCaps = null;
let cams = [];

function savePrefs() {
  try { localStorage.setItem(PREF_KEY, JSON.stringify({ deviceId, zoom, aspect })); } catch (e) { /* 隐私模式 */ }
}

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");
const video = el("preview");

function setState(on, text) {
  const box = el("state");
  if (!box) return;
  box.classList.toggle("on", !!on);
  const span = box.querySelector("span");
  if (span) span.textContent = text;
}
function setHint(html) { const h = el("hint"); if (h) h.innerHTML = html; }

/* ---------- 横屏 ---------- */
function syncOrientation() {
  const land = !!(window.matchMedia && window.matchMedia("(orientation: landscape)").matches);
  document.body.classList.toggle("landscape", land);
  const btn = el("btn-rotate");
  if (btn) btn.textContent = land ? "竖屏" : "横屏";
  return land;
}

async function toggleOrientation() {
  const land = syncOrientation();
  try {
    if (land) {
      if (document.exitFullscreen && document.fullscreenElement) await document.exitFullscreen();
      if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
      setHint("已退出全屏。想固定横屏就再点一次「横屏」。");
      return;
    }
    if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    }
    if (screen.orientation && screen.orientation.lock) await screen.orientation.lock("landscape");
    setHint("已切到全屏横屏：手机横过来放，画面会吃满整屏。");
  } catch (e) {
    setHint("这个浏览器不允许强制转屏，<b>把手机横过来放</b>就行，页面会自动按横屏重排（也能全屏）。");
  }
  syncOrientation();
}

/* ---------- 摄像头 ---------- */
function videoConstraints() {
  // 4:3 比 16:9 多出上下视野，房间矮、坐姿高、整车竖着装不下时更好用
  const tall = aspect === "4:3";
  const base = {
    width: { ideal: 1280 },
    height: { ideal: tall ? 960 : 720 },
    aspectRatio: { ideal: tall ? 4 / 3 : 16 / 9 },
  };
  if (deviceId) return { deviceId: { exact: deviceId }, ...base };
  return { facingMode: facing, ...base };
}

function paintAspect() {
  const a = el("btn-ar169");
  const b = el("btn-ar43");
  if (a) a.classList.toggle("on", aspect !== "4:3");
  if (b) b.classList.toggle("on", aspect === "4:3");
}

async function setAspect(v) {
  if (aspect === v) return;
  aspect = v;
  savePrefs();
  paintAspect();
  await restartCamera();
  setHint("画幅改成 " + v + (v === "4:3" ? "：上下视野更宽，适合房间矮/整车竖着装不下；左右会窄一点。" : "：左右更宽，镜头要正对车身侧面。"));
}

async function startCamera() {
  if (stream) return true;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setHint("这个浏览器不给用摄像头：请用手机自带浏览器或 Chrome/Safari，并用 https 地址打开。");
    return false;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(), audio: false });
  } catch (err) {
    if (deviceId) {                       // 记住的镜头没了，退回自动
      deviceId = "";
      return startCamera();
    }
    setHint("无法打开摄像头：<b>" + esc(err && err.message ? err.message : err) + "</b><br>请确认已允许权限，且页面是 https 打开。");
    return false;
  }
  video.srcObject = stream;
  try { await video.play(); } catch (e) { /* 自动播放限制 */ }
  await setupZoom();
  await listDevices();
  return true;
}

/* 变焦：优先用镜头自带的 zoom（不改分辨率），没有就数码裁切（画质会降，但一定能拉近） */
async function setupZoom() {
  const track = stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
  let caps = {};
  try { caps = track && track.getCapabilities ? track.getCapabilities() : {}; } catch (e) { caps = {}; }
  zoomCaps = zoomCapability(caps);
  const slider = el("zoom");
  if (zoomCaps) {
    engine = "native";
    zoom = clampRange(zoom || zoomCaps.min, zoomCaps.min, Math.min(zoomCaps.max, 4));
    applyZoomUI(zoomCaps.min, Math.min(zoomCaps.max, 4), zoomCaps.step);
    await applyNativeZoom(zoom);
  } else {
    engine = "digital";
    zoom = clampZoom(zoom || 1);
    applyZoomUI(1, 3, 0.1);
  }
  paintZoom();
  paintCamNote();
}

function clampRange(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(n * 100) / 100));
}

function applyZoomUI(min, max, step) {
  const s = el("zoom");
  if (!s) return;
  s.min = String(min);
  s.max = String(max);
  s.step = String(step || 0.1);
  s.value = String(clampRange(zoom, min, max));
  s.disabled = max <= min;
}

function paintZoom() {
  const label = el("zoom-val");
  if (label) label.textContent = zoomLabel(zoom) + (engine === "digital" && zoom > 1.05 ? " 数码" : "");
  const s = el("zoom");
  if (s) s.value = String(zoom);
  // 数码变焦发生在采集端（裁切），取景框也要跟着放大，否则手机上看到的和电脑收到的不是一回事
  const v = el("preview");
  if (v) v.style.transform = engine === "digital" && zoom > 1.01 ? "scale(" + zoom + ")" : "";
  const lo = zoomCaps ? zoomCaps.min : 1;
  const wideBtn = el("btn-wide");
  if (wideBtn) {
    const dead = !zoomCaps && lo >= 1;
    wideBtn.hidden = dead;                       // 数码引擎下「最广」和「1×」是同一件事，直接不显示
    wideBtn.disabled = dead;
    wideBtn.classList.toggle("on", !dead && zoom <= lo + 0.02);
  }
  const oneBtn = el("btn-1x");
  if (oneBtn) {
    oneBtn.classList.toggle("on", Math.abs(zoom - 1) < 0.02 && !(wideBtn && wideBtn.classList.contains("on")));
    oneBtn.disabled = lo > 1.001;
  }
}

async function applyNativeZoom(z) {
  const track = stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
  if (!track || !track.applyConstraints) return false;
  try {
    await track.applyConstraints({ advanced: [{ zoom: z }] });
    return true;
  } catch (e) {
    return false;
  }
}

async function setZoom(z) {
  if (!zoomCaps) {
    zoom = clampZoom(z);
  } else {
    zoom = clampRange(z, zoomCaps.min, Math.min(zoomCaps.max, 4));
    await applyNativeZoom(zoom);
  }
  paintZoom();
  savePrefs();
  if (engine === "digital" && zoom > 1.6) setHint("数码变焦 " + zoomLabel(zoom) + "：靠裁切画面实现，<b>人离得越远越糊</b>；能选超广角镜头的话优先换镜头。");
}

const WIDE_RE = /(wide|ultra|0\.5|广角)/i;

async function listDevices() {
  const sel = el("cam-select");
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    cams = all.filter((d) => d.kind === "videoinput");
  } catch (e) { cams = []; }
  if (!deviceId && cams.length) deviceId = pickDefaultDevice(cams);
  if (!sel) return;
  if (!cams.length) {
    sel.innerHTML = '<option value="">自动</option>';
    paintCamNote();
    return;
  }
  // 名字里带 wide / ultra / 0.5× 的排前面，方便一眼看到超广角
  const ordered = cams.slice().sort((a, b) => (WIDE_RE.test(b.label || "") ? 1 : 0) - (WIDE_RE.test(a.label || "") ? 1 : 0));
  sel.innerHTML = ordered
    .map((d, i) => {
      const label = d.label || "摄像头 " + (i + 1);
      const tag = WIDE_RE.test(label) ? "（广角）" : "";
      return '<option value="' + esc(d.deviceId) + '">' + esc(label + tag) + "</option>";
    })
    .join("");
  if (deviceId) sel.value = deviceId;
  paintCamNote();
}

/* 诚实告知浏览器能拿到几个镜头：拿不到超广角时给出可行的放宽办法 */
function paintCamNote() {
  const box = el("cam-note");
  if (!box) return;
  const parts = [];
  const lo = zoomCaps ? zoomCaps.min : 1;
  const hasHwWide = lo < 0.99;
  const wideCam = cams.find((d) => WIDE_RE.test(d.label || ""));
  const zr = zoomCaps ? "（变焦 " + zoomLabel(zoomCaps.min) + "–" + zoomLabel(zoomCaps.max) + "）" : "";
  if (hasHwWide) parts.push("这个镜头硬件支持 <b>" + zoomLabel(lo) + " 广角</b>" + zr + "，点「最广」直接用。");
  if (cams.length > 1) {
    const names = cams.map((d, i) => {
      const raw = d.label || "摄像头 " + (i + 1);
      const face = /front|前置/i.test(raw) ? "（前置）" : (/back|rear|后置/i.test(raw) ? "（后置）" : "");
      return esc(raw) + face;
    }).join("、");
    parts.push("发现 <b>" + cams.length + " 个摄像头</b>：" + names + zr +
      (wideCam ? "；带 wide / 0.5× / 超广角 的那个更宽，直接选它。"
               : "；两个都切一下看视野：同一颗主摄的不同焦距不会出现在下拉里，能选到的一般是<b>后置 + 前置</b>，前置往往更广一点但画质低、细节点会飘。"));
  } else if (!hasHwWide) {
    parts.push("本机浏览器只开放 <b>1 个摄像头</b>，拿不到 0.5× 超广角（iPhone 基本都这样，Android 也常见）。" +
      "想放宽视野：手机横过来、退到最远、镜头降到车把高度；或用系统相机 App 的 0.5× 拍一段侧面视频，电脑端用「视频」模式分析。");
  }
  box.innerHTML = parts.join("<br>");
  box.hidden = parts.length === 0;
}

async function applyPreset(kind) {
  const lo = zoomCaps ? zoomCaps.min : 1;
  await setZoom(kind === "wide" ? lo : 1);
}

async function restartCamera() {
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  const ok = await startCamera();
  if (ok) setHint("已切换镜头：" + (el("cam-select") && el("cam-select").selectedOptions && el("cam-select").selectedOptions[0]
    ? esc(el("cam-select").selectedOptions[0].textContent) : "完成") + "。变焦会按新镜头重新给范围。");
}

/* 推流策略：宁可丢帧，也不排队
   - 上行缓冲超过 260KB 就跳过这一帧（Wi-Fi 慢了不会越积越多）
   - 编码慢（>85ms）就自动把间隔拉长，编码快就回到 80ms
   - 640 宽 q0.58：人像细节够 MediaPipe 用，流量只有 720p 的 2/3 */
const MAX_W = 640;
const QUALITY = 0.58;
const MIN_GAP = 80;
const MAX_GAP = 180;
const BACKLOG = 260 * 1024;
let gap = MIN_GAP;
let encodeMs = 0;

function capture() {
  if (busy || !stream || !link || !link.ready) return;
  if (!video.videoWidth) return;
  if (link.buffered && link.buffered() > BACKLOG) return;   // 背压：丢帧
  busy = true;
  const t0 = performance.now();
  const v = viewport(video.videoWidth, video.videoHeight, engine, zoom);
  const w = Math.max(160, Math.min(MAX_W, Math.round(v.sw)));
  const h = Math.max(90, Math.round((v.sh / v.sw) * w));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.drawImage(video, v.sx, v.sy, v.sw, v.sh, 0, 0, w, h);
  canvas.toBlob((blob) => {
    busy = false;
    const ms = performance.now() - t0;
    encodeMs = encodeMs ? encodeMs * 0.7 + ms * 0.3 : ms;
    const want = Math.max(MIN_GAP, Math.min(MAX_GAP, Math.round(encodeMs * 2.2)));
    if (Math.abs(want - gap) > 12) {
      gap = want;
      if (timer) { clearInterval(timer); timer = setInterval(capture, gap); }
    }
    if (!blob) return;
    blob.arrayBuffer().then((buf) => {
      if (link.sendFrame(buf)) sent += 1;
    }).catch(() => {});
  }, "image/jpeg", QUALITY);
}

function startLoop() {
  if (timer) return;
  gap = MIN_GAP;
  timer = setInterval(capture, gap);
}
function stopLoop() {
  if (timer) { clearInterval(timer); timer = null; }
}

async function start() {
  const ok = await startCamera();
  if (!ok) return;
  // 重新 join 一次：如果这个页面之前被别的标签页接管了，这样就把推流权抢回来
  if (link && link.send) link.send({ t: "join", role: "phone", code });
  el("btn-start").disabled = true;
  el("btn-stop").disabled = false;
  startLoop();
  const land = syncOrientation();
  setHint("正在推流…" + (land ? "横屏已生效。" : "建议点右上角「横屏」，画面更宽、更容易整车入镜。") + "电脑端会实时显示角度。");
}

function stop() {
  stopLoop();
  el("btn-start").disabled = false;
  el("btn-stop").disabled = true;
  setHint("已停止推流。需要时点「开始推流」继续。");
}

async function connect() {
  // 以服务器当前房间码为准：链接里的码可能是上一轮生成的，对不上电脑就收不到画面
  const info = await fetchShareInfo();
  if (info && info.code) code = info.code;
  link = createLiveLink({
    role: "phone",
    code,
    onStatus: (kind, text) => {
      if (kind === "open") setState(true, "已连接电脑");
      if (kind === "close") setState(false, "连接断开，重连中…");
      if (kind === "joined") {
        setState(true, "已连接电脑");
        if (text && text.screens === 0) setHint("已连上服务器（房间 " + (text.code || code) + "），但电脑页面还没打开联动模式。请在电脑上点「手机联动」。");
        else setHint("已连上电脑（房间 " + (text && text.code ? text.code : code) + "，电脑 " + (text ? text.screens : 1) + " 台），正在推流…");
      }
    },
    onMessage: (msg) => {
      if (msg && msg.t === "superseded") {
        stopLoop();
        el("btn-start").disabled = false;
        el("btn-stop").disabled = true;
        setState(false, "已被接管");
        setHint("同一个房间只保留最新打开的那个手机页面推流，这个页面已经被接管并停止推流。<br>还想用这一台：点「开始推流」抢回来（另一个页面会自动停）。");
        return;
      }
      if (msg && msg.t === "peers") {
        if (!msg.screens) setHint("已连上服务器，等待电脑端进入「手机联动」模式…");
        else setState(true, "电脑已连接");
      }
    },
    onHint: (msg) => {
      if (msg && msg.text) setHint("电脑实时建议：<b>" + esc(msg.text) + "</b>");
    },
  });
  setInterval(() => {
    const now = performance.now();
    if (now - sentAt > 2000) { setState(!!(link && link.ready), link && link.ready ? "推流中 " + Math.round(sent / 2) + " fps" : "未连接"); sent = 0; sentAt = now; }
  }, 2000);
}

el("btn-start").addEventListener("click", start);
el("btn-stop").addEventListener("click", stop);
el("btn-rotate").addEventListener("click", toggleOrientation);
const camSel = el("cam-select");
if (camSel) camSel.addEventListener("change", async () => { deviceId = camSel.value; savePrefs(); await restartCamera(); });
const zoomSlider = el("zoom");
if (zoomSlider) zoomSlider.addEventListener("input", () => { setZoom(Number(zoomSlider.value)); });
const wideBtn = el("btn-wide");
if (wideBtn) wideBtn.addEventListener("click", () => applyPreset("wide"));
const oneBtn = el("btn-1x");
if (oneBtn) oneBtn.addEventListener("click", () => applyPreset("one"));
const ar169 = el("btn-ar169");
if (ar169) ar169.addEventListener("click", () => setAspect("16:9"));
const ar43 = el("btn-ar43");
if (ar43) ar43.addEventListener("click", () => setAspect("4:3"));
const rescan = el("btn-rescan");
if (rescan) rescan.addEventListener("click", async () => {
  await listDevices();
  setHint("重新扫描完成：找到 <b>" + cams.length + " 个摄像头</b>" +
    (cams.length > 1 ? "，在下拉里逐个试试哪个能装下整车。" : "（本机只开放这一个，想看更宽的画面只能换机位或用视频模式）。"));
});

if (window.matchMedia) {
  const mq = window.matchMedia("(orientation: landscape)");
  if (mq.addEventListener) mq.addEventListener("change", syncOrientation);
  else if (mq.addListener) mq.addListener(syncOrientation);
}
syncOrientation();
paintAspect();

connect();
setState(false, "连接中…");
startCamera().then(() => start()); // 自动尝试开摄像头，失败会提示
