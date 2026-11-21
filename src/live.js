// 手机 ↔ 电脑联动：极简 WebSocket 客户端（服务端自己实现的 WS，不依赖第三方库）
function wsUrl() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return proto + "//" + location.host + "/ws";
}

/**
 * @param {object} opts { role:"screen"|"phone", code, onFrame(blob), onStatus(kind,text), onHint(msg), onPeers(info) }
 */
export function createLiveLink(opts = {}) {
  const role = opts.role || "screen";
  const code = opts.code || "";
  let ws = null;
  let closedByUs = false;
  let retry = 0;
  const api = {
    ready: false,
    code,
    send(obj) {
      if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(obj)); } catch (e) { /* ignore */ } }
    },
    sendFrame(buf) {
      if (ws && ws.readyState === 1) {
        try { ws.send(buf); return true; } catch (e) { return false; }
      }
      return false;
    },
    /** 尚未发出去的字节数；手机端用它做背压，堵了就丢帧而不是排队 */
    buffered() {
      return ws && ws.readyState === 1 ? (ws.bufferedAmount || 0) : 0;
    },
    close() {
      closedByUs = true;
      api.ready = false;
      if (ws) { try { ws.close(); } catch (e) { /* ignore */ } ws = null; }
    },
  };
  function notify(kind, text) { if (opts.onStatus) opts.onStatus(kind, text); }
  function open() {
    try { ws = new WebSocket(wsUrl()); } catch (e) { notify("close", "无法建立连接"); return; }
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      retry = 0;
      api.ready = true;
      api.send({ t: "join", role, code });
      notify("open", role === "phone" ? "已连接电脑" : "已连接，等待手机");
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        let msg = null;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (!msg) return;
        if (msg.t === "joined") { notify("joined", msg); if (opts.onPeers) opts.onPeers(msg); return; }
        if (msg.t === "peers") { if (opts.onPeers) opts.onPeers(msg); return; }
        if (msg.t === "hint") { if (opts.onHint) opts.onHint(msg); return; }
        if (opts.onMessage) opts.onMessage(msg);
      } else if (opts.onFrame) {
        const blob = new Blob([ev.data], { type: "image/jpeg" });
        opts.onFrame(blob);
      }
    };
    ws.onclose = () => {
      api.ready = false;
      notify("close", "连接断开");
      if (!closedByUs) {
        retry = Math.min(retry + 1, 6);
        setTimeout(open, 700 * retry);
      }
    };
    ws.onerror = () => { /* onclose 会处理重连 */ };
  }
  open();
  return api;
}

/** 从 /api/info 取手机端地址 */
export async function fetchShareInfo() {
  try {
    const res = await fetch("/api/info");
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}
