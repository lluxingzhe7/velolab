// bikefit/src/demo.js
// 演示 / 自检用骑行姿态模拟器：按人体与车辆几何生成侧视骨架，无需摄像头。
import { circleIntersect, segmentLengths, dist, clamp, DEG } from "./geometry.js";

export const DEMO_DEFAULTS = {
  offsets: { saddle: -15, torso: 0 },
  noisePx: 1.2,
  width: 1280,
  height: 720,
  scale: 0.52, // px per mm
  origin: { x: 620, y: 560 }, // BB 在画面中的像素位置
};

function gauss(rng) {
  const u1 = Math.max(1e-6, rng());
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 单侧骨架（mm，y 向上，BB 为原点）；髋坐坐垫、手扶车把、踝在脚踏上 */
export function buildSide(ctx, phaseDeg, hipDx = 0) {
  const { rider, bike } = ctx;
  const seg = segmentLengths(rider.height, rider.inseam);
  const tri = rider.discipline === "tri";
  const hip = { x: -bike.saddleSetback + hipDx + 4, y: bike.saddleHeight + 12 };
  const crank = bike.crankLength;
  const ph = phaseDeg * DEG;
  const pedal = { x: crank * Math.sin(ph), y: -crank * Math.cos(ph) };
  // 踝在脚踏轴心上方约 58mm、略后
  const ankle = { x: pedal.x - 32, y: pedal.y + 74 };

  const kneeCandidates = circleIntersect(hip, seg.femur, ankle, seg.tibia);
  const knee = kneeCandidates.length
    ? kneeCandidates.reduce((a, b) => (a.x > b.x ? a : b))
    : {
        x: hip.x + (seg.femur / (seg.femur + seg.tibia)) * (ankle.x - hip.x) + 30,
        y: hip.y + (seg.femur / (seg.femur + seg.tibia)) * (ankle.y - hip.y),
      };

  const T = ctx.torsoDeg;
  const torsoLen = seg.torso * (ctx.torsoLenFactor || 0.92);
  const shoulder = { x: hip.x + torsoLen * Math.cos(T * DEG), y: hip.y + torsoLen * Math.sin(T * DEG) };

  // 手臂按姿态角构造（保证肩/肘角落在目标区间），车把随后画到手上
  const upperDeg = T - (tri ? 88 : 95);
  const foreDeg = tri ? 0 : -8;
  const elbow = {
    x: shoulder.x + seg.upperArm * Math.cos(upperDeg * DEG),
    y: shoulder.y + seg.upperArm * Math.sin(upperDeg * DEG),
  };
  const wrist = {
    x: elbow.x + seg.forearm * Math.cos(foreDeg * DEG),
    y: elbow.y + seg.forearm * Math.sin(foreDeg * DEG),
  };
  const stretched = false;

  const footLen = seg.foot;
  const toe = { x: ankle.x + footLen * 0.62, y: ankle.y - footLen * 0.16 };
  const heel = { x: ankle.x - footLen * 0.34, y: ankle.y - footLen * 0.04 };
  const headDir = { x: Math.cos(T * DEG), y: Math.sin(T * DEG) };
  const nose = {
    x: shoulder.x + headDir.x * 40 + 48,
    y: shoulder.y + headDir.y * 40 + 86,
  };
  return { hip, knee, ankle, toe, heel, shoulder, elbow, wrist, nose, pedal, stretched };
}

export function toPx(p, ctx) {
  return { x: ctx.origin.x + p.x * ctx.scale, y: ctx.origin.y - p.y * ctx.scale };
}

function jitter(p, ctx, rng) {
  const n = ctx.noisePx || 0;
  return { x: p.x + gauss(rng) * n, y: p.y + gauss(rng) * n };
}

/** 生成一帧（像素坐标） */
export function demoFrame(ctx, t, phaseDeg, rng) {
  const near = buildSide(ctx, phaseDeg, 0);
  const far = buildSide(ctx, phaseDeg + 180, -26);
  const mk = (side, vis) => {
    const o = {};
    for (const k of Object.keys(side)) o[k] = { ...jitter(toPx(side[k], ctx), ctx, rng), vis };
    return o;
  };
  const left = mk(near, 0.95);
  const right = mk(far, 0.52);
  return {
    t,
    left,
    right,
    mid: {
      shoulder: { x: (left.shoulder.x + right.shoulder.x) / 2, y: (left.shoulder.y + right.shoulder.y) / 2 },
      hip: { x: (left.hip.x + right.hip.x) / 2, y: (left.hip.y + right.hip.y) / 2 },
      nose: left.nose,
    },
    vis: { left: 0.95, right: 0.52 },
    phase: phaseDeg,
  };
}

export function demoFrames(ctx, opts = {}) {
  const seconds = opts.seconds ?? 6;
  const fps = opts.fps ?? 30;
  const cadence = opts.cadence ?? 85;
  const rng = makeRng(opts.seed ?? 20260101);
  const frames = [];
  const n = Math.round(seconds * fps);
  const degPerSec = (cadence / 60) * 360;
  for (let i = 0; i < n; i++) {
    const t = (i / fps) * 1000;
    frames.push(demoFrame(ctx, t, (opts.startPhase ?? 0) + (t / 1000) * degPerSec, rng));
  }
  return frames;
}

/** 演示上下文：滑杆偏移叠加到车辆设定上 */
export function demoContext(rider, bike, offsets = DEMO_DEFAULTS.offsets, overrides = {}) {
  const b = { ...bike };
  b.saddleHeight = clamp(b.saddleHeight + (offsets.saddle || 0), 560, 900);
  const baseTorso = rider.discipline === "tri" ? 16 : 38;
  const torsoDeg = baseTorso + (offsets.torso || 0);
  return {
    rider, bike: b, torsoDeg,
    noisePx: DEMO_DEFAULTS.noisePx, scale: DEMO_DEFAULTS.scale, origin: DEMO_DEFAULTS.origin,
    ...overrides,
  };
}
