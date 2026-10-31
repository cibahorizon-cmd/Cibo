"use strict";
/* Faux Supabase Storage pour les tests (npm run test:supabase). N'est pas utilisé en production.
   Imite les routes utilisées par CIBOO et la façon dont Supabase répond (erreurs en HTTP 400 avec un « statusCode » dans le texte). */
const http = require("node:http"), crypto = require("node:crypto");

function startMock(key) {
  const store = new Map(), buckets = new Set();
  const st = { store, buckets, failing: false, delay: 0, lists: 0, puts: [], bad: [], gets: 0, port: 0, url: "" };
  const jwt = /^eyJ/.test(key);
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c); const body = Buffer.concat(chunks);
    const send = (code, o, type) => { const b = Buffer.isBuffer(o) ? o : Buffer.from(JSON.stringify(o)); res.writeHead(code, { "content-type": type || "application/json", "content-length": b.length }); res.end(b); };
    const sbErr = (statusCode, error, message) => send(400, { statusCode: String(statusCode), error, message });
    if (st.failing) return send(503, { message: "Service Unavailable" });
    const u = new URL(req.url, "http://x"), p = u.pathname;
    if (req.headers.apikey !== key) { st.bad.push("apikey incorrecte"); return send(401, { message: "Invalid API key" }); }
    if (!jwt && req.headers.authorization) { st.bad.push("Authorization envoyé avec une clé sb_secret"); return send(401, { message: "Invalid JWT" }); }
    if (jwt && req.headers.authorization !== "Bearer " + key) { st.bad.push("Authorization absent avec une clé JWT"); return send(401, { message: "Invalid JWT" }); }
    const pre = "/storage/v1/";
    if (!p.startsWith(pre)) return send(404, { message: "not found" });
    const r = p.slice(pre.length);
    if (req.method === "POST" && r === "bucket") {
      let b; try { b = JSON.parse(body.toString()); } catch { return sbErr(400, "Bad Request", "invalid body"); }
      if (b.public !== false) st.bad.push("bucket créé public");
      if (buckets.has(b.id)) return sbErr(409, "Duplicate", "The resource already exists");
      buckets.add(b.id); return send(200, { name: b.name });
    }
    let m;
    if (req.method === "POST" && (m = /^object\/list\/([^/]+)$/.exec(r))) {
      st.lists++; const bk = decodeURIComponent(m[1]); if (!buckets.has(bk)) return sbErr(404, "Bucket not found", "Bucket not found");
      const prefix = (JSON.parse(body.toString() || "{}").prefix || "").replace(/\/+$/, ""), pf = bk + "/" + (prefix ? prefix + "/" : ""), out = [], seen = new Set();
      for (const [k, v] of store) {
        if (!k.startsWith(pf)) continue; const rest = k.slice(pf.length), i = rest.indexOf("/");
        if (i === -1) out.push({ name: rest, id: crypto.randomUUID(), updated_at: v.updated, metadata: { size: v.buf.length } });
        else if (!seen.has(rest.slice(0, i))) { seen.add(rest.slice(0, i)); out.push({ name: rest.slice(0, i), id: null }); }
      }
      return send(200, out.sort((a, b) => a.name.localeCompare(b.name)));
    }
    if (req.method === "GET" && (m = /^object\/authenticated\/([^/]+)\/(.+)$/.exec(r))) {
      st.gets++; const k = decodeURIComponent(m[1]) + "/" + decodeURIComponent(m[2]), v = store.get(k);
      if (!v) return sbErr(404, "not_found", "Object not found");
      return send(200, v.buf, v.type);
    }
    if ((m = /^object\/([^/]+)\/(.+)$/.exec(r)) && m[1] !== "authenticated" && m[1] !== "list") {
      const bk = decodeURIComponent(m[1]), path = decodeURIComponent(m[2]), k = bk + "/" + path;
      if (req.method === "POST") {
        if (st.delay) await new Promise(r => setTimeout(r, st.delay));      // ralentit seulement les envois de fichiers
        if (!buckets.has(bk)) return sbErr(404, "Bucket not found", "Bucket not found");
        if (store.has(k) && req.headers["x-upsert"] !== "true") return sbErr(409, "Duplicate", "The resource already exists");
        store.set(k, { buf: body, type: req.headers["content-type"] || "", updated: new Date().toISOString() }); st.puts.push(path); return send(200, { Key: k });
      }
      if (req.method === "DELETE") { store.delete(k); return send(200, { message: "Successfully deleted" }); }
    }
    return send(404, { message: "route inconnue " + r });
  });
  return new Promise(ok => server.listen(0, "127.0.0.1", () => { st.port = server.address().port; st.url = "http://127.0.0.1:" + st.port; st.close = () => server.close(); ok(st); }));
}
module.exports = { startMock };
