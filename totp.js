"use strict";
/* Code à usage unique (TOTP, norme RFC 6238) pour la double authentification de l'administrateur. */
const crypto = require("node:crypto");
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function b32enc(buf) { let bits = "", out = ""; for (const x of buf) bits += x.toString(2).padStart(8, "0"); for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)]; return out; }
function b32dec(s) { let bits = ""; for (const c of String(s).replace(/[=\s]/g, "").toUpperCase()) { const v = B32.indexOf(c); if (v >= 0) bits += v.toString(2).padStart(5, "0"); } const o = []; for (let i = 0; i + 8 <= bits.length; i += 8) o.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(o); }
function totp(secret, t) { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(Math.floor(t / 30000))); const h = crypto.createHmac("sha1", b32dec(secret)).update(b).digest(), o = h[19] & 15, n = (((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1000000; return String(n).padStart(6, "0"); }
const totpOk = (secret, code) => /^\d{6}$/.test(String(code).trim()) && [-1, 0, 1].some(d => totp(secret, Date.now() + d * 30000) === String(code).trim());
module.exports = { b32enc, b32dec, totp, totpOk };
