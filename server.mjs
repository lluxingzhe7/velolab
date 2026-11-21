// VeloLab 服务：静态页面 + 手机/电脑联动的 WebSocket 中继 + 手机摄像头需要的 HTTPS
// 零第三方依赖：HTTP / HTTPS / WS 全部手写。
import { createServer as createHttp } from "node:http";
import { createServer as createHttps } from "node:https";
import { connect as netConnect, createServer as createNet } from "node:net";
import { createHash, randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureCert, lanAddresses } from "./src/cert.mjs";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));
const PORT = Number(process.env.PORT || 4173);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || PORT + 1);
const HOST = process.env.HOST || "0.0.0.0";
const CODE = (process.env.CODE || randomBytes(2).toString("hex")).toUpperCase();

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".task": "application/octet-stream",
  ".wasm": "application/wasm",
  ".bin": "application/octet-stream",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".map": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".ico": "image/x-icon",
};

/* ---------------- 静态文件 ---------------- */
async function serveStatic(req, res) {
  try {
    const url = new URL(req.url || "/", "http://host");
    let pathname = decodeURIComponent(url.pathname);
    const peer = (req.socket && req.socket.remoteAddress) || "?";
    if (pathname === "/ping" || pathname === "/phone.html" || pathname === "/api/info") {
      console.log("[req] " + new Date().toLocaleTimeString("zh-CN", { hour12: false }) + " " + peer +
        (globalThis.__velolabTlsPeer === peer ? " (https)" : "") + " " + pathname);
    }
    if (pathname === "/ping") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      res.end("VELOLAB PING OK\n" + new Date().toISOString() + "\n如果手机能看到这行字，说明网络是通的，问题只在 HTTPS / 证书那一步。");
      return;
    }
    if (pathname === "/api/info") {
      const body = JSON.stringify({
        code: CODE,
        httpPort: PORT,
        httpsPort: HTTPS_PORT,
        phonePort: PORT,
        ips: lanAddresses(),
        secure: !!globalThis.__velolabHttps,
      });
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(body);
      return;
    }
    if (pathname.endsWith("/")) pathname += "index.html";
    const target = normalize(join(ROOT, pathname));
    if (!target.startsWith(ROOT)) { res.writeHead(403).end("forbidden"); return; }
    const info = await stat(target);
    if (!info.isFile()) { res.writeHead(404).end("not found"); return; }
    const body = await readFile(target);
    res.writeHead(200, {
      "Content-Type": TYPES[extname(target).toLowerCase()] || "application/octet-stream",
      "Content-Length": body.length,
      // 开发期一律不缓存：改了 app.js 刷新即生效，避免手机联动了但电脑还是旧脚本
      "Cache-Control": "no-store, must-revalidate",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(body);
  } catch (err) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("not found");
  }
}

/* ---------------- 极简 WebSocket ---------------- */
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const rooms = new Map();

function room(code) {
  if (!rooms.has(code)) rooms.set(code, new Set());
  return rooms.get(code);
}

function frame(payload, opcode) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const len = data.length;
  let head;
  if (len < 126) head = Buffer.from([0x80 | opcode, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | opcode; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | opcode; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([head, data]);
}

function sendJSON(conn, obj) {
  if (conn.socket.destroyed) return;
  try { conn.socket.write(frame(JSON.stringify(obj), 0x1)); } catch (e) { /* ignore */ }
}

function sendBinary(conn, buf) {
  if (conn.socket.destroyed) return;
  try { conn.socket.write(frame(buf, 0x2)); } catch (e) { /* ignore */ }
}

function peersOf(conn) {
  if (!conn.code) return [];
  return [...room(conn.code)].filter((c) => c !== conn && !c.socket.destroyed);
}

function counts(code) {
  const list = [...room(code)];
  const phones = list.filter((c) => c.role === "phone");
  return {
    phones: phones.length,
    pumping: phones.filter((c) => !c.superseded).length,
    screens: list.filter((c) => c.role === "screen").length,
  };
}

function announce(code) {
  const info = counts(code);
  for (const c of room(code)) sendJSON(c, { t: "peers", ...info });
}

let connSeq = 0;

function dropConn(conn) {
  if (conn.dropped) return;
  conn.dropped = true;
  if (!conn.code) return;
  if (room(conn.code).delete(conn)) {
    console.log("[ws] leave " + conn.role + " code=" + conn.code + " -> " + JSON.stringify(counts(conn.code)));
    announce(conn.code);
  }
}

/* 心跳：浏览器会自动回 pong。30 秒没有任何上行就当死连接清掉，
   否则每刷新一次页面就留一条假连接，phones/screens 越积越多，
   电脑端还会往死 socket 里写帧。 */
const IDLE_MS = Number(process.env.WS_IDLE_MS || 30000);
const PING_MS = Math.max(1000, Math.round(IDLE_MS / 3));
const heartbeat = setInterval(() => {
  const now = Date.now();
  for (const set of rooms.values()) {
    for (const conn of [...set]) {
      if (now - (conn.alive || now) > IDLE_MS) { try { conn.socket.destroy(); } catch (e) { /* ignore */ } dropConn(conn); continue; }
      try { conn.socket.write(frame(Buffer.alloc(0), 0x9)); } catch (e) { /* ignore */ }
    }
  }
}, PING_MS);
if (heartbeat.unref) heartbeat.unref();

function onMessage(conn, opcode, payload) {
  if (opcode === 0x8) { try { conn.socket.end(); } catch (e) { /* ignore */ } return; }
  if (opcode === 0x9) { try { conn.socket.write(frame(payload, 0xa)); } catch (e) { /* ignore */ } return; }
  if (opcode === 0x1) {
    let msg = null;
    try { msg = JSON.parse(payload.toString("utf8")); } catch (e) { return; }
    if (!msg) return;
    if (msg.t === "join") {
      conn.role = msg.role === "phone" ? "phone" : "screen";
      conn.code = String(msg.code || "live").toUpperCase();
      conn.alive = Date.now();
      conn.superseded = false;
      room(conn.code).add(conn);
      if (conn.role === "phone") {
        // 同一房间只保留最新打开的手机推流。两个标签页一起推会让电脑端帧率翻倍、
        // 画面在两支镜头之间来回跳（顶栏那个 23fps 就是这么来的）。
        for (const peer of room(conn.code)) {
          if (peer !== conn && peer.role === "phone" && !peer.superseded) {
            peer.superseded = true;
            sendJSON(peer, { t: "superseded" });
            console.log("[ws] supersede phone#" + peer.id + " code=" + conn.code);
          }
        }
      }
      console.log("[ws] join " + conn.role + " code=" + conn.code + " -> " + JSON.stringify(counts(conn.code)));
      sendJSON(conn, { t: "joined", code: conn.code, ...counts(conn.code) });
      announce(conn.code);
      return;
    }
    for (const peer of peersOf(conn)) sendJSON(peer, msg);
    return;
  }
  if (opcode === 0x2) {
    if (conn.role === "phone" && conn.superseded) return;   // 被接管的手机不再转发
    const to = peersOf(conn).filter((p) => p.role !== conn.role);
    for (const peer of to) sendBinary(peer, payload);
    conn.frames = (conn.frames || 0) + 1;
    if (conn.role === "phone" && conn.frames % 60 === 1) {
      console.log("[ws] frame #" + conn.frames + " from phone(code=" + conn.code + ") -> screens=" + to.length);
    }
  }
}

function parseFrames(conn, chunk) {
  conn.alive = Date.now();
  conn.buf = Buffer.concat([conn.buf, chunk]);
  let buf = conn.buf;
  while (buf.length >= 2) {
    const b1 = buf[0], b2 = buf[1];
    const opcode = b1 & 0x0f;
    const masked = (b2 & 0x80) !== 0;
    let len = b2 & 0x7f;
    let off = 2;
    if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (buf.length < 10) break; len = Number(buf.readBigUInt64BE(2)); off = 10; }
    const maskLen = masked ? 4 : 0;
    if (buf.length < off + maskLen + len) break;
    const mask = masked ? buf.subarray(off, off + 4) : null;
    const start = off + maskLen;
    const payload = Buffer.from(buf.subarray(start, start + len));
    if (mask) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
    buf = buf.subarray(start + len);
    try { onMessage(conn, opcode, payload); } catch (e) { /* 单帧异常不影响连接 */ }
  }
  conn.buf = buf;
}

function handleUpgrade(req, socket) {
  const key = req.headers["sec-websocket-key"];
  if (!key || req.url.split("?")[0] !== "/ws") { socket.destroy(); return; }
  const accept = createHash("sha1").update(key + GUID).digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    "Sec-WebSocket-Accept: " + accept + "\r\n\r\n",
  );
  socket.setNoDelay(true);
  connSeq += 1;
  const conn = { id: connSeq, socket, role: "screen", code: null, buf: Buffer.alloc(0), alive: Date.now() };
  socket.on("data", (chunk) => parseFrames(conn, chunk));
  socket.on("error", () => { dropConn(conn); });
  socket.on("close", () => { dropConn(conn); });
  socket.on("end", () => { dropConn(conn); socket.destroy(); });
}

/* ---------------- 启动 ---------------- */
const httpServer = createHttp(serveStatic);
httpServer.on("upgrade", handleUpgrade);

let httpsServer = null;
let made = null;
try {
  made = ensureCert(join(ROOT, "certs"));
  httpsServer = createHttps({ cert: made.cert, key: made.key }, serveStatic);
  httpsServer.on("upgrade", handleUpgrade);
} catch (err) {
  console.log("HTTPS 证书不可用（" + (err && err.message ? err.message : err) + "），手机摄像头需要 HTTPS");
}

/* 同一个端口同时说 HTTP 与 HTTPS：读首字节，0x16 = TLS 握手，其余按明文 HTTP。
   好处是手机只需要放行 4173 一个端口——它已经能打开 /ping，就一定能打开 https 页面。 */
if (httpsServer) {
  httpsServer.listen(HTTPS_PORT, HOST, () => {
    console.log("备用 https    -> https://127.0.0.1:" + HTTPS_PORT + "/  (老链接仍可用)");
  });
}

// 明文 HTTP 只监听本机随机端口，对外统一由 4173 的前门按首字节分流
httpServer.listen(0, "127.0.0.1", () => {
  const inner = httpServer.address().port;
  const demux = createNet((socket) => {
    socket.on("error", () => { /* ignore */ });
    socket.once("data", (chunk) => {
      const isTls = chunk[0] === 0x16;
      const up = netConnect(isTls ? HTTPS_PORT : inner, "127.0.0.1");
      up.on("error", () => socket.destroy());
      // 前门 socket 的生死要透传给内部连接：不然客户端一断开，内部 HTTP/WS 连接
      // 还挂着，房间里只增不减地留假连接（顶栏那种「很多手机」就是这么来的）
      socket.on("close", () => up.destroy());
      socket.on("error", () => { up.destroy(); socket.destroy(); });
      up.on("close", () => socket.destroy());
      up.on("connect", () => {
        if (isTls) globalThis.__velolabHttps = true;
        up.write(chunk);
        socket.pipe(up);
        up.pipe(socket);
      });
    });
  });
  demux.listen(PORT, HOST, () => {
    console.log("VeloLab http  -> http://127.0.0.1:" + PORT + "/");
    console.log("VeloLab https -> https://127.0.0.1:" + PORT + "/  (同端口，证书自签，提示继续即可)");
    const ips = ((made && made.ips) || lanAddresses()).filter((ip) => ip !== "127.0.0.1" && ip !== "::1");
    for (const ip of ips) console.log("手机请打开     -> https://" + ip + ":" + PORT + "/phone.html?code=" + CODE);
    console.log("联动房间码     -> " + CODE);
    console.log("手机打不开？    同一 Wi-Fi（公用网络被防火墙拦是最常见原因），双击 开启手机访问.bat 点【是】，或管理员 PowerShell：");
    console.log('  netsh advfirewall firewall add rule name="VeloLab-4173" dir=in action=allow protocol=TCP localport=' + PORT);
  });
});
