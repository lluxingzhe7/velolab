// bikefit/src/geometry.js
// 纯数学工具：向量、关节角、周期信号极值、人体分段长度、双骨 IK。
// 所有角度单位为“度”，坐标沿用图像坐标系（x 向右、y 向下）。

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
export const len = (a) => Math.hypot(a.x, a.y);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

export function roundTo(v, step) {
  if (!step) return v;
  return Math.round(v / step) * step;
}

/** 以 b 为顶点的内角（度），范围 0..180 */
export function angleAtDeg(a, b, c) {
  const u = sub(a, b);
  const v = sub(c, b);
  const du = len(u);
  const dv = len(v);
  if (du < 1e-6 || dv < 1e-6) return NaN;
  const c2 = clamp((u.x * v.x + u.y * v.y) / (du * dv), -1, 1);
  return Math.acos(c2) * RAD;
}

/**
 * 线段相对水平线的夹角（度），向上为正。
 * forwardSign = +1 表示画面中的 +x 方向即车头方向；-1 反之。
 */
export function angleFromHorizontalDeg(origin, point, forwardSign = 1) {
  const dx = (point.x - origin.x) * forwardSign;
  const dy = point.y - origin.y;
  return Math.atan2(-dy, dx) * RAD;
}

export function mean(arr) {
  const a = arr.filter((v) => Number.isFinite(v));
  if (!a.length) return NaN;
  return a.reduce((s, v) => s + v, 0) / a.length;
}

export function median(arr) {
  const a = arr.filter((v) => Number.isFinite(v)).slice().sort((x, y) => x - y);
  if (!a.length) return NaN;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function stdDev(arr) {
  const a = arr.filter((v) => Number.isFinite(v));
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1));
}

export function percentile(arr, p) {
  const a = arr.filter((v) => Number.isFinite(v)).slice().sort((x, y) => x - y);
  if (!a.length) return NaN;
  const idx = clamp((a.length - 1) * p, 0, a.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (idx - lo);
}

/** 指数滑动平均，用于降低姿态抖动 */
export function smooth(prev, next, alpha = 0.45) {
  if (!prev) return { ...next };
  return {
    x: prev.x + (next.x - prev.x) * alpha,
    y: prev.y + (next.y - prev.y) * alpha,
  };
}

/**
 * 周期信号极值检测（踏频信号用）。
 * values: number[]; mode: "max" | "min"; minDistance: 最小间隔帧数;
 * prominenceFactor: 相对整体振幅的显著度阈值。
 */
export function findPeaks(values, opts = {}) {
  const mode = opts.mode ?? "max";
  const minDistance = Math.max(2, opts.minDistance ?? 5);
  const prominenceFactor = opts.prominenceFactor ?? 0.25;
  const sign = mode === "max" ? 1 : -1;
  const v = values.map((x) => (Number.isFinite(x) ? x * sign : NaN));
  const finite = v.filter((x) => Number.isFinite(x));
  if (finite.length < 3) return [];
  const range = Math.max(...finite) - Math.min(...finite);
  if (!(range > 0)) return [];
  const promin = range * prominenceFactor;
  const cand = [];
  for (let i = 1; i < v.length - 1; i++) {
    if (!Number.isFinite(v[i])) continue;
    if (v[i] >= v[i - 1] && v[i] > v[i + 1]) {
      const win = Math.min(v.length - 1, i + minDistance * 2);
      let left = Infinity;
      let right = Infinity;
      for (let j = Math.max(0, i - minDistance * 2); j <= i; j++) left = Math.min(left, v[j]);
      for (let j = i; j <= win; j++) right = Math.min(right, v[j]);
      const prom = v[i] - Math.max(left, right);
      if (prom >= promin) cand.push(i);
    }
  }
  const kept = [];
  for (const i of cand) {
    const last = kept[kept.length - 1];
    if (last !== undefined && i - last < minDistance) {
      if (v[i] > v[last]) kept[kept.length - 1] = i;
    } else {
      kept.push(i);
    }
  }
  return kept;
}

/** 人体分段长度估算（mm），由身高或跨高推算 */
export function segmentLengths(heightMm, inseamMm) {
  const inseam = inseamMm > 0 ? inseamMm : heightMm * 0.47;
  const height = heightMm > 0 ? heightMm : inseam / 0.47;
  return {
    femur: 0.245 * height,
    tibia: 0.246 * height,
    foot: 0.152 * height,
    upperArm: 0.186 * height,
    forearm: 0.155 * height,
    torso: 0.3 * height,
    shoulderWidth: 0.245 * height,
    height,
    inseam,
  };
}

/** 髋-踝距离：已知大腿/小腿长度与膝屈角（0=伸直） */
export function hipAnkleDistance(femur, tibia, flexionDeg) {
  const interior = Math.PI - flexionDeg * DEG;
  return Math.sqrt(femur * femur + tibia * tibia - 2 * femur * tibia * Math.cos(interior));
}

/**
 * 每改变 1° 膝屈角，坐垫高度约需改变多少 mm。
 * 由余弦定理对角度求导：ds/dθ = -f·t·sin(θ) / s
 */
export function saddleMmPerDegree(femur, tibia, flexionDeg) {
  const s = hipAnkleDistance(femur, tibia, flexionDeg);
  if (!(s > 0)) return 2.0;
  return (femur * tibia * Math.sin(clamp(flexionDeg, 1, 179) * DEG)) / s * DEG;
}

/**
 * 坐垫高度灵敏度（mm / 度），只依赖“髋-踝距离 s”与当前膝屈角。
 * 由 s = 2f·sin(内角/2) 对角度求导化简得 ds/dθ = s·tan(θ/2)/2。
 */
export function saddleSensitivityMmPerDeg(sMm, flexionDeg) {
  const s = Number(sMm) > 0 ? Number(sMm) : 850;
  const theta = clamp(flexionDeg, 2, 80);
  return (s * Math.tan((theta / 2) * DEG)) / 2 * DEG;
}

/** 双骨 IK：已知根点 a、目标点 b、两段长度，返回两个可能的中间关节 */
export function twoBoneIK(a, b, l1, l2, bendSign = 1) {
  const d = dist(a, b);
  const dd = clamp(d, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  const base = Math.atan2(b.y - a.y, b.x - a.x);
  const cosA = clamp((l1 * l1 + dd * dd - l2 * l2) / (2 * l1 * dd), -1, 1);
  const ang = Math.acos(cosA);
  const th1 = base + bendSign * ang;
  const th2 = base - bendSign * ang;
  return [ { x: a.x + l1 * Math.cos(th1), y: a.y + l1 * Math.sin(th1) },
           { x: a.x + l1 * Math.cos(th2), y: a.y + l1 * Math.sin(th2) } ];
}

/** 两圆交点，返回 0~2 个点 */
export function circleIntersect(c1, r1, c2, r2) {
  const d = dist(c1, c2);
  if (d < 1e-6 || d > r1 + r2 || d < Math.abs(r1 - r2)) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h2 = r1 * r1 - a * a;
  const h = h2 > 0 ? Math.sqrt(h2) : 0;
  const ux = (c2.x - c1.x) / d;
  const uy = (c2.y - c1.y) / d;
  const p = { x: c1.x + a * ux, y: c1.y + a * uy };
  return [
    { x: p.x - h * uy, y: p.y + h * ux },
    { x: p.x + h * uy, y: p.y - h * ux },
  ];
}

/** 把向量绕原点旋转（角度制） */
export function rotate(v, deg) {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

export function fmt(v, digits = 0) {
  if (!Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}
