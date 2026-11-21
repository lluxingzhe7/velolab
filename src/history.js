// bikefit/src/history.js
// fitting 记录：每次测量存一份快照（时间、车型、身体参数、关键角度、车设置、建议动作），
// 支持趋势对比。对应 Posely / MyVeloFit 的「多份报告 + 前后对比」。
// 存储优先 localStorage，不可用时退回内存，保证页面照常工作。

const KEY = "bikefit.history.v1";
const CAP = 40;
let mem = [];

function storage() {
  try {
    if (typeof localStorage !== "undefined" && localStorage) return localStorage;
  } catch (e) { /* ignore */ }
  return null;
}

function readRaw() {
  const s = storage();
  if (!s) return mem.slice();
  try {
    const raw = s.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return mem.slice();
  }
}

function writeRaw(list) {
  mem = list.slice();
  const s = storage();
  if (!s) return;
  try { s.setItem(KEY, JSON.stringify(list)); } catch (e) { /* 配额满时静默降级 */ }
}

export function listHistory() {
  return readRaw();
}

const pick = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

export function makeEntry(input) {
  const { rider = {}, bike = {}, meas = {}, items = [], source = "video", note = "" } = input || {};
  return {
    id: "h" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    at: Date.now(),
    source,
    note,
    discipline: rider.discipline || "road",
    position: rider.position || "sport",
    rider: {
      height: rider.height ?? null, inseam: rider.inseam ?? null,
      flexibility: rider.flexibility ?? null, cadence: pick(rider.cadence),
    },
    bike: {
      saddleHeight: bike.saddleHeight ?? null, saddleSetback: bike.saddleSetback ?? null,
      crankLength: bike.crankLength ?? null, stemLength: bike.stemLength ?? null,
      spacers: bike.spacers ?? null, barDrop: bike.barDrop ?? null,
    },
    angles: {
      knee: pick(meas.kneeFlexBdc), kneeTdc: pick(meas.kneeFlexTdc),
      hip: pick(meas.hipBdc), hipTdc: pick(meas.hipTdc),
      torso: pick(meas.torso), shoulder: pick(meas.shoulder),
      elbow: pick(meas.elbow), foot: pick(meas.foot),
    },
    actions: (items || []).filter((i) => i.amount > 0).map((i) => ({ part: i.part, action: i.action, amount: i.amount, unit: i.unit })),
    pain: Array.isArray(input.pain) ? input.pain.slice(0, 8) : [],
  };
}

export function addEntry(entry) {
  const list = readRaw();
  list.unshift(entry);
  const trimmed = list.slice(0, CAP);
  writeRaw(trimmed);
  return trimmed;
}

export function removeEntry(id) {
  const list = readRaw().filter((e) => e.id !== id);
  writeRaw(list);
  return list;
}

export function clearHistory() {
  writeRaw([]);
  return [];
}

/** 把最新一条与上一条对比，返回 [{key,label,unit,now,before,delta,direction}] */
export function compareLatest(list) {
  const arr = list || readRaw();
  if (arr.length < 2) return [];
  const now = arr[0];
  const before = arr[1];
  const defs = [
    ["knee", "下死点膝角", "°"], ["kneeTdc", "上死点膝角", "°"], ["hip", "下死点髋角", "°"],
    ["torso", "躯干角", "°"], ["elbow", "肘角", "°"], ["foot", "足角", "°"],
  ];
  const out = [];
  for (const [key, label, unit] of defs) {
    const a = now.angles?.[key];
    const b = before.angles?.[key];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const delta = Math.round((a - b) * 10) / 10;
    out.push({ key, label, unit, now: a, before: b, delta, direction: Math.abs(delta) < 0.6 ? "flat" : delta > 0 ? "up" : "down" });
  }
  return out;
}

/** 趋势序列，供 canvas 画折线：按时间正序 */
export function trendSeries(list, key = "knee") {
  const arr = (list || readRaw()).slice().reverse();
  return arr
    .map((e, i) => ({ i, at: e.at, value: e.angles?.[key] }))
    .filter((p) => Number.isFinite(p.value));
}

export function formatDate(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
