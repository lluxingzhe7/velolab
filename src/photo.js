// bikefit/src/photo.js
// 照片模式：PedalPro 的做法——不用视频，用一张侧拍照片标定关节，直接算角度。
// 纯数据与数学，绘制与交互在 app.js 里。
import { angleAtDeg, angleFromHorizontalDeg, dist } from "./geometry.js";

/** 需要标定的关节。顺序即引导顺序：先髋→膝→踝→肩→肘→腕，可选脚跟脚尖。 */
export const JOINTS = [
  { id: "hip", label: "髋", full: "大转子（髋外侧的骨点）", must: true, color: "#3d8bfd" },
  { id: "knee", label: "膝", full: "膝关节外侧中点（腓骨小头附近）", must: true, color: "#2dd4bf" },
  { id: "ankle", label: "踝", full: "外踝骨点", must: true, color: "#f0a020" },
  { id: "shoulder", label: "肩", full: "肩峰（肩关节外侧）", must: true, color: "#a78bfa" },
  { id: "elbow", label: "肘", full: "肘关节外侧", must: true, color: "#f472b6" },
  { id: "wrist", label: "腕", full: "手腕（手变头的握点）", must: true, color: "#38bdf8" },
  { id: "heel", label: "脚跟", full: "鞋跟最后端（可选，用于足角）", must: false, color: "#94a3b8" },
  { id: "toe", label: "脚尖", full: "鞋头最前端（可选，用于足角）", must: false, color: "#94a3b8" },
];

export const POINT_IDS = JOINTS.map((j) => j.id);
export const REQUIRED_IDS = JOINTS.filter((j) => j.must).map((j) => j.id);

export function emptyPhoto() {
  return { points: {}, order: [] };
}

export function setPoint(photo, id, x, y) {
  const next = { points: { ...photo.points }, order: photo.order.slice() };
  next.points[id] = { x, y };
  if (!next.order.includes(id)) next.order.push(id);
  return next;
}

export function undoPoint(photo) {
  const last = photo.order[photo.order.length - 1];
  if (!last) return emptyPhoto();
  const points = { ...photo.points };
  delete points[last];
  return { points, order: photo.order.filter((i) => i !== last) };
}

export function nextJoint(photo) {
  return JOINTS.find((j) => !photo.points[j.id]) || null;
}

export function missingRequired(photo) {
  return REQUIRED_IDS.filter((id) => !photo.points[id]);
}

/**
 * 由标定点算测量值。坐标可以是像素、也可以是相对坐标，只要同比例即可。
 * 只反映快门那一刻的姿态：上死点相关的项（kneeFlexTdc / hipTdc）置 NaN。
 */
export function photoMeas(photo) {
  const p = photo.points || {};
  const miss = missingRequired(photo);
  if (miss.length) {
    return { ok: false, photo: true, missing: miss, reason: "还需标定 " + miss.map((id) => (JOINTS.find((j) => j.id === id) || {}).label).join("、"), warnings: [] };
  }
  const { hip, knee, ankle, shoulder, elbow, wrist, heel, toe } = p;
  const fwdRef = (wrist || elbow || toe || ankle);
  const forwardSign = Math.sign(fwdRef.x - hip.x) || 1;

  const kneeFlexBdc = 180 - angleAtDeg(hip, knee, ankle);
  const hipBdc = angleAtDeg(shoulder, hip, knee);
  const torso = angleFromHorizontalDeg(hip, shoulder, forwardSign);
  const shoulderDeg = angleAtDeg(hip, shoulder, elbow);
  const elbowDeg = angleAtDeg(shoulder, elbow, wrist);
  const footDeg = heel && toe ? angleFromHorizontalDeg(heel, toe, forwardSign) : NaN;
  const thigh = dist(hip, knee);
  const shank = dist(knee, ankle);
  const warnings = [
    "单张照片只反映按下快门那一刻的姿态：请在下死点（脚踩到最低点）附近拍照，膝角才与目标区间可比。",
    "照片给不出踏频、左右不对称与上死点姿态；上死点相关判定需要视频采样。",
  ];
  if (Math.abs(thigh - shank) / Math.max(thigh, shank) > 0.22) {
    warnings.push("大腿与小臂长度比异常（" + (thigh / Math.max(shank, 1)).toFixed(2) + "），可能有个关节标偏了，建议撤销后重点。");
  }
  return {
    ok: true,
    photo: true,
    side: "photo",
    frames: 1,
    strokes: 0,
    framesUsed: 1,
    cadence: NaN,
    kneeFlex: kneeFlexBdc,
    kneeFlexBdc,
    kneeFlexTdc: NaN,
    kneeFlexStd: 0,
    hipBdc,
    hipTdc: NaN,
    torso,
    shoulder: shoulderDeg,
    elbow: elbowDeg,
    foot: footDeg,
    ankle: NaN,
    kops: NaN,
    kopsPx: NaN,
    kopsOk: false,
    visibility: 1,
    kneeStd: 0,
    forwardSign,
    strokesFound: 0,
    single: true,
    thighPx: thigh,
    shankPx: shank,
    warnings,
  };
}

/** 标定完成后可直接展示的角度摘要 */
export function photoAngles(photo) {
  const m = photoMeas(photo);
  if (!m.ok) return null;
  return {
    knee: Math.round(m.kneeFlexBdc * 10) / 10,
    hip: Math.round(m.hipBdc * 10) / 10,
    torso: Math.round(m.torso * 10) / 10,
    shoulder: Math.round(m.shoulder * 10) / 10,
    elbow: Math.round(m.elbow * 10) / 10,
    foot: Number.isFinite(m.foot) ? Math.round(m.foot * 10) / 10 : null,
  };
}

/** 把照片上的像素比例换算成毫米（用已知的坐垫高度做标尺时可用；这里给出通用式） */
export function mmPerPixelFromReference(pixels, mm) {
  if (!(pixels > 0) || !(mm > 0)) return NaN;
  return mm / pixels;
}
