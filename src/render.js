// bikefit/src/render.js
// Canvas 渲染：视频/演示背景、骨架叠加、角度标注。
const COL = {
  accent: "#2dd4bf",
  accentDim: "rgba(45,212,191,0.35)",
  far: "rgba(148,163,184,0.5)",
  warn: "#fbbf24",
  text: "#e2e8f0",
  muted: "#94a3b8",
};

const LINK = [
  ["shoulder", "hip"],
  ["hip", "knee"],
  ["knee", "ankle"],
  ["ankle", "toe"],
  ["ankle", "heel"],
  ["shoulder", "elbow"],
  ["elbow", "wrist"],
  ["hip", "shoulder"],
];

function line(g, a, b, color, width) {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.beginPath();
  g.moveTo(a.x, a.y);
  g.lineTo(b.x, b.y);
  g.stroke();
}

function dot(g, p, r, fill) {
  g.fillStyle = fill;
  g.beginPath();
  g.arc(p.x, p.y, r, 0, Math.PI * 2);
  g.fill();
}

/** 画单侧骨架 */
export function drawSkeleton(g, frame, side, opts = {}) {
  if (!frame || !frame[side]) return;
  const s = frame[side];
  const strong = side === "left";
  const color = opts.color || (strong ? COL.accent : COL.far);
  const w = opts.width || (strong ? 3 : 2);
  for (const [a, b] of LINK) {
    if (s[a] && s[b]) line(g, s[a], s[b], color, w);
  }
  const joints = ["shoulder", "elbow", "wrist", "hip", "knee", "ankle"];
  for (const j of joints) if (s[j]) dot(g, s[j], strong ? 5 : 3, color);
  if (frame.mid?.nose && s.nose) {
    line(g, s.nose, frame.mid.shoulder, color, 1.5);
  }
}

/** 演示模式背景：地面网格 + 车架示意图 */
export function drawDemoScene(g, canvas, frame, ctx) {
  const { width, height } = canvas;
  g.clearRect(0, 0, width, height);
  const grad = g.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, "#0c141f");
  grad.addColorStop(0.65, "#0d1420");
  grad.addColorStop(1, "#0a0f17");
  g.fillStyle = grad;
  g.fillRect(0, 0, width, height);
  if (!frame) return;

  const s = ctx.scale;
  const o = ctx.origin;
  const mm = (x, y) => ({ x: o.x + x * s, y: o.y - y * s });
  const bike = ctx.bike;
  const wheelR = 336;
  const groundY = o.y + 270 * s;

  // 地平线与极淡的水平参考线（不再画假透视斜线）
  g.strokeStyle = "rgba(148,163,184,0.05)";
  g.lineWidth = 1;
  for (let i = 1; i <= 4; i += 1) {
    const y = groundY + i * 26;
    if (y > height) break;
    g.beginPath(); g.moveTo(0, y); g.lineTo(width, y); g.stroke();
  }
  g.strokeStyle = "rgba(148,163,184,0.16)";
  g.beginPath(); g.moveTo(0, groundY); g.lineTo(width, groundY); g.stroke();

  const bb = mm(0, 0);
  const rearHub = mm(-410, 66);
  const frontHub = mm(590, 66);
  const saddle = mm(-bike.saddleSetback, bike.saddleHeight);
  const headTop = mm(bike.frameReach, bike.frameStack);
  const headBottom = mm(bike.frameReach - 24, bike.frameStack - 140);
  const barCenter = mm(bike.frameReach + bike.barReach, bike.frameStack + 12);

  // 车轮
  g.lineWidth = Math.max(2, 7 * s);
  g.strokeStyle = "#475569";
  for (const hub of [rearHub, frontHub]) {
    g.beginPath(); g.arc(hub.x, hub.y, wheelR * s, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 1;
    g.strokeStyle = "rgba(148,163,184,0.14)";
    g.beginPath(); g.arc(hub.x, hub.y, wheelR * 0.88 * s, 0, Math.PI * 2); g.stroke();
    g.lineWidth = Math.max(2, 7 * s);
    g.strokeStyle = "#475569";
  }

  // 车架
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = "#64748b";
  g.lineWidth = Math.max(3, 11 * s);
  const seg = (a, b) => { g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); };
  const seatTop = mm(-bike.saddleSetback + 6, bike.saddleHeight - 30);
  const topTubeBack = mm(-bike.saddleSetback + 6, bike.saddleHeight - 30);
  seg(bb, seatTop);                 // 座管
  seg(bb, headBottom);              // 下管
  seg(topTubeBack, headTop);        // 上管
  seg(bb, rearHub);                 // 后下叉
  seg(seatTop, rearHub);            // 后上叉
  seg(headTop, headBottom);         // 头管
  seg(headBottom, frontHub);        // 前叉
  // 把立与前伸量：从头上管画到骑手的手上，保证手与把一致
  const hand = frame.left && frame.left.wrist ? frame.left.wrist : barCenter;
  const barClamp = mm(bike.frameReach + (bike.stemLength || 100), bike.frameStack + (bike.spacers || 0) + 12);
  seg(headTop, barClamp);
  g.lineWidth = Math.max(2, 7 * s);
  g.strokeStyle = "#7d8ea6";
  seg(barClamp, hand);
  // 弯把：上把 → 下弯 → 前端回勾
  const barBack = { x: hand.x - 70 * s, y: hand.y + 2 * s };
  const dropEnd = { x: hand.x + 4 * s, y: hand.y + 66 * s };
  g.beginPath();
  g.moveTo(hand.x, hand.y);
  g.lineTo(barBack.x, barBack.y);
  g.stroke();
  g.beginPath();
  g.moveTo(hand.x, hand.y);
  g.bezierCurveTo(hand.x + 26 * s, hand.y + 8 * s, hand.x + 24 * s, hand.y + 54 * s, hand.x - 6 * s, hand.y + 84 * s);
  g.stroke();
  // 刹车手柄
  g.lineWidth = Math.max(2, 5 * s);
  g.beginPath();
  g.moveTo(hand.x + 12 * s, hand.y + 20 * s);
  g.lineTo(hand.x + 26 * s, hand.y + 62 * s);
  g.stroke();
  g.lineWidth = Math.max(2, 7 * s);

  // 座管补到坐垫，避免坐垫悬空
  g.lineWidth = Math.max(3, 10 * s);
  g.strokeStyle = "#64748b";
  seg(mm(-bike.saddleSetback + 6, bike.saddleHeight - 40), mm(-bike.saddleSetback, bike.saddleHeight));
  // 坐垫
  const saddleBack = mm(-bike.saddleSetback - 65, bike.saddleHeight + 8);
  const saddleFront = mm(-bike.saddleSetback + 70, bike.saddleHeight - 2);
  g.lineWidth = Math.max(3, 12 * s);
  g.strokeStyle = "#94a3b8";
  seg(saddleBack, saddleFront);

  // 牙盘 + 链条
  g.lineWidth = Math.max(1.5, 3 * s);
  g.strokeStyle = "#334155";
  g.beginPath(); g.arc(bb.x, bb.y, 100 * s, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = "rgba(148,163,184,0.28)";
  g.beginPath(); g.moveTo(bb.x, bb.y - 100 * s); g.lineTo(rearHub.x, rearHub.y - 40 * s); g.stroke();
  g.beginPath(); g.moveTo(bb.x, bb.y + 100 * s); g.lineTo(rearHub.x, rearHub.y + 40 * s); g.stroke();

  // 曲柄与脚踏：用踝关节反推
  const near = frame.left;
  if (near && near.ankle) {
    const pedal = { x: near.ankle.x + 6 * s, y: near.ankle.y + 26 * s };
    g.strokeStyle = "#64748b";
    g.lineWidth = Math.max(2, 7 * s);
    seg(bb, pedal);
    g.lineWidth = Math.max(2, 9 * s);
    g.strokeStyle = "#7d8ea6";
    seg({ x: pedal.x - 22 * s, y: pedal.y }, { x: pedal.x + 22 * s, y: pedal.y });
  }

  // 骑手后面的光晕
  if (near && near.hip) {
    const glow = g.createRadialGradient(near.hip.x, near.hip.y - 40 * s, 10, near.hip.x, near.hip.y - 40 * s, 260 * s);
    glow.addColorStop(0, "rgba(201,242,92,0.10)");
    glow.addColorStop(1, "rgba(201,242,92,0)");
    g.fillStyle = glow;
    g.fillRect(0, 0, width, height);
  }

  g.globalAlpha = 0.45;
  drawSkeleton(g, frame, "right", { color: COL.far, width: Math.max(1.5, 2.4 * s) });
  g.globalAlpha = 1;
  drawSkeleton(g, frame, "left", { color: COL.accent, width: Math.max(2, 3.2 * s) });

  // 头部
  const head = frame.mid && frame.mid.nose ? frame.mid.nose : (near && near.shoulder ? { x: near.shoulder.x + 10, y: near.shoulder.y - 60 } : null);
  if (head) {
    g.fillStyle = "rgba(45,212,191,0.18)";
    g.strokeStyle = COL.accent;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(head.x, head.y, Math.max(20, 95 * s), 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
}

/** 实时角度 HUD（画在画布左上） */
export function drawHud(g, lines, opts = {}) {
  const pad = 16;
  const x = pad;
  let y = pad;
  g.font = "600 15px system-ui, -apple-system, 'Segoe UI', sans-serif";
  g.textBaseline = "top";
  for (const item of lines) {
    const text = typeof item === "string" ? item : item.text;
    g.fillStyle = typeof item === "string" ? COL.text : (item.color || COL.text);
    g.fillText(text, x, y);
    y += 22;
  }
}
