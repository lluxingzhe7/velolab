// bikefit/src/fit.js
// 拟合计算核心：目标区间、姿态测量、调整建议、推荐初始设定。纯函数，无 DOM 依赖。
import {
  angleAtDeg, angleFromHorizontalDeg, clamp, roundTo, mean, median, stdDev,
  percentile, findPeaks, segmentLengths, saddleSensitivityMmPerDeg, fmt, DEG,
} from "./geometry.js";

export const DISCIPLINES = { road: "公路车", tri: "铁三 / 计时车" };
export const POSITIONS = {
  road: { endurance: "耐力 / 舒适", sport: "竞技", aero: "极限气动" },
  tri: { comfort: "舒适 / 长距离", race: "竞速", aggressive: "极限气动" },
};

// 目标区间（度，2D 侧视）。依据常见 bike fitting 经验区间，个体需按伤病与柔韧度微调。
export const TARGETS = {
  road: {
    endurance: { knee: [25, 35], kneeTdc: [96, 116], hipBdc: [104, 128], hipTdc: [62, 92], torso: [40, 48], shoulder: [78, 98], elbow: [130, 160], foot: [-6, 14] },
    sport: { knee: [25, 35], kneeTdc: [98, 118], hipBdc: [100, 124], hipTdc: [58, 88], torso: [34, 43], shoulder: [75, 95], elbow: [130, 160], foot: [-6, 14] },
    aero: { knee: [25, 35], kneeTdc: [100, 120], hipBdc: [94, 120], hipTdc: [52, 82], torso: [28, 37], shoulder: [72, 92], elbow: [128, 158], foot: [-6, 14] },
  },
  tri: {
    comfort: { knee: [25, 35], kneeTdc: [96, 116], hipBdc: [94, 118], hipTdc: [52, 78], torso: [20, 28], shoulder: [85, 105], elbow: [90, 118], foot: [-6, 14] },
    race: { knee: [25, 35], kneeTdc: [98, 118], hipBdc: [88, 112], hipTdc: [46, 72], torso: [14, 23], shoulder: [85, 105], elbow: [88, 115], foot: [-6, 14] },
    aggressive: { knee: [25, 35], kneeTdc: [100, 120], hipBdc: [82, 106], hipTdc: [40, 66], torso: [10, 19], shoulder: [82, 102], elbow: [85, 112], foot: [-6, 14] },
  },
};

// 灵敏度（经验值，用于把角度误差换算成毫米调整量）
export const SENS = {
  hipPer10mmStack: 1.4, // 前部升高 10mm ≈ 髋角开 1.4°
  torsoPer10mmStack: 0.9, // 前部升高 10mm ≈ 躯干角 +0.9°
  hipPer10mmSaddle: -0.8, // 坐垫升高 10mm ≈ 髋角关 0.8°
  torsoPer10mmSaddle: -0.45,
  crankPer5mmHipTdc: 2.2,
  elbowPer10mmReach: 7,
};

export const DEFAULT_RIDER = {
  height: 1780, inseam: 840, flexibility: 3, discipline: "road", position: "sport",
  cadence: 85, note: "",
};

export const DEFAULT_BIKE = {
  model: "", frameStack: 560, frameReach: 385, saddleHeight: 735, saddleSetback: 25,
  saddleAngle: -1, crankLength: 172.5, stemLength: 100, stemAngle: -6, spacers: 20,
  barReach: 80, barDrop: 128, padStack: 640, padReach: 480, pedalType: "road",
};

export function targetsFor(rider) {
  const d = DISCIPLINES[rider.discipline] ? rider.discipline : "road";
  const pos = POSITIONS[d][rider.position] ? rider.position : Object.keys(POSITIONS[d])[1];
  const base = TARGETS[d][pos];
  const flex = clamp(Number(rider.flexibility) || 3, 1, 5);
  const shift = 3 - flex; // 柔韧度差 → 目标更“开”
  const sh = shift * 2.5;
  const st = shift * 1.5;
  return {
    discipline: d, position: pos,
    knee: [...base.knee], kneeTdc: [...base.kneeTdc],
    hipBdc: [base.hipBdc[0] + sh, base.hipBdc[1] + sh],
    hipTdc: [base.hipTdc[0] + sh * 0.8, base.hipTdc[1] + sh * 0.8],
    torso: [base.torso[0] + st, base.torso[1] + st],
    shoulder: [...base.shoulder], elbow: [...base.elbow],
    foot: [...base.foot],
  };
}

export function recommendCrank(seg, discipline) {
  const table = [
    [1560, 160], [1610, 162.5], [1650, 165], [1690, 167.5], [1730, 170],
    [1770, 172.5], [1810, 172.5], [1860, 175], [9999, 177.5],
  ];
  let base = 170;
  for (const [lim, v] of table) { if (seg.height < lim) { base = v; break; } }
  if (discipline === "tri") base -= 2.5;
  return clamp(roundTo(base, 2.5), 157.5, 177.5);
}

/** 推荐初始设定（基于身体数据） */
export function baselineSetup(rider) {
  const h = Number(rider.height) > 0 ? Number(rider.height) : 1780;
  const inseam = Number(rider.inseam) > 0 ? Number(rider.inseam) : h * 0.47;
  const seg = segmentLengths(h, inseam);
  const flex = clamp(Number(rider.flexibility) || 3, 1, 5);
  const tri = rider.discipline === "tri";
  const saddleHeight = inseam * (tri ? 0.878 : 0.883);
  const setback = tri ? clamp(inseam * 0.012, 0, 18) : clamp(inseam * 0.035, 15, 40);
  const crank = recommendCrank(seg, rider.discipline);
  const drop = 18 + (flex - 1) * 11;
  const padStack = saddleHeight - drop;
  const padReach = h * (0.262 + (flex - 3) * 0.004);
  const barDrop = 45 + (flex - 1) * 13;
  return {
    saddleHeight, setback, crank,
    barDrop, padStack, padReach,
    stemLength: h >= 1830 ? 110 : h >= 1750 ? 100 : h >= 1680 ? 90 : 80,
    torsoAngleTarget: tri ? 14 + (3 - flex) * 1.5 : 36 + (3 - flex) * 1.5,
  };
}

function statusOf(value, [lo, hi]) {
  if (!Number.isFinite(value)) return "na";
  if (value < lo - 0.5) return "low";
  if (value > hi + 0.5) return "high";
  return "ok";
}

/**
 * 从一帧序列中提取姿态测量值。
 * frames: [{ t, left:{...}, right:{...}, mid:{...}, vis:{left,right} }]，坐标为视频像素
 */
export function measureFrames(frames, opts = {}) {
  const side = opts.side && opts.side !== "auto" ? opts.side : chooseSide(frames);
  const pxPerMm = Number(opts.pxPerMm) > 0 ? Number(opts.pxPerMm) : null;
  const usable = frames.filter((f) => f && f[side] && f[side].knee && f[side].ankle && f[side].hip);
  if (usable.length < 8) {
    return { ok: false, side, frames: usable.length, reason: "样本不足", warnings: ["录制样本不足，请至少录制 3 秒"] };
  }
  // 车头方向：由髋→肩水平分量决定（骑行时躯干总是朝前）
  let fwd = 0;
  for (const f of usable) fwd += Math.sign((f.mid?.shoulder?.x ?? f[side].shoulder.x) - (f.mid?.hip?.x ?? f[side].hip.x)) || 0;
  const forwardSign = fwd >= 0 ? 1 : -1;

  const rows = usable.map((f) => {
    const s = f[side];
    const kneeFlex = 180 - angleAtDeg(s.hip, s.knee, s.ankle);
    return {
      t: f.t,
      relY: s.ankle.y - s.hip.y,
      kneeFlex,
      hip: angleAtDeg(s.shoulder, s.hip, s.knee),
      torso: angleFromHorizontalDeg(s.hip, s.shoulder, forwardSign),
      shoulder: angleAtDeg(s.hip, s.shoulder, s.elbow),
      elbow: angleAtDeg(s.shoulder, s.elbow, s.wrist),
      foot: s.heel && s.toe ? angleFromHorizontalDeg(s.heel, s.toe, forwardSign) : NaN,
      ankle: s.toe ? angleAtDeg(s.knee, s.ankle, s.toe) : NaN,
      kneeAhead: (s.knee.x - (s.heel && s.toe ? s.heel.x + 0.72 * (s.toe.x - s.heel.x) : s.ankle.x)) * forwardSign,
      // 踏轴最前（≈3 点钟）用踝部水平位置判定：踝绕踏轴做圆周运动，水平最前即踏轴最前
      ankleX: s.ankle.x * forwardSign,
      vis: mean([s.knee.vis, s.ankle.vis, s.hip.vis, s.shoulder.vis].filter((v) => Number.isFinite(v))),
    };
  }).filter((r) => Number.isFinite(r.relY) && Number.isFinite(r.kneeFlex));

  if (rows.length < 8) return { ok: false, side, frames: rows.length, reason: "关键点缺失", warnings: ["无法稳定识别髋/膝/踝，请调整机位与光照"] };

  // 平滑垂直行程，找下死点 / 上死点
  const rel = rows.map((r) => r.relY);
  const smoothed = rel.map((v, i) => {
    const a = rel[Math.max(0, i - 2)];
    const b = rel[Math.min(rel.length - 1, i + 2)];
    return (a + v * 2 + b) / 4;
  });
  const lows = findPeaks(smoothed, { mode: "max", minDistance: 4, prominenceFactor: 0.3 });
  const highs = findPeaks(smoothed, { mode: "min", minDistance: 4, prominenceFactor: 0.3 });
  const p10 = percentile(smoothed, 0.1);
  const p90 = percentile(smoothed, 0.9);
  const bdcRows = rows.filter((r, i) => smoothed[i] >= p90);
  const tdcRows = rows.filter((r, i) => smoothed[i] <= p10);

  const bdcKnee = bdcRows.map((r) => r.kneeFlex);
  const perStrokeKnee = lows.map((idx) => {
    const lo = Math.max(0, idx - 2);
    const hi = Math.min(rows.length - 1, idx + 2);
    return mean(rows.slice(lo, hi + 1).map((r) => r.kneeFlex));
  });

  let cadence = NaN;
  if (lows.length >= 2) {
    const dts = [];
    for (let i = 1; i < lows.length; i++) dts.push((rows[lows[i]].t - rows[lows[i - 1]].t) / 1000);
    const avg = mean(dts.filter((d) => d > 0.2 && d < 2.5));
    if (avg > 0) cadence = 60 / avg;
  }

  // KOPS：脚踏最前方的若干帧
  const ankleSeries = rows.map((r) => r.ankleX);
  const p95 = percentile(ankleSeries, 0.95);
  const fwdRows = rows.filter((r) => r.ankleX >= p95);
  const kopsPx = median(fwdRows.map((r) => r.kneeAhead));

  const visibility = mean(rows.map((r) => r.vis).filter((v) => Number.isFinite(v)));
  const warnings = [];
  if (lows.length < 2) warnings.push("踏频识别不足（少于 2 个完整踩踏周期），请延长录制到 5 秒以上");
  if (Number.isFinite(visibility) && visibility < 0.55) warnings.push("关键点可见度偏低，请让全身（髋、膝、踝、肩、腕）完整入镜");
  if (!pxPerMm) warnings.push("尚未校准，前后方向（KOPS）暂不给出毫米建议");
  const kneeStd = perStrokeKnee.length >= 2 ? stdDev(perStrokeKnee) : 0;
  if (kneeStd > 4) warnings.push("各踏频周期膝角差异较大，请保持稳定踩踏后重测");

  return {
    ok: true, side, frames: rows.length, strokes: lows.length, cadence,
    kneeFlex: mean(rows.map((r) => r.kneeFlex)),
    kneeFlexBdc: mean(bdcKnee),
    kneeFlexTdc: mean(tdcRows.map((r) => r.kneeFlex)),
    kneeFlexStd: kneeStd,
    hipBdc: mean(bdcRows.map((r) => r.hip)),
    hipTdc: mean(tdcRows.map((r) => r.hip)),
    torso: mean(rows.map((r) => r.torso)),
    shoulder: mean(rows.map((r) => r.shoulder)),
    elbow: mean(rows.map((r) => r.elbow)),
    foot: mean(bdcRows.map((r) => r.foot)),
    ankle: mean(rows.map((r) => r.ankle)),
    kops: pxPerMm ? kopsPx / pxPerMm : NaN,
    kopsPx,
    kopsOk: Boolean(pxPerMm),
    visibility, kneeStd,
    forwardSign,
    strokesFound: lows.length,
    warnings,
  };
}

export function chooseSide(frames) {
  let l = 0; let r = 0;
  for (const f of frames) {
    if (f?.vis) { l += Number(f.vis.left) || 0; r += Number(f.vis.right) || 0; }
  }
  return l >= r ? "left" : "right";
}

export function readings(meas, t) {
  return [
    { key: "knee", label: "下死点膝角", value: meas.kneeFlexBdc, unit: "°", range: t.knee, hint: "0° = 完全伸直", digits: 1 },
    { key: "hipBdc", label: "下死点髋角", value: meas.hipBdc, unit: "°", range: t.hipBdc, hint: "躯干与大腿夹角，越大越开", digits: 1 },
    { key: "kneeTdc", label: "上死点膝角", value: meas.kneeFlexTdc, unit: "°", range: t.kneeTdc, hint: "越大越屈膝，参考坐垫前后与曲柄", digits: 1 },
    { key: "hipTdc", label: "上死点髋角", value: meas.hipTdc, unit: "°", range: t.hipTdc, hint: "低于下限易髋部撞击", digits: 1 },
    { key: "torso", label: "躯干角", value: meas.torso, unit: "°", range: t.torso, hint: "相对水平线", digits: 1 },
    { key: "elbow", label: "肘角", value: meas.elbow, unit: "°", range: t.elbow, hint: "越小越弯", digits: 1 },
    { key: "shoulder", label: "肩角", value: meas.shoulder, unit: "°", range: t.shoulder, hint: "上臂与躯干夹角", digits: 1 },
    { key: "foot", label: "下死点足角", value: meas.foot, unit: "°", range: t.foot, hint: "脚尖下压为正", digits: 1 },
  ];
}

/**
 * 生成调整建议。返回 { items, notes, projected, confidence }
 */
export function recommend(meas, rider, bike) {
  const t = targetsFor(rider);
  const seg = segmentLengths(Number(rider.height) || 1780, Number(rider.inseam) || 0);
  const items = [];
  const notes = [];
  if (!meas.ok) return { items, notes: ["测量失败：先解决数据质量问题"], projected: {}, confidence: "low" };

  const hipAnkleMm = Number(meas.hipAnkleMm) > 0
    ? meas.hipAnkleMm
    : Number(bike.saddleHeight) + Number(bike.crankLength) - 55;
  const mmPerDeg = saddleSensitivityMmPerDeg(hipAnkleMm, clamp(meas.kneeFlexBdc, 5, 80));
  const kneeAim = clamp(30, t.knee[0] + 1, t.knee[1] - 1);
  let saddleDelta = 0;

  // 1) 坐垫高度
  if (meas.kneeFlexBdc > t.knee[1] + 0.5) {
    let amount = (meas.kneeFlexBdc - kneeAim) * mmPerDeg;
    amount = clamp(roundTo(amount, 5), 5, 30);
    saddleDelta = amount;
    items.push({
      id: "saddleHeight", priority: 1, part: "坐垫高度", action: "升高", amount, unit: "mm",
      why: `下死点膝角 ${fmt(meas.kneeFlexBdc, 1)}°，高于目标上限 ${t.knee[1]}°，坐垫偏低（常见 1° ≈ ${fmt(mmPerDeg, 1)}mm）`,
      expected: `膝角约 ${fmt(meas.kneeFlexBdc - amount / mmPerDeg, 1)}°，髋角约 ${fmt(meas.hipBdc - amount * 0.08, 1)}°`,
      confidence: "high",
    });
  } else if (meas.kneeFlexBdc < t.knee[0] - 1) {
    let amount = (kneeAim - meas.kneeFlexBdc) * mmPerDeg;
    amount = clamp(roundTo(amount, 5), 5, 20);
    saddleDelta = -amount;
    items.push({
      id: "saddleHeight", priority: 1, part: "坐垫高度", action: "降低", amount, unit: "mm",
      why: `下死点膝角 ${fmt(meas.kneeFlexBdc, 1)}°，低于目标下限 ${t.knee[0]}°，坐垫偏高（易骨盆摇摆、跟腱与膝后侧紧张）`,
      expected: `膝角约 ${fmt(meas.kneeFlexBdc + amount / mmPerDeg, 1)}°`,
      confidence: "high",
    });
  } else {
    items.push({ id: "saddleHeight", priority: 1, part: "坐垫高度", action: "保持不变", amount: 0, unit: "mm", why: `下死点膝角 ${fmt(meas.kneeFlexBdc, 1)}°，在 ${t.knee[0]}–${t.knee[1]}° 目标区间内`, expected: "无需改动", confidence: "high" });
  }

  // 2) 坐垫前后：上死点膝角过紧/过松时给 5~10mm 的一步试调（前后位移对角度影响小，属经验判断）
  const [tlo, thi] = t.kneeTdc;
  if (meas.kneeFlexTdc > thi + 6) {
    items.push({ id: "setback", priority: 2, part: "坐垫前后", action: "后移", amount: 5, unit: "mm", why: `上死点膝角 ${fmt(meas.kneeFlexTdc, 1)}°，明显高于 ${thi}°，髋-膝空间偏紧`, expected: `上死点膝角略降、髋角略开；单次 5mm 试调后重测`, confidence: "low" });
  } else if (meas.kneeFlexTdc < tlo - 6) {
    items.push({ id: "setback", priority: 2, part: "坐垫前后", action: "前移", amount: 5, unit: "mm", why: `上死点膝角 ${fmt(meas.kneeFlexTdc, 1)}°，明显低于 ${tlo}°，踩踏位置偏后`, expected: `上死点膝角略升；单次 5mm 试调后重测`, confidence: "low" });
  } else {
    items.push({ id: "setback", priority: 2, part: "坐垫前后", action: "保持不变", amount: 0, unit: "mm", why: `上死点膝角 ${fmt(meas.kneeFlexTdc, 1)}°，在 ${tlo}–${thi}° 区间（膝前移实测 ${fmt(meas.kops)}mm 仅作参考）`, expected: "无需改动", confidence: "medium" });
  }

  // 3) 髋角（先补偿坐垫高度带来的变化）
  const hipAfterSaddle = meas.hipBdc + saddleDelta * (SENS.hipPer10mmSaddle / 10);
  const hipTdcAfterSaddle = meas.hipTdc + saddleDelta * (SENS.hipPer10mmSaddle / 10);
  const hipDeficit = Math.max(0, t.hipBdc[0] - hipAfterSaddle);
  const hipTdcDeficit = Math.max(0, t.hipTdc[0] - hipTdcAfterSaddle);
  let stackDelta = 0;
  if (Math.max(hipDeficit, hipTdcDeficit) > 2) {
    const need = Math.max(hipDeficit, hipTdcDeficit);
    let amount = clamp(roundTo((need / SENS.hipPer10mmStack) * 10, 5), 5, 25);
    stackDelta = amount;
    items.push({
      id: "frontStack", priority: 3, part: rider.discipline === "tri" ? "休息把垫高（pad stack）" : "车把高度（垫圈/把立）",
      action: "升高", amount, unit: "mm",
      why: `髋角 ${fmt(hipAfterSaddle, 1)}°（上死点 ${fmt(hipTdcAfterSaddle, 1)}°），低于目标 ${fmt(t.hipBdc[0], 1)}°/${fmt(t.hipTdc[0], 1)}°，前部过低会压缩髋部活动空间`,
      expected: `髋角约 ${fmt(hipAfterSaddle + amount * SENS.hipPer10mmStack / 10, 1)}°，躯干角 +约 ${fmt(amount * SENS.torsoPer10mmStack / 10, 1)}°`,
      confidence: "medium",
    });
    if (need > 8 && bike.crankLength - recommendCrank(seg, rider.discipline) >= 2.5) {
      notes.push("髋角缺口较大：优先缩短曲柄（每 5mm 约开 2.2°），再抬高前部，比单纯堆垫圈更有效");
    }
  }

  // 4) 躯干角（与髋角冲突时以髋角优先）
  const torsoAfter = meas.torso + stackDelta * (SENS.torsoPer10mmStack / 10) + saddleDelta * (SENS.torsoPer10mmSaddle / 10);
  if (torsoAfter > t.torso[1] + 2.5 && stackDelta === 0) {
    const amount = clamp(roundTo(((torsoAfter - (t.torso[0] + t.torso[1]) / 2) / SENS.torsoPer10mmStack) * 10, 5), 5, 25);
    items.push({
      id: "frontDrop", priority: 3, part: rider.discipline === "tri" ? "休息把高度（pad stack）" : "车把高度（垫圈/把立）",
      action: "降低", amount, unit: "mm",
      why: `躯干角 ${fmt(torsoAfter, 1)}°，高于目标上限 ${fmt(t.torso[1], 1)}°，姿态偏直立，风阻偏大`,
      expected: `躯干角约 ${fmt(torsoAfter - amount * SENS.torsoPer10mmStack / 10, 1)}°，注意髋角会同步变小`,
      confidence: "medium",
    });
    notes.push("降低前部前请确认髋角仍在目标区间；若髋角变紧，应先改善髋屈柔韧性或缩短曲柄");
  } else if (torsoAfter < t.torso[0] - 2.5 && stackDelta === 0) {
    const amount = clamp(roundTo(((t.torso[0] + t.torso[1]) / 2 - torsoAfter) / SENS.torsoPer10mmStack * 10, 5), 5, 25);
    stackDelta = amount;
    items.push({
      id: "frontStack2", priority: 3, part: rider.discipline === "tri" ? "休息把高度（pad stack）" : "车把高度（垫圈/把立）",
      action: "升高", amount, unit: "mm",
      why: `躯干角 ${fmt(torsoAfter, 1)}°，低于目标下限 ${fmt(t.torso[0], 1)}°，长时间骑行颈肩压力大`,
      expected: `躯干角约 ${fmt(torsoAfter + amount * SENS.torsoPer10mmStack / 10, 1)}°`,
      confidence: "medium",
    });
  }

  // 5) 前伸（把立长度 / 休息把前后）
  const elbowMid = (t.elbow[0] + t.elbow[1]) / 2;
  if (rider.discipline === "tri") {
    if (meas.elbow > t.elbow[1] + 8) {
      const amount = clamp(roundTo(Math.abs(meas.elbow - elbowMid) / SENS.elbowPer10mmReach * 10, 5), 5, 15);
      items.push({ id: "padReach", priority: 4, part: "休息把前后（pad reach）", action: "后移", amount, unit: "mm", why: `肘角 ${fmt(meas.elbow, 1)}°，手臂过直，休息把偏前`, expected: `肘角约 ${fmt(meas.elbow - amount / 10 * SENS.elbowPer10mmReach, 1)}°`, confidence: "medium" });
    } else if (meas.elbow < t.elbow[0] - 8) {
      const amount = clamp(roundTo(Math.abs(meas.elbow - elbowMid) / SENS.elbowPer10mmReach * 10, 5), 5, 15);
      items.push({ id: "padReach", priority: 4, part: "休息把前后（pad reach）", action: "前移", amount, unit: "mm", why: `肘角 ${fmt(meas.elbow, 1)}°，手臂过弯，休息把偏近（胸口受压、呼吸受限）`, expected: `肘角约 ${fmt(meas.elbow + amount / 10 * SENS.elbowPer10mmReach, 1)}°`, confidence: "medium" });
    }
  } else {
    if (meas.elbow > t.elbow[1] + 10) {
      const amount = 10;
      items.push({ id: "stem", priority: 4, part: "把立长度", action: "缩短", amount, unit: "mm", why: `肘角 ${fmt(meas.elbow, 1)}°，手臂偏直，前伸过大`, expected: "肘角约减少 3–5°，肩颈压力下降", confidence: "low" });
    } else if (meas.elbow < t.elbow[0] - 10) {
      items.push({ id: "stem", priority: 4, part: "把立长度", action: "加长", amount: 10, unit: "mm", why: `肘角 ${fmt(meas.elbow, 1)}°，手臂过弯，前伸不足（胸口受压）`, expected: "肘角约增加 3–5°", confidence: "low" });
    }
  }

  // 6) 曲柄长度
  const recCrank = recommendCrank(seg, rider.discipline);
  if (bike.crankLength - recCrank >= 2.5) {
    const diff = bike.crankLength - recCrank;
    items.push({
      id: "crank", priority: 5, part: "曲柄长度", action: "缩短", amount: diff, unit: "mm",
      why: `当前 ${bike.crankLength}mm，按身高/车型建议约 ${recCrank}mm；短曲柄可开髋角、减小膝前移`,
      expected: `上死点髋角约 + ${fmt(diff / 5 * SENS.crankPer5mmHipTdc, 1)}°，膝前移约减少 ${fmt(diff * 0.6)}mm`,
      confidence: "medium",
    });
  }

  // 7) 足角提示
  if (meas.foot > 20) notes.push(`下死点足角 ${fmt(meas.foot, 1)}°（明显脚尖下压）：常见于坐垫偏高或踝关节代偿，先按膝角复核坐垫高度`);
  if (meas.foot < -12) notes.push(`下死点足角 ${fmt(meas.foot, 1)}°（脚跟过低）：常见于坐垫偏低或锁片位置偏前，注意跟腱负荷`);
  if (meas.hipTdc < t.hipTdc[0] - 3) notes.push(`上死点髋角 ${fmt(meas.hipTdc, 1)}° 偏小：优先缩短曲柄、抬高前部，避免髋部撞击与功率损失`);
  if (meas.kopsOk) notes.push(`膝前移指数 ${fmt(meas.kops)}mm（3 点钟方向：膝关节中心相对脚掌支点的水平距离）。此口径以关节中心计，比传统 KOPS（胫骨粗隆对齐踏轴）系统性偏大，绝对值不要和经验值对比；只在同一机位下比较改动前后——坐垫前移 10mm 该值约减少 10mm，可用来验证 5mm 一步的调整是否生效`);

  items.sort((a, b) => a.priority - b.priority || b.amount - a.amount);
  const confidence = meas.strokes >= 3 && (meas.visibility ?? 0) > 0.6 ? "high" : meas.strokes >= 2 ? "medium" : "low";
  const projected = {
    knee: meas.kneeFlexBdc - saddleDelta / mmPerDeg,
    hipBdc: meas.hipBdc + saddleDelta * (SENS.hipPer10mmSaddle / 10) + stackDelta * (SENS.hipPer10mmStack / 10),
    torso: meas.torso + stackDelta * (SENS.torsoPer10mmStack / 10) + saddleDelta * (SENS.torsoPer10mmSaddle / 10),
  };
  return { items, notes, projected, confidence };
}

export function summarize(meas, rec, rider, bike) {
  const t = targetsFor(rider);
  const rs = readings(meas, t).map((r) => ({ ...r, status: r.requiresCalibration && !meas.kopsOk ? "na" : statusOf(r.value, r.range) }));
  const base = baselineSetup(rider);
  const diffs = [
    { label: "坐垫高度（BB→坐垫面）", current: bike.saddleHeight, recommended: base.saddleHeight, unit: "mm" },
    { label: "坐垫后移", current: bike.saddleSetback, recommended: base.setback, unit: "mm" },
    { label: "曲柄长度", current: bike.crankLength, recommended: base.crank, unit: "mm" },
  ];
  if (rider.discipline === "tri") {
    diffs.push({ label: "休息把高度（BB→垫面）", current: bike.padStack, recommended: base.padStack, unit: "mm" });
    diffs.push({ label: "休息把前后（BB→垫中心）", current: bike.padReach, recommended: base.padReach, unit: "mm" });
  } else {
    diffs.push({ label: "坐垫→车把落差", current: bike.saddleHeight - (bike.frameStack + bike.spacers + 40), recommended: base.barDrop, unit: "mm" });
  }
  return { readings: rs, baseline: base, diffs, items: rec.items, notes: rec.notes, confidence: rec.confidence, projected: rec.projected, targets: t };
}

export function reportMarkdown(res, meas, rider, bike) {
  const L = [];
  L.push("# 骑行姿态拟合报告");
  L.push("");
  L.push(`- 车型：${DISCIPLINES[rider.discipline]} / ${POSITIONS[rider.discipline][rider.position]}`);
  L.push(`- 身高 ${rider.height}mm，跨高 ${rider.inseam}mm，柔韧度 ${rider.flexibility}/5`);
  L.push(`- 坐垫高 ${bike.saddleHeight}mm，后移 ${bike.saddleSetback}mm，曲柄 ${bike.crankLength}mm，把立 ${bike.stemLength}mm`);
  L.push("");
  L.push("## 实测角度");
  L.push("");
  L.push("| 指标 | 实测 | 目标 | 判定 |");
  L.push("| --- | --- | --- | --- |");
  for (const r of res.readings) {
    const range = Number.isFinite(r.range[0]) ? `${r.range[0]}–${r.range[1]}` : "—";
    const v = r.status === "na" ? "需校准" : `${fmt(r.value, r.digits)}${r.unit}`;
    L.push(`| ${r.label} | ${v} | ${range}${r.unit} | ${r.status === "ok" ? "正常" : r.status === "high" ? "偏高" : r.status === "low" ? "偏低" : "—"} |`);
  }
  L.push("");
  L.push("## 调整建议");
  L.push("");
  if (!res.items.length) L.push("当前姿态基本在目标区间，无需调整。");
  for (const it of res.items) {
    const amt = it.amount > 0 ? ` ${it.action} ${it.amount}${it.unit}` : ` ${it.action}`;
    L.push(`- **${it.part}**：${amt}` + (it.amount > 0 ? `（${it.why}；预期：${it.expected}）` : `（${it.why}）`));
  }
  L.push("");
  if (res.notes.length) { L.push("## 提示"); L.push(""); res.notes.forEach((n) => L.push(`- ${n}`)); L.push(""); }
  L.push("## 推荐初始设定 vs 当前");
  L.push("");
  L.push("| 项目 | 当前 | 推荐 |");
  L.push("| --- | --- | --- |");
  for (const d of res.diffs) L.push(`| ${d.label} | ${fmt(d.current, 1)}${d.unit} | ${fmt(d.recommended, 1)}${d.unit} |`);
  L.push("");
  L.push(`数据质量：${meas.frames} 帧 / ${meas.strokes} 个踏频周期 / 置信度 ${res.confidence}`);
  return L.join("\n");
}
