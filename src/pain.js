// bikefit/src/pain.js
// 疼痛定位诊断：对应 Posely 的「Something hurts? Tap where」。
// 把「哪里疼」映射为「可能原因 + 可执行的毫米级调整」，并优先采用本次实测角度作为证据。
// 纯函数，不依赖 DOM，便于单元测试。

/** 侧视人体轮廓上的疼痛点，坐标是 0..100 x 0..160 的 viewBox 百分比 */
export const PAIN_AREAS = [
  {
    id: "neck", label: "颈后 / 肩颈", spot: "颈部两侧", x: 58, y: 37,
    causes: [
      { test: (m, t) => m.torso > t.torso[1] + 3, cause: "躯干过于前倾，颈部要持续后仰看路", fix: "把横降低 10mm 或用更长把立，让颈椎回到中立位", metric: "torso" },
      { test: (m, t) => m.shoulder > t.shoulder[1] + 6, cause: "肩角过大：手臂伸得太远，力传到颈肩", fix: "把立缩短 10mm，或把刹把向上旋转 5°", metric: "shoulder" },
      { test: (m) => Number.isFinite(m.elbow) && m.elbow > 165, cause: "肘部锁死，缺少缓冲，冲击直接传到肩颈", fix: "肘部保持 15–25° 微屈，必要时缩短把立 10mm", metric: "elbow" },
    ],
  },
  {
    id: "lower-back", label: "下背 / 腰", spot: "腰椎两侧", x: 48, y: 56,
    causes: [
      { test: (m, t) => m.torso < t.torso[0] - 3, cause: "躯干过于平伏，腰椎被动代偿", fix: "抬升把横 10mm 或减少把立下沉量，先放松 2 周", metric: "torso" },
      { test: (m, t) => m.hipBdc > t.hipBdc[1] + 4, cause: "髋角过开，骨盆前倾拉扯腰背筋膜", fix: "坐垫前移 5mm 并略微降低 3–5mm", metric: "hipBdc" },
      { test: (m, t) => m.hipBdc < t.hipBdc[0] - 4, cause: "髋角过闭，腰椎被迫弯曲代偿", fix: "坐垫升高 5mm、把横降低 5mm，做髋屈肌放松", metric: "hipBdc" },
    ],
  },
  {
    id: "sitbone", label: "坐骨 / 会阴", spot: "坐垫接触处", x: 38, y: 71,
    causes: [
      { test: (m, t) => m.torso > t.torso[1] + 6, cause: "坐姿过立，全部体重压在坐骨", fix: "把横降低 10mm，让部分体重分到手臂", metric: "torso" },
      { test: (m) => Number.isFinite(m.saddleSetbackHint) && m.saddleSetbackHint > 40, cause: "坐垫位置偏后，接触面变窄", fix: "坐垫前移 5mm 并重测膝前移", metric: "setback" },
    ],
  },
  {
    id: "hand", label: "手掌 / 手腕", spot: "手掌根部", x: 84, y: 58,
    causes: [
      { test: (m, t) => m.shoulder > t.shoulder[1] + 6, cause: "手臂太长，手部承担过多体重", fix: "把立缩短 10mm，或坐垫后移 3mm", metric: "shoulder" },
      { test: (m, t) => m.elbow > t.elbow[1] + 5, cause: "肘角过大（伸太直），腕部被压弯", fix: "抬高把横 10mm 让肘部自然弯曲", metric: "elbow" },
      { test: (m, t) => m.torso < t.torso[0] - 3, cause: "躯干过平，手部持续承重", fix: "抬升把横 15mm，或加一层把带", metric: "torso" },
    ],
  },
  {
    id: "hip-front", label: "髋前 / 腹股沟", spot: "髋关节前方", x: 45, y: 74,
    causes: [
      { test: (m, t) => m.kneeFlexTdc > t.kneeTdc[1] + 5, cause: "上死点屈髋过深，髋前被反复挤压", fix: "曲柄缩短 5mm（172.5→167.5），或坐垫后移 3mm", metric: "kneeTdc" },
      { test: (m, t) => m.hipTdc < t.hipTdc[0] - 3, cause: "上死点髋角过闭", fix: "坐垫升高 5mm 并降低把横，打开髋角", metric: "hipTdc" },
    ],
  },
  {
    id: "knee-front", label: "膝前 / 髌骨", spot: "膝盖前方", x: 69, y: 90,
    causes: [
      { test: (m, t) => m.kneeFlexBdc < t.knee[0] - 1, cause: "下死点伸太直（膝角过小），髌骨压力集中在股四头肌", fix: "坐垫降低 5–10mm，下死点膝角回到 30° 左右", metric: "knee" },
      { test: (m, t) => m.kneeFlexBdc > t.knee[1] + 1, cause: "下死点屈膝过深，膝前压力增加", fix: "坐垫升高 5–10mm", metric: "knee" },
      { test: (m) => Number.isFinite(m.kops) && m.kops > 10, cause: "膝盖前移超出踏轴过多（KOPS 偏前）", fix: "坐垫后移 5mm，让膝盖落在踏轴正上方", metric: "kops" },
    ],
  },
  {
    id: "knee-back", label: "膝后 / 腘窝", spot: "膝后侧", x: 58, y: 88,
    causes: [
      { test: (m, t) => m.kneeFlexBdc < t.knee[0] - 2, cause: "坐垫偏高，膝后侧肌腱被过度牵拉", fix: "坐垫降低 5–10mm（一次不要超过 10mm）", metric: "knee" },
      { test: (m) => Number.isFinite(m.foot) && m.foot < -5, cause: "踝部过度跖屈，膝后链张力大", fix: "锁片后移 2mm，或降低坐垫 3mm", metric: "foot" },
    ],
  },
  {
    id: "achilles", label: "跟腱 / 踝后", spot: "脚踝后方", x: 50, y: 102,
    causes: [
      { test: (m, t) => m.kneeFlexBdc < t.knee[0] - 2, cause: "坐垫偏高导致踝部过度伸展", fix: "坐垫降低 5–10mm", metric: "knee" },
      { test: (m) => Number.isFinite(m.foot) && m.foot > 25, cause: "踝部过度跖屈，跟腱负荷集中", fix: "锁片后移 3mm，或降低坐垫 5mm", metric: "foot" },
    ],
  },
  {
    id: "foot", label: "脚掌 / 足弓", spot: "脚掌中部", x: 60, y: 109,
    causes: [
      { test: (m) => Number.isFinite(m.foot) && m.foot > 30, cause: "脚尖压得过低，足底筋膜被拉紧", fix: "锁片后移 2–3mm，检查鞋楦宽度与足弓支撑", metric: "foot" },
      { test: (m, t) => m.kneeFlexBdc > t.knee[1] + 2, cause: "坐垫偏低，踩踏时脚掌被迫外翻", fix: "坐垫升高 5mm，检查锁片内外角度", metric: "knee" },
    ],
  },
];

const METRIC_LABEL = {
  knee: "下死点膝角", hipBdc: "下死点髋角", kneeTdc: "上死点膝角", hipTdc: "上死点髋角",
  torso: "躯干角", shoulder: "肩角", elbow: "肘角", foot: "足角", kops: "膝前移", setback: "坐垫前后",
};

export function areaById(id) {
  return PAIN_AREAS.find((a) => a.id === id) || null;
}

/**
 * 诊断一个疼痛点。返回 { area, label, hits:[{cause,fix,metric,metricLabel}], notes }
 * meas / targets 允许为空（未测量时只给通用排查项）
 */
export function diagnose(areaId, meas, targets) {
  const area = areaById(areaId);
  if (!area) return { area: null, ok: false, hits: [], notes: ["未识别的疼痛点"] };
  const hits = [];
  const notes = [];
  if (!meas || !meas.ok || !targets) {
    notes.push("还没有可用的角度测量：先跑一次视频采样，或用照片模式点关节，诊断才有数据支撑。");
    return { area, ok: true, hits, notes, generic: true };
  }
  for (const c of area.causes) {
    let hit = false;
    try { hit = Boolean(c.test(meas, targets)); } catch (e) { hit = false; }
    if (hit) hits.push({ cause: c.cause, fix: c.fix, metric: c.metric, metricLabel: METRIC_LABEL[c.metric] || c.metric, value: meas[c.metric] });
  }
  if (!hits.length) {
    notes.push("当前角度都在目标区间内，说明问题更可能来自车架以外的因素：鞋/锁片位置、单侧发力不对称、训练量突增，或座椅磨损。");
  }
  return { area, ok: true, hits, notes };
}

/** 一次诊断多个疼痛点，按命中原因数量排序 */
export function diagnoseAll(ids, meas, targets) {
  return (ids || []).map((id) => diagnose(id, meas, targets)).filter((r) => r.area).sort((a, b) => b.hits.length - a.hits.length);
}

/** 汇总成 Markdown 片段，供导出使用 */
export function painMarkdown(results) {
  if (!results || !results.length) return "";
  const lines = ["## 疼痛定位诊断", ""];
  for (const r of results) {
    lines.push(`### ${r.area.label}`);
    if (!r.hits.length) lines.push("- 未命中角度相关原因，见下方通用提示");
    for (const h of r.hits) lines.push(`- **${h.cause}** → ${h.fix}（依据 ${h.metricLabel} ${fmt(h.value)}）`);
    for (const n of r.notes) lines.push(`- ${n}`);
    lines.push("");
  }
  return lines.join("\n");
}

function fmt(v) {
  return Number.isFinite(v) ? Math.round(v * 10) / 10 + "°" : "—";
}
