// 参数说明 + 量法示意图：鼠标悬停（触屏点按）参数名时弹出
const NS = 'xmlns="http://www.w3.org/2000/svg"';

const line = (x1, y1, x2, y2, c = "#c3cbd8", w = 1.6, dash = "") =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${w}" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;
const txt = (x, y, s, size = 8.5, anchor = "middle", fill = "#5b6675", weight = 600) =>
  `<text x="${x}" y="${y}" font-size="${size}" text-anchor="${anchor}" fill="${fill}" font-weight="${weight}" font-family="system-ui,-apple-system,sans-serif">${s}</text>`;
const dot = (x, y, r = 2.6, c = "#0b0f14") => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>`;
const rect = (x, y, w, h, c = "#cdd6e3", rx = 2) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${c}"/>`;
const bike = (col = "#cfd7e3") => [
  `<circle cx="34" cy="118" r="36" fill="none" stroke="${col}" stroke-width="1.6"/>`,
  `<circle cx="166" cy="118" r="36" fill="none" stroke="${col}" stroke-width="1.6"/>`,
  line(100, 118, 34, 118, col), line(100, 118, 152, 72, col), line(34, 118, 68, 44, col),
  line(68, 44, 150, 52, col), line(100, 118, 66, 38, col), line(150, 52, 152, 72, col),
  line(152, 72, 166, 118, col), line(150, 52, 162, 48, col), line(162, 48, 174, 50, col),
  line(174, 50, 172, 68, col), rect(52, 33, 28, 6, "#aeb8c7", 3), `<circle cx="100" cy="118" r="4.5" fill="#aeb8c7"/>`,
].join("");
const rider = () => [
  line(72, 50, 110, 84, "#9aa7b8", 2.6), line(110, 84, 116, 110, "#9aa7b8", 2.6),
  line(72, 50, 88, 26, "#9aa7b8", 2.6), line(88, 26, 122, 32, "#9aa7b8", 2.6),
  line(122, 32, 152, 38, "#9aa7b8", 2.6),
  `<circle cx="88" cy="18" r="7.5" fill="#e6ecf5" stroke="#c9d2df"/>`,
].join("");
const standing = () => [
  `<circle cx="96" cy="22" r="9" fill="#e6ecf5" stroke="#c9d2df"/>`,
  line(96, 31, 96, 84, "#9aa7b8", 2.6),
  line(96, 44, 80, 70, "#9aa7b8", 2.6), line(96, 44, 112, 70, "#9aa7b8", 2.6),
  line(96, 84, 86, 138, "#9aa7b8", 2.6), line(96, 84, 106, 138, "#9aa7b8", 2.6),
  line(52, 138, 150, 138, "#c3cbd8", 1.6),
].join("");
const seated = () => [
  line(28, 132, 202, 132, "#c3cbd8", 1.6),
  line(56, 124, 138, 124, "#9aa7b8", 3),
  `<circle cx="138" cy="124" r="4.5" fill="#9aa7b8"/>`,
  line(56, 124, 66, 82, "#9aa7b8", 3),
  `<circle cx="73" cy="73" r="9.5" fill="#e6ecf5" stroke="#c9d2df"/>`,
  line(64, 88, 129, 116, "#9aa7b8", 3),
  `<circle cx="129" cy="116" r="3.6" fill="${ARROW}"/>`,
].join("");

const ARROW = "#5f7d1f";
const arV = (x, y1, y2) => {
  const s = y2 > y1 ? 1 : -1;
  return line(x, y1, x, y2, ARROW, 1.7) +
    `<polyline points="${x - 3.4},${y1 + s * 5.5} ${x},${y1} ${x + 3.4},${y1 + s * 5.5}" fill="none" stroke="${ARROW}" stroke-width="1.7"/>` +
    `<polyline points="${x - 3.4},${y2 - s * 5.5} ${x},${y2} ${x + 3.4},${y2 - s * 5.5}" fill="none" stroke="${ARROW}" stroke-width="1.7"/>`;
};
const arH = (y, x1, x2) => {
  const s = x2 > x1 ? 1 : -1;
  return line(x1, y, x2, y, ARROW, 1.7) +
    `<polyline points="${x1 + s * 5.5},${y - 3.4} ${x1},${y} ${x1 + s * 5.5},${y + 3.4}" fill="none" stroke="${ARROW}" stroke-width="1.7"/>` +
    `<polyline points="${x2 - s * 5.5},${y - 3.4} ${x2},${y} ${x2 - s * 5.5},${y + 3.4}" fill="none" stroke="${ARROW}" stroke-width="1.7"/>`;
};
const arD = (x1, y1, x2, y2) => {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const head = (x, y, ang) => {
    const p1 = [x - 5.5 * Math.cos(ang - 0.4), y - 5.5 * Math.sin(ang - 0.4)];
    const p2 = [x - 5.5 * Math.cos(ang + 0.4), y - 5.5 * Math.sin(ang + 0.4)];
    return `<polyline points="${p1[0].toFixed(1)},${p1[1].toFixed(1)} ${x.toFixed(1)},${y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}" fill="none" stroke="${ARROW}" stroke-width="1.7"/>`;
  };
  return line(x1, y1, x2, y2, ARROW, 1.7) + head(x1, y1, a) + head(x2, y2, a + Math.PI);
};
const arc = (cx, cy, r, ax, ay, bx, by, c = ARROW) => {
  const a1 = Math.atan2(ay - cy, ax - cx);
  const a2 = Math.atan2(by - cy, bx - cx);
  const p1 = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)];
  const p2 = [cx + r * Math.cos(a2), cy + r * Math.sin(a2)];
  const large = Math.abs(a2 - a1) > Math.PI ? 1 : 0;
  const sweep = a2 > a1 ? 1 : 0;
  return `<path d="M ${p1[0].toFixed(1)} ${p1[1].toFixed(1)} A ${r} ${r} 0 ${large} ${sweep} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}" fill="none" stroke="${c}" stroke-width="1.6"/>`;
};
const svg = (inner) => `<svg ${NS} viewBox="0 0 220 150" class="tip-svg" aria-hidden="true">${inner}</svg>`;

/* ---- 各个量法示意图 ---- */
const FIG = {
  height: svg(standing() + arV(132, 14, 138) + txt(132, 10, "头顶到地面") ),
  inseam: svg(standing() + rect(74, 86, 44, 7, "#c9a227", 1.5) +
    line(118, 89, 138, 89, "#c9a227", 1.2, "3 3") + txt(150, 92, "书脊上沿", 8, "start") +
    arV(132, 93, 138) + txt(132, 84, "跨高")),
  flexibility: svg(seated() +
    rect(144, 100, 54, 32, "#e7ebf2", 3) + txt(171, 118, "测试台", 7.5, "middle", "#78849a", 500) +
    arH(130, 143, 128) + txt(132, 96, "指尖到台面", 8, "middle", ARROW, 600) +
    txt(104, 44, "坐地前屈，看指尖离台面多远", 8.5)),
  cadence: svg(bike() +
    `<circle cx="100" cy="118" r="19" fill="none" stroke="${ARROW}" stroke-width="1.6" stroke-dasharray="4 4"/>` +
    line(100, 118, 119, 118, ARROW, 2) + dot(100, 118, 3) + dot(119, 118, 3) +
    txt(100, 96, "1 分钟踩多少圈 = 踏频") + txt(100, 108, "85 rpm ≈ 每分钟 85 圈", 8, "middle", "#6b7686", 500)),
  posture: svg(bike() + rider() +
    line(72, 50, 118, 30, "#c3cbd8", 1.6, "4 4") + txt(126, 28, "竞技 / 气动", 8, "start") +
    line(72, 50, 104, 18, "#c3cbd8", 1.6, "4 4") + txt(112, 16, "耐力 / 舒适", 8, "start")),
  frameStack: svg(bike() + line(100, 118, 118, 118, "#c3cbd8", 1.2, "3 3") +
    line(118, 52, 150, 52, "#c3cbd8", 1.2, "3 3") + arV(118, 118, 52) +
    txt(128, 88, "Stack") + txt(128, 99, "中轴→头管顶 垂直", 8, "middle", "#6b7686", 500)),
  frameReach: svg(bike() + line(100, 118, 100, 138, "#c3cbd8", 1.2, "3 3") +
    line(150, 52, 150, 138, "#c3cbd8", 1.2, "3 3") + arH(136, 100, 150) +
    txt(125, 148, "Reach 水平")),
  stemLength: svg(bike() + line(150, 52, 162, 48, ARROW, 3) + dot(150, 52, 3) + dot(162, 48, 3) +
    txt(176, 40, "把立长度", 8, "start") + txt(176, 51, "夹持中心→把横中心", 7.5, "start", "#6b7686", 500)),
  stemAngle: svg(bike() + line(150, 52, 162, 48, ARROW, 3) + line(150, 52, 196, 52, "#c3cbd8", 1.2, "3 3") +
    arc(150, 52, 18, 196, 52, 162, 48) + txt(184, 44, "−6°", 9) + txt(184, 66, "相对水平", 7.5, "middle", "#6b7686", 500)),
  spacers: svg(bike() + line(150, 52, 152, 72, "#9aa7b8", 3) +
    rect(144, 56, 14, 4) + rect(144, 62, 14, 4) + rect(144, 68, 14, 4) +
    arV(170, 56, 72) + txt(180, 62, "垫圈", 8, "middle") + txt(180, 72, "把立下方相加", 7.5, "middle", "#6b7686", 500)),
  barReach: svg(bike() + arH(48, 162, 174) + line(162, 48, 162, 40, "#c3cbd8", 1.2, "3 3") +
    txt(168, 34, "把横 Reach")),
  barDrop: svg(bike() + line(162, 48, 190, 48, "#c3cbd8", 1.2, "3 3") +
    line(172, 68, 190, 68, "#c3cbd8", 1.2, "3 3") + arV(190, 48, 68) + txt(190, 84, "把横 Drop")),
  saddleHeight: svg(bike() + line(100, 118, 66, 38, ARROW, 2.6) + dot(100, 118, 3) + dot(66, 38, 3) +
    txt(96, 74, "坐垫高", 9, "start") + txt(96, 85, "沿座管量到坐垫面中心", 7.5, "start", "#6b7686", 500)),
  saddleSetback: svg(bike() + line(100, 118, 100, 28, "#c3cbd8", 1.2, "4 4") +
    arH(33, 54, 100) + txt(77, 27, "坐垫后移", 8) + txt(140, 40, "中轴铅垂线", 7.5, "middle", "#6b7686", 500) +
    txt(120, 140, "鼻尖到垂线的水平距离", 7.5, "middle", "#6b7686", 500)),
  crankLength: svg(bike() + `<circle cx="100" cy="118" r="19" fill="none" stroke="#c3cbd8" stroke-width="1.2" stroke-dasharray="3 3"/>` +
    line(100, 118, 119, 118, ARROW, 3) + dot(100, 118, 3) + txt(100, 146, "曲柄长 172.5mm（中轴→踏轴）")),
  pedalType: svg(
    rect(40, 92, 40, 8, "#b9c3d1", 2) + txt(60, 112, "公路锁踏", 8) +
    rect(92, 92, 40, 8, "#b9c3d1", 2) + txt(112, 104, "▾▾", 8) + txt(112, 112, "山地锁踏", 8) +
    rect(144, 92, 40, 8, "#b9c3d1", 2) + txt(164, 104, "▬", 8) + txt(164, 112, "平踏", 8) +
    line(30, 124, 194, 124, "#c3cbd8", 1.2) +
    txt(112, 62, "锁片会影响踝与脚尖朝向", 9) + txt(112, 76, "选错不会算错角度，但建议措辞会变", 7.5, "middle", "#6b7686", 500)),
  padStack: svg(bike() + rect(150, 40, 26, 5, "#aeb8c7", 2) + line(100, 118, 100, 40, "#c3cbd8", 1.2, "4 4") +
    line(100, 40, 176, 40, "#c3cbd8", 1.2, "4 4") + arV(196, 118, 40) + txt(196, 132, "垫面高")),
  padReach: svg(bike() + rect(150, 40, 26, 5, "#aeb8c7", 2) + line(100, 118, 100, 134, "#c3cbd8", 1.2, "4 4") +
    line(163, 45, 163, 134, "#c3cbd8", 1.2, "4 4") + arH(132, 100, 163) + txt(131, 148, "垫中心前后（前为正）", 7.5)),
  angleKnee: svg(bike() + rider() + arc(110, 84, 20, 72, 50, 116, 110) +
    txt(140, 76, "下死点膝角 25–35°", 8, "start") + txt(140, 87, "髋-膝-踝 夹角", 7.5, "start", "#6b7686", 500)),
  angleHip: svg(bike() + rider() + arc(72, 50, 20, 88, 26, 110, 84) +
    txt(34, 24, "髋角 100–124°", 8, "start") + txt(34, 35, "躯干-大腿 夹角", 7.5, "start", "#6b7686", 500)),
  angleTorso: svg(bike() + rider() + line(72, 50, 140, 50, "#c3cbd8", 1.2, "4 4") + arc(72, 50, 26, 140, 50, 88, 26) +
    txt(120, 40, "躯干角 34–43°", 8, "start") + txt(120, 51, "躯干与水平线", 7.5, "start", "#6b7686", 500)),
};

export const TIPS = {
  height: {
    title: "身高｜怎么量",
    fig: FIG.height,
    body: ["赤脚靠墙站直，脚跟并拢，视线平视，量到头顶。"],
    range: "用途：估算车架尺寸、把立长度与曲柄长度；量错 10mm 影响很小。",
  },
  inseam: {
    title: "跨高｜怎么量（最关键的一项）",
    fig: FIG.inseam,
    body: [
      "赤脚靠墙，两腿夹一本硬皮书，把书脊上提到紧贴会阴——有明显抵住感但不疼为止。",
      "量书脊上沿到地面的垂直距离，就是跨高。",
    ],
    range: "用途：坐垫高 = 跨高 × 0.883（铁三略低），也是像素标定与车架尺寸的基础。量错 10mm，坐垫会整体偏 9mm。",
  },
  flexibility: {
    title: "柔韧度 1–5｜怎么自测",
    fig: FIG.flexibility,
    body: [
      "坐地、双腿伸直、手掌叠放，缓慢前屈到极限，看指尖停在哪：",
      "1 僵硬：离脚尖 >10cm，腰背拱起；2 偏紧：0–10cm；3 一般：指尖碰到脚尖；4 较好：指根碰到；5 柔韧：掌心贴地或胸贴大腿。",
    ],
    range: "只影响目标区间：每低一档，髋角与躯干角目标各放宽约 3°。不确定就选 3。",
  },
  cadence: {
    title: "习惯踏频｜怎么看",
    fig: FIG.cadence,
    body: ["平时骑行最自然的转速，1 分钟踩多少圈。码表或骑行台训练记录里能直接看到平均值。"],
    range: "常见 80–95。没有记录就填 85。它用于换算蹬踏周期与曲柄像素标定。",
  },
  discipline: {
    title: "车型｜选哪个",
    fig: FIG.posture,
    body: [
      "公路车（弯把）：目标区间偏耐力到气动，躯干 34–43°。",
      "铁三 / 计时车：髋角更开、躯干更平，判定沿用铁三目标区间，并会用到休息把垫面高与前后。",
    ],
    range: "车型和车辆页的「车种」是同一个设定，改一边另一边会自动跟着变。",
  },
  position: {
    title: "姿态目标｜三个档位",
    fig: FIG.posture,
    body: ["耐力 / 舒适：躯干更立、坐垫略低；竞技 / 竞赛：中等；气动 / 激进：更平更低，但对柔韧度要求高。"],
    range: "档位越激进，髋角与躯干角目标越苛刻、把手越前越低。柔韧度不够时硬选激进，通常先出现腰颈不适。",
  },
  bikeType: {
    title: "车种｜公路车还是铁三车",
    fig: FIG.posture,
    body: ["和「骑手 → 车型」是同一个设定。选铁三车时会多出休息把垫面高 / 垫中心前后两项，并按铁三目标区间判定。"],
    range: "两边的值必须一致，否则目标区间和你的车对不上。",
  },
  frameStack: {
    title: "车架 Stack｜怎么量",
    fig: FIG.frameStack,
    body: ["中轴中心到头管顶部的垂直高度。车架几何表（Geometry）里直接有，或量中轴到地面、头管顶到地面两个高度相减。"],
    range: "公路车常见 520–600mm。留空则估算 560。",
  },
  frameReach: {
    title: "车架 Reach｜怎么量",
    fig: FIG.frameReach,
    body: ["中轴垂线到头管顶部中心的水平距离。几何表里有，也可以中轴挂铅垂线、量到过管顶垂线的水平距离。"],
    range: "公路车常见 370–400mm。留空则估算 385。",
  },
  stemLength: {
    title: "把立长度｜怎么量",
    fig: FIG.stemLength,
    body: ["把立夹持转向管中心 → 把横夹持中心的中心距，把立底部通常印着（如 100）。"],
    range: "公路车常见 90–120mm。它和垫圈一起决定手的水平前伸与堆高。",
  },
  stemAngle: {
    title: "把立角度｜是什么",
    fig: FIG.stemAngle,
    body: ["把立相对水平线的夹角，常见 −6°（普通）、−17°（气动，更压低）。装反（+6°）会让把横抬高约 2cm。"],
    range: "只写进报告文字，不参与角度判定。不确定就留空。",
  },
  spacers: {
    title: "垫圈总高｜怎么量",
    fig: FIG.spacers,
    body: ["把立下方所有垫圈的高度相加（常见 5 / 10 / 20mm 混装）。原厂没动过可以估 20mm。"],
    range: "公路车常见 10–40mm，铁三 0–30mm。减 10mm 垫圈 ≈ 躯干低约 0.9°、髋角小约 1.4°。",
  },
  barReach: {
    title: "把横 Reach｜怎么量",
    fig: FIG.barReach,
    body: ["把立前端中心到上把（hoods）前缘的水平距离。"],
    range: "弯把常见 70–90mm。留空则估算 80。",
  },
  barDrop: {
    title: "把横 Drop｜怎么量",
    fig: FIG.barDrop,
    body: ["上把顶面到下把最低点的垂直落差。"],
    range: "弯把常见 120–145mm。注意它和「坐垫→把横落差」不是一回事。",
  },
  saddleHeight: {
    title: "坐垫高（BB→坐垫面）｜怎么量",
    fig: FIG.saddleHeight,
    body: ["沿座管（或座管延长线）从中轴中心量到坐垫表面中心——不是量到坐垫最高点，也不是垂直高度。"],
    range: "留空按 跨高 × 0.883 估算。它直接决定下死点膝角，偏 5mm 约差 2°。",
  },
  saddleSetback: {
    title: "坐垫后移（BB→鼻尖）｜怎么量",
    fig: FIG.saddleSetback,
    body: [
      "过中轴挂一条铅垂线（挂个螺帽即可），量坐垫鼻尖到这条线的水平距离，坐垫在后方为正。",
      "要知道该移多少不用先猜：看下死点膝角，再看 3 点钟方向胫骨粗隆的铅垂线是否落在踏轴前后 ±10mm。",
    ],
    range: "公路车常见 15–35mm。程序给「后移 5mm」时，按坐垫夹块在导轨上的实际位移移动再重测。",
  },
  crankLength: {
    title: "曲柄长度｜怎么量",
    fig: FIG.crankLength,
    body: ["中轴中心到踏轴中心的距离，曲柄臂内侧通常印着（170 / 172.5）。"],
    range: "留空按身高估算。它还用于像素标定：踝部竖直行程 ÷ 2×曲柄 得到 px/mm。",
  },
  pedalType: {
    title: "脚踏类型｜有影响吗",
    fig: FIG.pedalType,
    body: ["公路锁踏 / 山地锁踏 / 平踏。它改变踝角与脚尖朝向的建议措辞，不改变角度计算。"],
    range: "平踏建议更保守（脚位可前后移动）；锁踏会给出锁片前后与角度的提示。",
  },
  padStack: {
    title: "铁三垫面高｜怎么量",
    fig: FIG.padStack,
    body: ["中轴中心到休息把垫面顶部的垂直高度。车靠墙摆正，量中轴到地面、垫面到地面两个高度相减。"],
    range: "常见 600–680mm。留空则估算 640。",
  },
  padReach: {
    title: "垫中心前后｜怎么量",
    fig: FIG.padReach,
    body: ["中轴垂线到垫面中心的水平距离，垫在前方为正。"],
    range: "常见 400–500mm。留空则估算 480。",
  },
  angleKnee: {
    title: "膝角｜下死点膝角 25–35°",
    fig: FIG.angleKnee,
    body: ["髋—膝—踝三点夹角，在脚踏最低点（下死点）取值，越小腿越伸得直。", "取 6–10 秒内多个踩踏周期的平均值，抖动帧会被剔除。"],
    range: "偏大（腿太伸）→ 降低坐垫；偏小（膝盖太弯）→ 升高坐垫。一次 5–10mm。",
  },
  angleHip: {
    title: "髋角｜下死点髋角 100–124°",
    fig: FIG.angleHip,
    body: ["躯干与大腿的夹角（背部—髋—膝）。越大越「开」，腰背压力越小；越小越趴、越气动。"],
    range: "偏小常见于垫圈太低或坐垫太靠后：减垫圈、缩短把立或前移坐垫。",
  },
  angleTorso: {
    title: "躯干角｜34–43°",
    fig: FIG.angleTorso,
    body: ["躯干与水平线的夹角，越直立角度越大。"],
    range: "目标随车型与姿态档位切换。角太小 → 加垫圈 / 缩短把立；太大 → 反过来。",
  },
};

export const TIP_KEYS = Object.keys(TIPS);
