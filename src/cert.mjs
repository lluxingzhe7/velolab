// 自签名证书生成（纯 Node，无 openssl）：手机访问摄像头必须 HTTPS，这里现场生成一张本地证书。
import { generateKeyPairSync, randomBytes, sign, X509Certificate } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";

/* ---------- 最小 ASN.1 DER 编码 ---------- */
function derLen(n) {
  if (n < 0x80) return Buffer.from([n]);
  if (n < 0x100) return Buffer.from([0x81, n]);
  if (n < 0x10000) return Buffer.from([0x82, (n >> 8) & 0xff, n & 0xff]);
  return Buffer.from([0x83, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
}
function tlv(tag, body) {
  return Buffer.concat([Buffer.from([tag]), derLen(body.length), body]);
}
const seq = (...parts) => tlv(0x30, Buffer.concat(parts));
const set = (...parts) => tlv(0x31, Buffer.concat(parts));
const integer = (buf) => {
  let i = 0;
  while (i < buf.length - 1 && buf[i] === 0) i += 1;
  let out = Buffer.from(buf.subarray(i));
  if (out[0] & 0x80) out = Buffer.concat([Buffer.from([0]), out]);
  return tlv(0x02, out);
};
const oid = (dotted) => {
  const parts = dotted.split(".").map(Number);
  const bytes = [40 * parts[0] + parts[1]];
  for (const p of parts.slice(2)) {
    const stack = [p & 0x7f];
    let v = p >> 7;
    while (v > 0) { stack.unshift((v & 0x7f) | 0x80); v >>= 7; }
    bytes.push(...stack);
  }
  return tlv(0x06, Buffer.from(bytes));
};
const utf8 = (s) => tlv(0x0c, Buffer.from(s, "utf8"));
const utcTime = (d) => {
  const iso = d.toISOString().replace(/[-:T.]/g, "");
  return tlv(0x17, Buffer.from(iso.slice(2, 14) + "Z"));
};
const bool = (v) => tlv(0x01, Buffer.from([v ? 0xff : 0x00]));
const octet = (buf) => tlv(0x04, buf);
const bitString = (buf, unused = 0) => tlv(0x03, Buffer.concat([Buffer.from([unused]), buf]));
const ctx = (n, body, constructed = true) => tlv((constructed ? 0xa0 : 0x80) + n, body);

/** 本机所有可用 IPv4 局域网地址 */
export function lanAddresses() {
  const out = [];
  const ifaces = networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] || []) {
      if (info.family === "IPv4" && !info.internal) out.push(info.address);
    }
  }
  return out;
}

/** 生成自签名证书，返回 { cert, key, pem } */
export function makeSelfSigned({ commonName = "VeloLab", days = 825, ips = [] } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const name = seq(set(seq(oid("2.5.4.3"), utf8(commonName))));
  const now = new Date();
  const notBefore = new Date(now.getTime() - 86400000);
  const notAfter = new Date(now.getTime() + days * 86400000);
  const spki = publicKey.export({ type: "spki", format: "der" });
  const allIps = [...new Set(["127.0.0.1", ...ips, ...lanAddresses()])];
  const altNames = seq(
    ...allIps.map((ip) => tlv(0x87, Buffer.from(ip.split(".").map(Number)))),
    tlv(0x82, Buffer.from("localhost")),
  );
  const extensions = ctx(3, seq(
    seq(oid("2.5.29.19"), bool(true), octet(seq())),
    seq(oid("2.5.29.15"), bool(true), octet(bitString(Buffer.from([0xa0]), 5))),
    seq(oid("2.5.29.17"), octet(altNames)),
  ));
  const algo = seq(oid("1.2.840.113549.1.1.11"), tlv(0x05, Buffer.alloc(0)));
  const tbs = seq(
    ctx(0, integer(Buffer.from([2]))),
    integer(randomBytes(16)),
    algo,
    name,
    seq(utcTime(notBefore), utcTime(notAfter)),
    name,
    spki,
    extensions,
  );
  const sig = sign("sha256", tbs, privateKey);
  const cert = seq(tbs, algo, bitString(sig));
  const pemOf = (der, label) => "-----BEGIN " + label + "-----\n" +
    der.toString("base64").replace(/(.{64})/g, "$1\n").trim() + "\n-----END " + label + "-----\n";
  return {
    cert: pemOf(cert, "CERTIFICATE"),
    key: pemOf(privateKey.export({ type: "pkcs8", format: "der" }), "PRIVATE KEY"),
    ips: allIps,
  };
}

/** 读取或生成 certs/ 下的证书（默认有效期 825 天） */
export function ensureCert(dir) {
  const crt = join(dir, "dev.crt");
  const key = join(dir, "dev.key");
  const infoPath = join(dir, "dev.json");
  try {
    if (existsSync(crt) && existsSync(key)) {
      const info = existsSync(infoPath) ? JSON.parse(readFileSync(infoPath, "utf8")) : {};
      const x = new X509Certificate(readFileSync(crt));
      const validTo = new Date(x.validTo).getTime();
      if (validTo - Date.now() > 7 * 86400000) {
        return { cert: readFileSync(crt), key: readFileSync(key), ips: info.ips || lanAddresses(), created: false };
      }
    }
  } catch (err) { /* 证书坏了就重生成 */ }
  const made = makeSelfSigned({});
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(crt, made.cert);
    writeFileSync(key, made.key);
    writeFileSync(infoPath, JSON.stringify({ ips: made.ips, createdAt: new Date().toISOString() }, null, 2));
  } catch (err) { /* 写不进磁盘也用内存证书跑 */ }
  return { cert: made.cert, key: made.key, ips: made.ips, created: true };
}
