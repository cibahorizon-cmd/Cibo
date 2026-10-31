"use strict";
/* CIBOO : accès minimal à Supabase Storage (aucune dépendance npm).
   Sert uniquement à ranger des copies de sauvegarde dans un espace PRIVÉ.
   La clé secrète reste sur le serveur : elle ne doit jamais apparaître dans le site, dans GitHub ni dans un message. */

/* --- Adresse du projet : on accepte aussi une adresse collée par erreur (avec /rest/v1/ à la fin, ou l'adresse du tableau de bord) --- */
function cleanUrl(raw) {
  let s = String(raw || "").trim(); if (!s) return { url: "", problem: "" };
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  let u; try { u = new URL(s); } catch { return { url: "", problem: "SUPABASE_URL n'est pas une adresse valide (attendu : https://xxxx.supabase.co)." }; }
  const dash = /^\/dashboard\/project\/([a-z0-9]{10,30})/i.exec(u.pathname);
  if (/(^|\.)supabase\.com$/i.test(u.hostname) && dash) return { url: "https://" + dash[1].toLowerCase() + ".supabase.co", problem: "" };
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (u.protocol !== "https:" && !local) return { url: "", problem: "SUPABASE_URL doit commencer par https://." };
  if (!local && !/\.supabase\.(co|in)$/i.test(u.hostname)) return { url: "", problem: "SUPABASE_URL doit ressembler à https://xxxx.supabase.co (menu Project Settings, rubrique API)." };
  return { url: u.origin, problem: "" };
}

/* --- Clé : on refuse la clé publique (elle ne permet pas d'écrire dans un espace privé) --- */
function checkKey(k) {
  if (!k) return "";
  if (/^sb_publishable_/i.test(k)) return "C'est la clé PUBLIQUE (sb_publishable_…). Il faut la clé SECRÈTE (sb_secret_…) : Project Settings, API Keys.";
  if (/^eyJ/.test(k)) {
    try { const role = JSON.parse(Buffer.from(k.split(".")[1], "base64url").toString()).role; if (role && role !== "service_role") return "Cette clé est la clé publique (« " + role + " »). Il faut la clé secrète (« service_role » ou sb_secret_…)."; } catch { return "La clé n'a pas le bon format."; }
  }
  return "";
}

const URLR = cleanUrl(process.env.SUPABASE_URL);
const url = URLR.url;
const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const bucket = (process.env.SUPABASE_BUCKET || "ciboo-sauvegardes").trim();
const problem = URLR.problem || checkKey(key) || (!/^[a-z0-9][a-z0-9._-]{2,62}$/i.test(bucket) ? "SUPABASE_BUCKET n'est pas un nom valide (lettres, chiffres, tirets, 3 caractères minimum)." : "");
const configured = !!(url && key && !problem);
const host = url ? new URL(url).host : "";

class SbError extends Error { constructor(msg, status, raw) { super(msg); this.status = status || 0; this.raw = raw || ""; } }

const headers = extra => { const h = { apikey: key, ...extra }; if (/^eyJ/.test(key)) h.Authorization = "Bearer " + key; return h; };   // les clés sb_secret_… ne vont QUE dans « apikey »
const enc = p => p.split("/").map(encodeURIComponent).join("/");

function friendly(status, msg) {
  if (status === 401 || status === 403) return "Supabase refuse la clé (vérifiez SUPABASE_SECRET_KEY, et que c'est bien la clé secrète). Détail : " + msg;
  if (status === 404) return "Introuvable chez Supabase. Détail : " + msg;
  if (status === 413) return "Fichier trop lourd pour votre formule Supabase. Détail : " + msg;
  if (status === 429) return "Supabase demande de ralentir (trop de requêtes). Réessayez plus tard.";
  if (status >= 500) return "Supabase a un problème momentané (erreur " + status + "). Réessayez plus tard.";
  return "Supabase a répondu une erreur (" + status + ") : " + msg;
}

async function call(method, p, o = {}) {
  let r;
  try { r = await fetch(url + "/storage/v1" + p, { method, headers: headers(o.headers), body: o.body, signal: AbortSignal.timeout(o.timeout || 45000) }); }
  catch (e) { throw new SbError("Supabase injoignable : " + (e.name === "TimeoutError" ? "délai dépassé" : (e.cause && (e.cause.code || e.cause.message)) || e.message), 0); }
  if (!r.ok) {
    let msg = "", st = r.status;
    try { const t = await r.text(); try { const j = JSON.parse(t); msg = String(j.message || j.error || t); if (j.statusCode && +j.statusCode >= 400) st = +j.statusCode; } catch { msg = t; } } catch { }
    throw new SbError(friendly(st, msg.slice(0, 200)), st, msg.slice(0, 300));
  }
  return r;
}

/* Crée l'espace privé s'il n'existe pas encore. */
async function ensureBucket() {
  try { await call("POST", "/bucket", { headers: { "content-type": "application/json" }, body: JSON.stringify({ id: bucket, name: bucket, public: false }) }); return "créé"; }
  catch (e) { if (e.status === 409 || /already exists|duplicate/i.test(e.raw)) return "existant"; throw e; }
}
async function put(p, buf, type) { await call("POST", "/object/" + encodeURIComponent(bucket) + "/" + enc(p), { headers: { "content-type": type || "application/octet-stream", "x-upsert": "true" }, body: buf, timeout: 120000 }); }
async function get(p) {
  try { const r = await call("GET", "/object/authenticated/" + encodeURIComponent(bucket) + "/" + enc(p), { timeout: 120000 }); return Buffer.from(await r.arrayBuffer()); }
  catch (e) { if (e.status === 404 || /not.?found|does not exist/i.test(e.raw)) return null; throw e; }
}
async function list(prefix) {
  const r = await call("POST", "/object/list/" + encodeURIComponent(bucket), { headers: { "content-type": "application/json" }, body: JSON.stringify({ prefix: prefix || "", limit: 1000, offset: 0, sortBy: { column: "name", order: "asc" } }) });
  const a = await r.json();
  return (Array.isArray(a) ? a : []).filter(x => x && x.id).map(x => ({ name: x.name, path: (prefix ? prefix.replace(/\/+$/, "") + "/" : "") + x.name, size: x.metadata && x.metadata.size, updated: x.updated_at || x.created_at }));
}
async function del(p) { try { await call("DELETE", "/object/" + encodeURIComponent(bucket) + "/" + enc(p)); } catch (e) { if (e.status !== 404) throw e; } }

/* Vérifie qu'un fichier est bien une base CIBOO lisible avant de s'en servir. Lance une erreur sinon. */
function checkDb(file) {
  const fs = require("node:fs"), fd = fs.openSync(file, "r"), h = Buffer.alloc(16);
  try { fs.readSync(fd, h, 0, 16, 0); } finally { fs.closeSync(fd); }
  if (h.toString("latin1", 0, 15) !== "SQLite format 3") throw new Error("ce fichier n'est pas une base de données");
  const { DatabaseSync } = require("node:sqlite"), d = new DatabaseSync(file);
  try {
    const qc = d.prepare("PRAGMA quick_check").get(); if (!qc || Object.values(qc)[0] !== "ok") throw new Error("la base est abîmée");
    const t = new Set(d.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x => x.name));
    for (const need of ["users", "books", "config", "payments", "orders"]) if (!t.has(need)) throw new Error("table manquante : " + need);
  } finally { d.close(); }
}

module.exports = { configured, problem, ensureBucket, put, get, list, del, checkDb, SbError, bucket, host };
