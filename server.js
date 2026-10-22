"use strict";
/* Ciboo : serveur unique (site + API + base SQLite).
   Aucune dépendance npm. Node.js 22.13 ou plus récent. */
const http = require("node:http"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"),
  crypto = require("node:crypto"), zlib = require("node:zlib");

/* ---------- Double authentification (TOTP) ---------- */
const { b32enc, totp, totpOk } = require("./totp");
if (process.argv.includes("--totp")) {
  const s = b32enc(crypto.randomBytes(20));
  console.log("Secret TOTP : " + s + "\nAjoutez-le dans une application d'authentification (Google Authenticator, Aegis...) :\notpauth://totp/Ciba%20Edition:admin?secret=" + s + "&issuer=Ciba%20Edition\nPuis mettez ce secret dans la variable ADMIN_TOTP_SECRET sur Render.");
  process.exit(0);
}

/* ---------- Configuration ---------- */
const PORT = +process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const PERSISTENT = process.env.PERSISTENT_DATA === "1";
const TOTP_SECRET = (process.env.ADMIN_TOTP_SECRET || "").replace(/\s/g, "");
let SECRET = process.env.SESSION_SECRET;
if (!SECRET || SECRET.length < 16) { SECRET = crypto.randomBytes(32).toString("hex"); console.warn("[ciba] SESSION_SECRET absent : les connexions seront réinitialisées à chaque redémarrage."); }
fs.mkdirSync(DATA_DIR, { recursive: true });

const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(path.join(DATA_DIR, "ciba.db"));
db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
const q = (s, ...p) => db.prepare(s).all(...p), q1 = (s, ...p) => db.prepare(s).get(...p), run = (s, ...p) => db.prepare(s).run(...p);
function tx(fn) { db.exec("BEGIN IMMEDIATE"); try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { try { db.exec("ROLLBACK"); } catch { } throw e; } }

db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,pw TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'client',created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS books(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,author TEXT NOT NULL,cat TEXT NOT NULL,lang TEXT NOT NULL DEFAULT 'fr',kind TEXT NOT NULL,price INTEGER NOT NULL DEFAULT 0,stock INTEGER NOT NULL DEFAULT 0,summary TEXT NOT NULL DEFAULT '',bio TEXT NOT NULL DEFAULT '',hidden INTEGER NOT NULL DEFAULT 0,cover BLOB,cover_mime TEXT,cover_v INTEGER NOT NULL DEFAULT 0,pages TEXT,pack TEXT,toc TEXT,words INTEGER NOT NULL DEFAULT 0,reads INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ent(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,created INTEGER NOT NULL,PRIMARY KEY(user_id,book_id));
CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,book_id INTEGER REFERENCES books(id) ON DELETE SET NULL,title TEXT NOT NULL,amount INTEGER NOT NULL,method TEXT NOT NULL,tx TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'En attente',created INTEGER NOT NULL,decided INTEGER);
CREATE TABLE IF NOT EXISTS orders(ref TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,name TEXT NOT NULL,phone TEXT NOT NULL,address TEXT NOT NULL,zone TEXT NOT NULL,items TEXT NOT NULL,subtotal INTEGER NOT NULL,discount INTEGER NOT NULL,delivery INTEGER NOT NULL,total INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'En préparation',driver TEXT NOT NULL DEFAULT '',tracking TEXT NOT NULL DEFAULT '',created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS reviews(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,note INTEGER NOT NULL,comment TEXT NOT NULL,created INTEGER NOT NULL,UNIQUE(user_id,book_id));
CREATE TABLE IF NOT EXISTS promos(code TEXT PRIMARY KEY,percent INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS zones(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,fee INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS config(k TEXT PRIMARY KEY,v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,ts INTEGER NOT NULL,who TEXT NOT NULL,txt TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS pay_status ON payments(status);
CREATE INDEX IF NOT EXISTS ord_user ON orders(user_id);
`);

{
  const cols = q("PRAGMA table_info(books)").map(c => c.name);
  if (!cols.includes("lang")) db.exec("ALTER TABLE books ADD COLUMN lang TEXT NOT NULL DEFAULT 'fr'");
  if (!cols.includes("toc")) db.exec("ALTER TABLE books ADD COLUMN toc TEXT");
  if (!cols.includes("words")) db.exec("ALTER TABLE books ADD COLUMN words INTEGER NOT NULL DEFAULT 0");
}
const CATS = ["Roman", "Guide", "Manuel de formation", "Autres", "développement personnel"];
const CATS_AR = ["Religion et spiritualité", "Langue arabe", "Histoire et civilisation", "Littérature et poésie", "Sciences et savoirs", "Enfants et contes", "Éducation et formation"];
const catOk = (lang, cat) => (lang === "ar" ? CATS_AR : CATS).includes(cat);
const DEF_WAVE = "77 000 00 00", DEF_OM = "77 000 00 01";
const cfgGet = (k, d) => { const r = q1("SELECT v FROM config WHERE k=?", k); return r ? r.v : d; };
const cfgSet = (k, v) => run("INSERT INTO config(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", k, v);
const audit = (who, txt) => run("INSERT INTO audit(ts,who,txt) VALUES(?,?,?)", Date.now(), who, String(txt).slice(0, 300));

/* ---------- Découpage d'un livre en pages et chapitres ----------
   Une ligne qui commence par « # » (chapitre) ou « ## » (sous-titre) crée une entrée du sommaire.
   Sans aucune ligne « # », les lignes qui ressemblent à « Chapitre 3 », « الفصل الأول »... sont détectées. */
const CH_RE = /^(chapitre|partie|livre|section|tome|annexe|chapter|part)\s+([0-9]{1,3}|[ivxlcdm]{1,8}|premier|première|deuxième|troisième|quatrième|cinquième|sixième|septième|huitième|neuvième|dixième|un|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)\b.{0,70}$/i;
const CH_WORD = /^(introduction|conclusion|préface|preface|avant-propos|prologue|épilogue|epilogue|postface|remerciements|dédicace)\s*:?$/i;
const CH_AR = /^((الفصل|الباب|القسم|الجزء|الكتاب|المبحث|الدرس|الوحدة)(\s.{0,70})?|(المقدمة|مقدمة|الخاتمة|خاتمة|تمهيد|التمهيد))$/;
const isChapterLine = s => s.length <= 80 && (CH_RE.test(s) || CH_WORD.test(s) || CH_AR.test(s));
const countWords = pages => pages.join(" ").split(/\s+/).filter(Boolean).length;
function parseBlocks(text) {
  const lines = String(text).replace(/\r/g, "").split("\n").map(x => x.trim()).filter(Boolean);
  const marked = lines.some(l => /^#{1,2}\s+\S/.test(l));
  return lines.map(l => {
    const m = /^(#{1,2})\s+(.+)$/.exec(l);
    if (m) return { h: m[1].length, t: m[2].trim().slice(0, 120) };
    if (!marked && isChapterLine(l)) return { h: 1, t: l };
    return { h: 0, t: l };
  });
}
function buildBook(title, text) {
  const blocks = parseBlocks(text), pages = [], toc = [];
  let cur = ["@ " + title], len = 0, fresh = true;
  const flush = () => { if (cur.length) pages.push(cur.join("\n\n")); cur = []; len = 0; fresh = false; };
  const add = x => { cur.push(x); len += x.length; fresh = false; };
  for (const b of blocks) {
    if (b.h === 1) { if (!fresh) flush(); toc.push({ t: b.t, p: pages.length, l: 1 }); add("# " + b.t); }
    else if (b.h === 2) { if (len > 900) flush(); toc.push({ t: b.t, p: pages.length, l: 2 }); add("## " + b.t); }
    else {
      let t = b.t;
      while (t.length > 1500) { let k = t.lastIndexOf(" ", 1200); if (k < 400) k = 1200; if (len && len + k > 1100) flush(); add(t.slice(0, k)); t = t.slice(k).trim(); }
      if (len && len + t.length > 1100) flush();
      add(t);
    }
  }
  flush();
  return { pages, toc, words: countWords(pages) };
}
function detectToc(pages) {
  const toc = [];
  pages.forEach((pg, p) => {
    for (const para of pg.split("\n\n")) {
      const m = /^(#{1,2}) (.+)$/.exec(para);
      if (m) { toc.push({ t: m[2].slice(0, 120), p, l: m[1].length }); continue; }
      const ls = para.split("\n").map(x => x.trim()).filter(Boolean);
      if (ls.length <= 3) for (const l of ls) if (isChapterLine(l)) { toc.push({ t: l, p, l: 1 }); break; }
    }
  });
  return toc;
}
const tocOf = b => { try { return JSON.parse(b.toc || "[]"); } catch { return []; } };
const norm = x => String(x).normalize("NFD").replace(/[\u0300-\u036f\u064b-\u065f\u0670\u0640]/g, "").toLowerCase();
const sampleFr = t => { let s = ""; ["Le début", "Le voyage", "La rencontre"].forEach((c, i) => { s += `# Chapitre ${i + 1} : ${c}\n`; for (let k = 1; k <= 6; k++) s += `Texte d'exemple (${k}). Ici s'affichera le contenu de « ${t} » : paragraphes, titres et illustrations de votre ouvrage. La lecture se fait uniquement sur le site, avec un sommaire pour aller au chapitre voulu.\n`; }); return s; };

/* ---------- Données de départ (exemples à remplacer) ---------- */
function seed() {
  if (cfgGet("seeded", "") === "1") return;
  tx(() => {
    const S = [["Contes de la savane", "Auteur exemple", "Contes", "free", 0], ["Excel en 7 jours", "Auteur exemple", "Guide", "free", 0], ["Poèmes du Sine", "Auteur exemple", "Poésie", "free", 0],
    ["Guide du jeune entrepreneur", "Auteur exemple", "Guide", "paid", 3000], ["Comptabilité de base", "Formateur exemple", "Manuel de formation", "paid", 5000], ["Réussir son BFEM", "Équipe pédagogique", "Guide", "paid", 2500],
    ["Le baobab et la lune", "Auteur exemple", "Roman", "phys", 6500], ["Agriculture urbaine", "Formateur exemple", "Manuel de formation", "phys", 8000], ["Gérer son commerce", "Formateur exemple", "Guide", "phys", 4500],
    ["Les nuits de Saint-Louis", "Auteur exemple", "Roman", "free", 0], ["L'héritage de Mame Fatou", "Auteur exemple", "Roman", "paid", 2000], ["Le tisserand de Thiès", "Auteur exemple", "Roman", "phys", 5500]];
    const ids = {};
    for (const [t, a, c, k, p] of S) {
      const bk = k === "phys" ? null : buildBook(t, sampleFr(t));
      const r = run("INSERT INTO books(title,author,cat,kind,price,stock,pages,toc,words,created) VALUES(?,?,?,?,?,?,?,?,?,?)", t, a, c, k, p, k === "phys" ? 20 : 0, bk ? JSON.stringify(bk.pages) : null, bk ? JSON.stringify(bk.toc) : null, bk ? bk.words : 0, Date.now());
      ids[t] = Number(r.lastInsertRowid);
    }
    run("INSERT INTO books(title,author,cat,kind,price,pack,created) VALUES(?,?,?,?,?,?,?)", "Pack Entrepreneur", "Ciba Édition", "Pack", "paid", 6500, JSON.stringify([ids["Guide du jeune entrepreneur"], ids["Comptabilité de base"]]), Date.now());
    run("INSERT INTO zones(name,fee) VALUES(?,?)", "Dakar", 1500); run("INSERT INTO zones(name,fee) VALUES(?,?)", "Thiès, Mbour", 2500); run("INSERT INTO zones(name,fee) VALUES(?,?)", "Autres régions", 3500);
    run("INSERT OR IGNORE INTO promos(code,percent) VALUES('CIBA10',10)"); run("INSERT OR IGNORE INTO promos(code,percent) VALUES('RENTREE15',15)");
    cfgSet("wave", DEF_WAVE); cfgSet("om", DEF_OM); cfgSet("seeded", "1");
  });
}
seed();
const sampleAr = t => { let s = ""; ["البداية", "الرحلة", "اللقاء"].forEach((c, i) => { s += `# الفصل ${i + 1} : ${c}\n`; for (let q = 1; q <= 6; q++) s += `هذا نص تجريبي (${q}). سيظهر هنا محتوى كتاب «${t}»: فقرات وعناوين وصور من كتابكم. تتم القراءة على الموقع فقط، مع فهرس للانتقال إلى الفصل المطلوب.\n`; }); return s; };
function seedAr() {
  if (cfgGet("seeded_ar", "") === "1") return;
  tx(() => {
    const S = [["مبادئ اللغة العربية", "مؤلف (مثال)", "Langue arabe", "free", 0], ["تاريخ الحضارة الإسلامية", "مؤلف (مثال)", "Histoire et civilisation", "paid", 2500], ["مختارات من الشعر العربي", "مؤلف (مثال)", "Littérature et poésie", "free", 0],
    ["حكايات للأطفال", "مؤلف (مثال)", "Enfants et contes", "paid", 2000], ["مدخل إلى العلوم الإسلامية", "مؤلف (مثال)", "Religion et spiritualité", "free", 0], ["مبادئ الرياضيات", "مؤلف (مثال)", "Sciences et savoirs", "phys", 4000]];
    for (const [t, a, c, k, p] of S) { const bk = k === "phys" ? null : buildBook(t, sampleAr(t)); run("INSERT INTO books(title,author,cat,lang,kind,price,stock,pages,toc,words,created) VALUES(?,?,?,'ar',?,?,?,?,?,?,?)", t, a, c, k, p, k === "phys" ? 20 : 0, bk ? JSON.stringify(bk.pages) : null, bk ? JSON.stringify(bk.toc) : null, bk ? bk.words : 0, Date.now()); }
    cfgSet("seeded_ar", "1");
  });
}
seedAr();
function migrateToc() {
  for (const b of q("SELECT id,pages FROM books WHERE pages IS NOT NULL AND toc IS NULL")) {
    try { const pg = JSON.parse(b.pages); run("UPDATE books SET toc=?,words=? WHERE id=?", JSON.stringify(detectToc(pg)), countWords(pg), b.id); } catch { }
  }
}
migrateToc();

/* ---------- Mots de passe et sessions ---------- */
const scrypt = (pw, salt) => new Promise((ok, ko) => crypto.scrypt(pw, salt, 64, (e, k) => e ? ko(e) : ok(k)));
async function hashPw(pw) { const s = crypto.randomBytes(16); return "s1$" + s.toString("hex") + "$" + (await scrypt(pw, s)).toString("hex"); }
async function checkPw(pw, h) { const [v, s, k] = String(h).split("$"); if (v !== "s1" || !s || !k) return false; const x = await scrypt(pw, Buffer.from(s, "hex")), y = Buffer.from(k, "hex"); return x.length === y.length && crypto.timingSafeEqual(x, y); }
const DUMMY = "s1$" + "00".repeat(16) + "$" + "00".repeat(64);
const sign = s => crypto.createHmac("sha256", SECRET).update(s).digest("base64url");
function mkSession(uid, ttl) { const p = Buffer.from(JSON.stringify({ u: uid, e: Date.now() + ttl })).toString("base64url"); return p + "." + sign(p); }
function readSession(req) {
  const m = /(?:^|;\s*)ciba_s=([^;]+)/.exec(req.headers.cookie || ""); if (!m) return null;
  const [p, s] = m[1].split("."); if (!p || !s) return null;
  const e = sign(p); if (e.length !== s.length || !crypto.timingSafeEqual(Buffer.from(e), Buffer.from(s))) return null;
  try { const o = JSON.parse(Buffer.from(p, "base64url").toString()); return o.e > Date.now() ? o.u : null; } catch { return null; }
}
const isHttps = req => req.headers["x-forwarded-proto"] === "https" || !!req.socket.encrypted;
const setCookie = (req, res, val, age) => res.setHeader("Set-Cookie", `ciba_s=${val}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${isHttps(req) ? "; Secure" : ""}`);

async function bootAdmin() {
  const em = (process.env.ADMIN_EMAIL || "").trim().toLowerCase(); let pw = process.env.ADMIN_PASSWORD || "";
  if (!em) { if (!q1("SELECT id FROM users WHERE role='admin'")) console.warn("[ciba] ADMIN_EMAIL manquant : aucun administrateur n'existe."); return; }
  if (pw && pw.length < 10) { console.error("[ciba] ADMIN_PASSWORD trop court (10 caractères minimum). Administrateur non créé ni mis à jour."); return; }
  const ex = q1("SELECT id FROM users WHERE email=?", em);
  if (!pw && !ex) { pw = crypto.randomBytes(9).toString("base64url"); console.log("[ciba] Mot de passe administrateur généré : " + pw + "   (définissez ADMIN_PASSWORD dans Render pour le choisir)"); }
  if (pw) { const h = await hashPw(pw); if (ex) run("UPDATE users SET pw=?,role='admin' WHERE id=?", h, ex.id); else run("INSERT INTO users(email,name,pw,role,created) VALUES(?,?,?,'admin',?)", em, "Administrateur", h, Date.now()); }
}

/* ---------- Utilitaires HTTP ---------- */
class HttpError extends Error { constructor(code, msg, extra) { super(msg); this.code = code; this.extra = extra || {}; } }
const fail = (c, m, x) => { throw new HttpError(c, m, x); };
const STR = (v, min, max, label) => { if (typeof v !== "string") fail(400, label + " requis"); v = v.trim(); if (v.length < min || v.length > max) fail(400, label + " invalide (" + min + " à " + max + " caractères)"); return v; };
const OPT = (v, max, label) => { if (v === undefined || v === null) return ""; if (typeof v !== "string") fail(400, label + " invalide"); v = v.trim(); if (v.length > max) fail(400, label + " trop long"); return v; };
const INT = (v, min, max, label) => { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) fail(400, label + " invalide"); return n; };
const hits = new Map(), bad = new Map();
function rl(key, max, ms) { const n = Date.now(); let h = hits.get(key); if (!h || h.r < n) { h = { n: 0, r: n + ms }; hits.set(key, h); } h.n++; if (h.n > max) fail(429, "Trop de demandes. Réessayez dans quelques minutes."); }
setInterval(() => { const n = Date.now(); for (const [k, h] of hits) if (h.r < n) hits.delete(k); for (const [k, h] of bad) if (h.until < n && h.n < 5) bad.delete(k); }, 60000).unref();
const ipOf = req => (String(req.headers["x-forwarded-for"] || "").split(",")[0].trim()) || req.socket.remoteAddress || "?";
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";
function secHdr(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("X-Frame-Options", "DENY"); res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (isHttps(req)) res.setHeader("Strict-Transport-Security", "max-age=15552000");
}
function json(res, code, obj) { const b = Buffer.from(JSON.stringify(obj)); res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Length": b.length }); res.end(b); }
function readJson(req, limit) {
  return new Promise((ok, ko) => {
    let n = 0, big = false; const ch = [];
    req.on("data", c => { if (big) return; n += c.length; if (n > limit) { big = true; ch.length = 0; return; } ch.push(c); });
    req.on("end", () => {
      if (big) return ko(new HttpError(413, "Fichier ou message trop volumineux"));
      if (!n) return ok({});
      if (!/application\/json/i.test(req.headers["content-type"] || "")) return ko(new HttpError(415, "Format non accepté"));
      try { const o = JSON.parse(Buffer.concat(ch).toString("utf8")); ok(o && typeof o === "object" && !Array.isArray(o) ? o : {}); } catch { ko(new HttpError(400, "JSON invalide")); }
    });
    req.on("error", ko);
  });
}

/* ---------- Fichiers du site (gardés en mémoire) ---------- */
const ICON192 = "iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAIAAADdvvtQAAAB30lEQVR42u3SsQ2AMAxEUe+BsgIDMk62yhSUFDRs4ILKsZ70BzidXlznkH4XLhBAAkgACSAJIAEkgASQBJAAEkACSAJIAAkgASQBJIAEkAASQBJAAkgACSAJIAEkgASQBJAAEkACSAJIAAkgASSAJIAEkAASQBJAAkgACSAJIAEkgASQBJAAEkACSAJIvQC9z12ngqsAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCKBygNY8lAQQQAABBBBAAAEEEEAAAQQQQAAB1AWQ9gogASSABJAAkgASQAJIAEkACSABJIAkgASQABJAEkACSAAJIAEkASSABJAAkgASQAJIAEkACSABJIAkgASQABJAAkgCSAAJIAEkASSABJAAktI+hC/WuFufue8AAAAASUVORK5CYII=", ICON512 = "iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAIAAAB7GkOtAAAJI0lEQVR42u3VQQkAIBBFQXuIFQxoHFuZwqMHL1bwJMIOTIJd+C+1WgAIKDkBgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAgAC4AoAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAIAAuAKAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACACAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACACAAAAgAAAIAAACAIAAACAAAAgAAAIAgABwYa/JY37x/y8QAAFAAAQAARAABEAAEAABQAAEAAEQAARAABAAAUAABAABEAAEQAAQAAFAAAQAARAABEAAEAABMDp+IQAIgAAYHb8QAAFAAATAcQRAABAAAUAABAABEAAEQAAQAAFAAAQAARAABEAAEAABQAAEAAEQAARAABAAAUAABAABEAAEQAAwOgKAAAgARkcAEAABEAArIAB+gQAIAALgFwiAACAAAoAACAACIAAIgAAgAAKAAAgAAiAACIAAIAACgAAIAAIgAAiAACAAAoAACAACIAAIgAAgAAKAAAiA0fELARAAVxAAo+MXAiAACIAAIAACgAAIAAIgAAiAACAAAoAACAACIAAIgAAgAAKAAAgAAiAACIAAIAACgAAIAAIgAAiAACAAAoDREQAEQAAwOgLgFwiAACAAfoEACAACIAAIgAAgAAKAAAgAAiAACIAAIAACgAAIAAIgAAiAACAAAoAACAACIAAIgAAgAAKAAAgAAiAACIAAGB2/EAAEQACMjl8IgAAgAALgOAIgAAiAACAAAoAACAACIAAIgAAgAAKAAAgAAiAACIAAIAACgAAIAAIgAAiAACAAAoAACAACIAAYHQFAAAQAoyMACIAACAAC4BcIgAAgAH6BAAgAAiAACIAAIAACgAAIAAIgAAiAACAAAoAACAACIAAIgAAgAAKAAAgAAiAACIAAIAACgAAIAAIgAAiAABgdvxAAAUAAjI5fCIAAIAACgAAIAAIgAAiAACAAAoAACAACIAAIgAAgAAKAAAgAAiAACIAAIAACgAAIAAIgAAiAAGB0BAABEACMjgAgAAKA0REAv0AABAAB8AsEQAAQAAFAAAQAARAABEAAEAABQAAEAAEQAARAABAAAUAABAABEAAEQAAQAAFAAAQAARAABEAAEAABQAAEwOj4hQAgAAJgdPxCAAQAARAABEAAEAABQAAEAAEQAARAABAAAUAABAABEAAEQAAQAAFAAAQAARAABEAAEAABQAAEAAEQAARAADA6AoAACABGRwAQAAEQAATALxAAAUAA/AIBEAAEQAAQAAFAAAQAARAABEAAEAABQAAEAAEQAARAABAAAUAABAABEAAEQAAQAAFAAAQAARAA/EIAEAABMDp+IQACgAAYHb8QAAFAAAQAARAABEAAEAABQAAEAAEQAARAABAAAUAABAABEAAEQAAQAAFAAAQAARAABEAAEAABwOgIAAIgABgdAUAABACjIwB+gQAIAALgFwiAACAAAoAACAACIAAIgAAgAAKAAAgAAiAACIAAIAACgAAIAAIgAAiAACAAAoAACAACIAAIgAAgAAKAAAiA0fELAUAABMDo+IUACAACIAAIgAAgAAKAAAgAAiAACIAAIAACgAAIAAIgAAiAACAAAoAACAACIAAIgAAgAAKAAAgAAiAACIAAYHQEAAEQAIyOAGABBEAAEAC/QAAEAAHwCwRAABAAAUAABAABEAAEQAAQAAFAAAQAARAABEAAEAABQAAEAAEQAARAABAAAUAABAABEAAEQACMjl8IAAIgAEbHLwRAABAAo+MXAiAACIAAIAACgAAIAAIgAAiAACAAAoAACAACIAAIgAAgAAKAAAgAAiAACIAAIAACgAAIAAIgABgdAUAABACjIwAIgABgAgTALxAAAUAA/AIBEAAEQAAQAAFAAAQAARAABEAAEAABQAAEAAEQAARAABAAAUAABAABEAAEQAAQAAFAAAQAARAABEAAEAABMDp+IQAC4AQCYHT8QgAEAAEQAARAABAAAUAABAABEAAEQAAQAAFAAAQAARAABEAAEAABQAAEAAEQAARAABAAAUAABAABEAAEQAAwOgKAAAgARkcA/MIICIAAIAB+gQAIAALgFwhADKNnCMsCCIAAgAAgAAIAAoAACAAIAAIgACAACIAAgAAgAAIAAoAACAAIAAIgACAACIAAgAAgAAIAAoAACAAIAAIgACAAAoAAgAAIAAIAAiAACAAIgAAgACAAAoAAgAAIAAIAAiAACAAIgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgAgAE4AIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAIACuACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACACAArgAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAwIUDXgvS/KPNZZIAAAAASUVORK5CYII=";
const ASSETS = {};
function addAsset(url, buf, type, cache) { ASSETS[url] = { buf, gz: /text|javascript|json/.test(type) ? zlib.gzipSync(buf) : null, type, cache: cache || "no-cache" }; }
const file = n => fs.readFileSync(path.join(__dirname, n));
addAsset("/", file("index.html"), "text/html; charset=utf-8");
addAsset("/app.js", file("app.js"), "text/javascript; charset=utf-8");
addAsset("/sw.js", file("sw.js"), "text/javascript; charset=utf-8");
addAsset("/manifest.webmanifest", Buffer.from(JSON.stringify({ name: "Ciboo", short_name: "Ciboo", lang: "fr", start_url: "/", scope: "/", display: "standalone", background_color: "#fbf7ef", theme_color: "#7a2e1d", icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" }, { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }] })), "application/manifest+json");
addAsset("/icon-192.png", Buffer.from(ICON192, "base64"), "image/png", "public, max-age=86400");
addAsset("/icon-512.png", Buffer.from(ICON512, "base64"), "image/png", "public, max-age=86400");
ASSETS["/favicon.ico"] = ASSETS["/icon-192.png"];
try { for (const n of ["pdf.min.mjs", "pdf.worker.min.mjs"]) addAsset("/" + n, file(n), "text/javascript; charset=utf-8", "public, max-age=604800"); }
catch (e) { console.warn("[ciba] Fichiers pdf.min.mjs / pdf.worker.min.mjs absents : l'envoi de livres PDF est désactivé."); }
function sendAsset(req, res, a, p) {
  const gz = a.gz && /\bgzip\b/.test(req.headers["accept-encoding"] || ""), b = gz ? a.gz : a.buf;
  const h = { "Content-Type": a.type, "Cache-Control": a.cache, "Content-Length": b.length };
  if (gz) { h["Content-Encoding"] = "gzip"; h["Vary"] = "Accept-Encoding"; }
  if (p === "/") h["Content-Security-Policy"] = CSP;
  if (p === "/sw.js") h["Service-Worker-Allowed"] = "/";
  res.writeHead(200, h); res.end(req.method === "HEAD" ? undefined : b);
}

/* ---------- Routes ---------- */
const ROUTES = [];
const route = (m, re, opt, fn) => ROUTES.push({ m, re: new RegExp("^" + re + "$"), opt, fn });
const BC = "id,title,author,cat,lang,kind,price,stock,summary,bio,hidden,cover_v,pack,reads";
const ownedSet = u => new Set(u ? q("SELECT book_id FROM ent WHERE user_id=?", u.id).map(r => r.book_id) : []);
const pendSet = u => new Set(u ? q("SELECT book_id FROM payments WHERE user_id=? AND status='En attente'", u.id).map(r => r.book_id) : []);
const ratings = () => new Map(q("SELECT book_id,AVG(note) a,COUNT(*) n FROM reviews GROUP BY book_id").map(r => [r.book_id, r]));
function bookOut(b, u, owned, pend, rt) {
  const inc = b.pack ? JSON.parse(b.pack) : null, admin = !!u && u.role === "admin";
  const own = admin || b.kind === "free" || owned.has(b.id) || (!!inc && inc.every(i => owned.has(i)));
  const r = rt.get(b.id);
  return { id: b.id, t: b.title, a: b.author, k: b.cat, l: b.lang, f: b.kind, p: b.price, s: b.kind === "phys" ? b.stock : undefined, sm: b.summary, bio: b.bio, cv: b.cover_v, inc: inc || undefined, h: b.hidden ? 1 : 0, own, pend: pend.has(b.id), rt: r ? Math.round(r.a * 10) / 10 : 0, rn: r ? r.n : 0 };
}
const visible = (b, u, owned) => !b.hidden || (u && u.role === "admin") || owned.has(b.id);

route("GET", "/api/me", {}, c => ({ user: c.u }));
route("GET", "/api/config", {}, () => ({ zones: q("SELECT id,name,fee FROM zones ORDER BY id"), wave: cfgGet("wave", DEF_WAVE), om: cfgGet("om", DEF_OM) }));
route("GET", "/api/books", {}, c => {
  const owned = ownedSet(c.u), pend = pendSet(c.u), rt = ratings();
  return { books: q(`SELECT ${BC} FROM books ORDER BY id`).filter(b => visible(b, c.u, owned)).map(b => bookOut(b, c.u, owned, pend, rt)) };
});
route("GET", "/api/books/(\\d+)", {}, c => {
  const b = q1(`SELECT ${BC},pages,toc,words FROM books WHERE id=?`, +c.m[1]), owned = ownedSet(c.u);
  if (!b || !visible(b, c.u, owned)) fail(404, "Livre introuvable");
  const out = bookOut(b, c.u, owned, pendSet(c.u), ratings());
  let ex = "", toc = []; if (b.pages && b.kind !== "phys") { try { ex = JSON.parse(b.pages)[0].replace(/^(@|#{1,2}) /gm, "").slice(0, 700); toc = tocOf(b); } catch { } }
  const reviews = q("SELECT r.id,r.note n,r.comment c,r.created d,u.name u FROM reviews r JOIN users u ON u.id=r.user_id WHERE r.book_id=? ORDER BY r.id DESC LIMIT 50", b.id);
  return { book: out, reviews, excerpt: ex, toc, words: b.words };
});
function allowedToRead(b, u, owned) { return b.kind === "free" || (u && u.role === "admin") || owned.has(b.id); }
route("GET", "/api/books/(\\d+)/page/(\\d+)", {}, c => {
  const b = q1("SELECT id,title,lang,kind,hidden,pages,pack FROM books WHERE id=?", +c.m[1]), owned = ownedSet(c.u), n = +c.m[2];
  if (!b || !visible(b, c.u, owned) || b.kind === "phys" || b.pack || !b.pages) fail(404, "Livre introuvable");
  const pages = JSON.parse(b.pages), ok = allowedToRead(b, c.u, owned);
  if (n >= pages.length) fail(404, "Page introuvable");
  if (!ok && n > 0) fail(403, "Achetez ce livre pour lire la suite.", { locked: true });
  if (n === 0) run("UPDATE books SET reads=reads+1 WHERE id=?", b.id);
  return { n, total: pages.length, text: ok ? pages[n] : pages[0].slice(0, 1500), preview: !ok, l: b.lang, wm: c.u ? c.u.email : "visiteur" };
});
route("GET", "/api/books/(\\d+)/toc", {}, c => {
  const b = q1("SELECT id,kind,hidden,pages,pack,toc,words FROM books WHERE id=?", +c.m[1]), owned = ownedSet(c.u);
  if (!b || !visible(b, c.u, owned) || b.kind === "phys" || b.pack || !b.pages) fail(404, "Livre introuvable");
  return { toc: tocOf(b), total: JSON.parse(b.pages).length, words: b.words };
});
route("GET", "/api/books/(\\d+)/search", {}, c => {
  rl("search:" + ipOf(c.req), 90, 60000);
  const qs = STR(new URL(c.req.url, "http://x").searchParams.get("q") || "", 2, 60, "Recherche");
  const b = q1("SELECT id,kind,hidden,pages,pack FROM books WHERE id=?", +c.m[1]), owned = ownedSet(c.u);
  if (!b || !visible(b, c.u, owned) || b.kind === "phys" || b.pack || !b.pages) fail(404, "Livre introuvable");
  const pages = JSON.parse(b.pages), ok = allowedToRead(b, c.u, owned), nq = norm(qs), low = qs.toLowerCase(), out = [];
  for (let p = 0; p < pages.length && out.length < 40; p++) {
    if (!ok && p > 0) break;
    for (const para of pages[p].split("\n\n")) {
      if (!norm(para).includes(nq)) continue;
      const t = para.replace(/^(@|#{1,2}) /, ""), at = t.toLowerCase().indexOf(low), from = at < 0 ? 0 : Math.max(0, at - 50);
      out.push({ p, s: (from > 0 ? "…" : "") + t.slice(from, from + 130) + (from + 130 < t.length ? "…" : "") }); break;
    }
  }
  return { results: out, limited: !ok };
});
route("GET", "/api/books/(\\d+)/offline", { auth: "user" }, c => {
  const b = q1("SELECT id,title,author,cat,lang,kind,hidden,pages,pack,toc,words FROM books WHERE id=?", +c.m[1]), owned = ownedSet(c.u);
  if (!b || b.kind === "phys" || b.pack || !b.pages) fail(404, "Livre introuvable");
  if (!allowedToRead(b, c.u, owned)) fail(403, "Achetez d'abord ce livre.");
  return { id: b.id, t: b.title, a: b.author, k: b.cat, l: b.lang, pg: JSON.parse(b.pages), toc: tocOf(b), words: b.words, em: c.u.email, exp: Date.now() + 30 * 864e5 };
});
route("GET", "/cover/(\\d+)", {}, c => {
  const b = q1("SELECT cover,cover_mime FROM books WHERE id=?", +c.m[1]);
  if (!b || !b.cover) fail(404, "Pas de couverture");
  const buf = Buffer.from(b.cover);
  c.res.writeHead(200, { "Content-Type": b.cover_mime, "Content-Length": buf.length, "Cache-Control": "public, max-age=86400" }); c.res.end(buf); c.sent = true;
});

/* Comptes */
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
route("POST", "/api/signup", {}, async c => {
  rl("signup:" + ipOf(c.req), 10, 3600000);
  const email = STR(c.b.email, 5, 254, "E-mail").toLowerCase(), name = STR(c.b.name, 2, 60, "Nom"), pw = STR(c.b.password, 8, 100, "Mot de passe");
  if (!EMAIL_RE.test(email)) fail(400, "E-mail invalide");
  if (q1("SELECT id FROM users WHERE email=?", email)) fail(409, "Un compte existe déjà avec cet e-mail");
  const r = run("INSERT INTO users(email,name,pw,role,created) VALUES(?,?,?,'client',?)", email, name, await hashPw(pw), Date.now());
  const id = Number(r.lastInsertRowid); setCookie(c.req, c.res, mkSession(id, 30 * 864e5), 30 * 86400);
  return { user: { id, email, name, role: "client" } };
});
route("POST", "/api/login", {}, async c => {
  rl("login:" + ipOf(c.req), 40, 600000);
  const email = STR(c.b.email, 3, 254, "E-mail").toLowerCase(), pw = STR(c.b.password, 1, 100, "Mot de passe");
  const f = bad.get(email); if (f && f.until > Date.now()) fail(429, "Compte verrouillé 15 minutes après plusieurs erreurs.");
  const u = q1("SELECT id,email,name,role,pw FROM users WHERE email=?", email), okPw = await checkPw(pw, u ? u.pw : DUMMY);
  const miss = (msg, extra) => { const x = bad.get(email) || { n: 0, until: 0 }; x.n++; if (x.n >= 5) { x.until = Date.now() + 900000; x.n = 0; } bad.set(email, x); fail(401, msg, extra); };
  if (!u || !okPw) miss("E-mail ou mot de passe incorrect.");
  if (u.role === "admin" && TOTP_SECRET) {
    const code = typeof c.b.code === "string" ? c.b.code.trim() : "";
    if (!code) fail(401, "Code de vérification requis.", { needCode: true });
    if (!totpOk(TOTP_SECRET, code)) miss("Code de vérification incorrect.", { needCode: true });
  }
  bad.delete(email);
  const age = u.role === "admin" ? 12 * 3600 : 30 * 86400; setCookie(c.req, c.res, mkSession(u.id, age * 1000), age);
  return { user: { id: u.id, email: u.email, name: u.name, role: u.role } };
});
route("POST", "/api/logout", {}, c => { setCookie(c.req, c.res, "", 0); return { ok: true }; });
route("POST", "/api/me/delete", { auth: "user" }, async c => {
  if (c.u.role === "admin") fail(403, "Le compte administrateur ne peut pas être supprimé ici.");
  const row = q1("SELECT pw FROM users WHERE id=?", c.u.id);
  if (!(await checkPw(STR(c.b.password, 1, 100, "Mot de passe"), row.pw))) fail(401, "Mot de passe incorrect.");
  run("DELETE FROM users WHERE id=?", c.u.id); setCookie(c.req, c.res, "", 0); return { ok: true };
});
route("POST", "/api/me/password", { auth: "user" }, async c => {
  const row = q1("SELECT pw FROM users WHERE id=?", c.u.id);
  if (!(await checkPw(STR(c.b.old, 1, 100, "Ancien mot de passe"), row.pw))) fail(401, "Ancien mot de passe incorrect.");
  run("UPDATE users SET pw=? WHERE id=?", await hashPw(STR(c.b.password, 8, 100, "Nouveau mot de passe")), c.u.id); return { ok: true };
});
route("GET", "/api/orders/mine", { auth: "user" }, c => ({ orders: q("SELECT ref,items,total,status,driver,tracking,created FROM orders WHERE user_id=? ORDER BY created DESC", c.u.id).map(o => ({ ...o, items: JSON.parse(o.items) })) }));
route("GET", "/api/payments/mine", { auth: "user" }, c => ({ payments: q("SELECT id,title,amount,method,status,created FROM payments WHERE user_id=? ORDER BY created DESC", c.u.id) }));

/* Achats */
route("POST", "/api/promo/check", {}, c => {
  rl("promo:" + ipOf(c.req), 30, 600000);
  const code = STR(c.b.code, 1, 30, "Code").toUpperCase(), r = q1("SELECT code,percent FROM promos WHERE code=?", code);
  if (!r) fail(404, "Code invalide"); return { code: r.code, percent: r.percent };
});
route("POST", "/api/orders", {}, c => {
  rl("order:" + ipOf(c.req), 20, 3600000);
  const name = STR(c.b.name, 2, 80, "Nom"), phone = STR(c.b.phone, 6, 30, "Téléphone"), address = STR(c.b.address, 5, 200, "Adresse");
  if (phone.replace(/\D/g, "").length < 9) fail(400, "Téléphone invalide");
  if (!Array.isArray(c.b.items) || !c.b.items.length || c.b.items.length > 20) fail(400, "Panier vide");
  const want = new Map(); for (const it of c.b.items) { const id = INT(it && it.id, 1, 1e9, "Livre"), n = INT(it && it.q, 1, 20, "Quantité"); want.set(id, (want.get(id) || 0) + n); }
  const zone = q1("SELECT id,name,fee FROM zones WHERE id=?", INT(c.b.zoneId, 1, 1e9, "Zone")); if (!zone) fail(400, "Zone de livraison invalide");
  let pct = 0, code = ""; if (c.b.promo) { const r = q1("SELECT code,percent FROM promos WHERE code=?", STR(c.b.promo, 1, 30, "Code").toUpperCase()); if (!r) fail(400, "Code promo invalide"); pct = r.percent; code = r.code; }
  return tx(() => {
    const items = []; let sub = 0;
    for (const [id, n] of want) {
      const b = q1("SELECT id,title,price,stock,kind,hidden FROM books WHERE id=?", id);
      if (!b || b.kind !== "phys" || b.hidden) fail(400, "Un livre du panier n'est plus disponible");
      if (b.stock < n) fail(409, "Stock insuffisant pour « " + b.title + " » (reste " + b.stock + ")");
      if (run("UPDATE books SET stock=stock-? WHERE id=? AND stock>=?", n, id, n).changes !== 1) fail(409, "Stock insuffisant pour « " + b.title + " »");
      items.push({ id, title: b.title, q: n, price: b.price }); sub += b.price * n;
    }
    const disc = Math.round(sub * pct / 100), total = sub - disc + zone.fee; let ref = "";
    for (let i = 0; i < 20; i++) { ref = "CIBA-" + crypto.randomInt(10000, 100000); if (!q1("SELECT ref FROM orders WHERE ref=?", ref)) break; }
    run("INSERT INTO orders(ref,user_id,name,phone,address,zone,items,subtotal,discount,delivery,total,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", ref, c.u ? c.u.id : null, name, phone, address, zone.name, JSON.stringify(items), sub, disc, zone.fee, total, Date.now());
    return { ref, total, discount: disc, code };
  });
});
route("POST", "/api/payments", { auth: "user" }, c => {
  rl("pay:" + c.u.id, 20, 3600000);
  const b = q1("SELECT id,title,kind,price,hidden,pack FROM books WHERE id=?", INT(c.b.bookId, 1, 1e9, "Livre"));
  if (!b || b.hidden || b.kind !== "paid") fail(400, "Ce livre n'est pas à vendre");
  const method = c.b.method; if (method !== "Wave" && method !== "Orange Money") fail(400, "Moyen de paiement invalide");
  const txid = STR(c.b.tx, 6, 40, "Numéro de transaction"); if (!/^[A-Za-z0-9_.\-]+$/.test(txid)) fail(400, "Numéro de transaction invalide (lettres, chiffres, _ . - seulement)");
  const owned = ownedSet(c.u), ids = b.pack ? JSON.parse(b.pack) : [b.id];
  if (ids.every(i => owned.has(i))) fail(409, "Vous possédez déjà ce livre");
  if (q1("SELECT id FROM payments WHERE user_id=? AND book_id=? AND status='En attente'", c.u.id, b.id)) fail(409, "Un paiement est déjà en attente pour ce livre");
  if (q1("SELECT id FROM payments WHERE method=? AND tx=? AND status!='Refusé'", method, txid)) fail(409, "Ce numéro de transaction a déjà été utilisé");
  let id = ""; for (let i = 0; i < 20; i++) { id = "PAY-" + crypto.randomInt(10000, 100000); if (!q1("SELECT id FROM payments WHERE id=?", id)) break; }
  run("INSERT INTO payments(id,user_id,book_id,title,amount,method,tx,created) VALUES(?,?,?,?,?,?,?,?)", id, c.u.id, b.id, b.title, b.price, method, txid, Date.now());
  return { id, status: "En attente" };
});
route("POST", "/api/reviews", { auth: "user" }, c => {
  const b = q1("SELECT id,kind,hidden,pack FROM books WHERE id=?", INT(c.b.bookId, 1, 1e9, "Livre")); if (!b || b.hidden || b.pack || b.kind === "phys") fail(400, "Livre invalide");
  if (!(b.kind === "free" || ownedSet(c.u).has(b.id))) fail(403, "Seuls les lecteurs de ce livre peuvent donner un avis");
  const note = INT(c.b.note, 1, 5, "Note"), comment = STR(c.b.comment, 2, 400, "Avis");
  run("INSERT INTO reviews(user_id,book_id,note,comment,created) VALUES(?,?,?,?,?) ON CONFLICT(user_id,book_id) DO UPDATE SET note=excluded.note,comment=excluded.comment,created=excluded.created", c.u.id, b.id, note, comment, Date.now());
  return { ok: true };
});

/* ---------- Administration ---------- */
const A = { auth: "admin" }, AB = { auth: "admin", limit: 16e6 };
const who = c => c.u.email;
route("GET", "/api/admin/summary", A, () => {
  const n = (s, ...p) => q1(s, ...p).n, warn = [];
  if (!PERSISTENT) warn.push("Attention : les données ne sont pas conservées durablement sur ce service (pas de disque permanent). Elles seront perdues à chaque redémarrage.");
  if (cfgGet("wave", DEF_WAVE) === DEF_WAVE || cfgGet("om", DEF_OM) === DEF_OM) warn.push("Les numéros Wave et Orange Money sont encore des exemples : modifiez-les dans Livraison.");
  if (!TOTP_SECRET) warn.push("La double authentification administrateur n'est pas activée (variable ADMIN_TOTP_SECRET).");
  if (q1("SELECT 1 x FROM books WHERE author LIKE '%exemple%' OR author LIKE '%مثال%' LIMIT 1")) warn.push("Des livres d'exemple sont encore au catalogue : retirez-les dans « Retirer un livre ».");
  return {
    books: n("SELECT COUNT(*) n FROM books WHERE pack IS NULL"), hidden: n("SELECT COUNT(*) n FROM books WHERE pack IS NULL AND hidden=1"),
    free: n("SELECT COUNT(*) n FROM books WHERE kind='free'"), paid: n("SELECT COUNT(*) n FROM books WHERE kind='paid' AND pack IS NULL"), phys: n("SELECT COUNT(*) n FROM books WHERE kind='phys'"),
    orders: n("SELECT COUNT(*) n FROM orders"), users: n("SELECT COUNT(*) n FROM users WHERE role='client'"), pending: n("SELECT COUNT(*) n FROM payments WHERE status='En attente'"),
    revenue: (q1("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE status='Validé'").s) + (q1("SELECT COALESCE(SUM(total),0) s FROM orders WHERE status!='Annulée'").s), warn
  };
});
route("GET", "/api/admin/books", A, () => {
  const rt = ratings();
  return { books: q(`SELECT ${BC},(CASE WHEN pages IS NULL THEN 0 ELSE json_array_length(pages) END) np,(CASE WHEN toc IS NULL THEN 0 ELSE json_array_length(toc) END) ch,(SELECT COUNT(*) FROM payments WHERE book_id=books.id AND status='Validé') sold FROM books ORDER BY id`).map(b => ({ ...bookOut(b, { role: "admin" }, new Set(), new Set(), rt), np: b.np, ch: b.ch, rd: b.reads, sold: b.sold })) };
});
function coverOf(v) {
  if (v === undefined || v === null || v === "") return null;
  const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(v)); if (!m) fail(400, "Couverture invalide (PNG, JPEG, WebP ou GIF)");
  const buf = Buffer.from(m[2], "base64"); if (!buf.length || buf.length > 4 * 1024 * 1024) fail(400, "Couverture trop lourde (4 Mo maximum)");
  return { mime: m[1], buf };
}
route("POST", "/api/admin/books", AB, c => {
  const b = c.b, title = STR(b.title, 1, 150, "Titre"), author = STR(b.author, 1, 100, "Auteur"), cat = b.cat, kind = b.kind, lang = b.lang === undefined ? "fr" : b.lang;
  if (lang !== "fr" && lang !== "ar") fail(400, "Langue invalide"); if (!catOk(lang, cat)) fail(400, "Catégorie invalide pour cette langue"); if (!["free", "paid", "phys"].includes(kind)) fail(400, "Type invalide");
  const price = kind === "free" ? 0 : INT(b.price, 1, 10000000, "Prix"), stock = kind === "phys" ? INT(b.stock === undefined ? 0 : b.stock, 0, 100000, "Stock") : 0;
  const summary = OPT(b.summary, 2000, "Résumé"), bio = OPT(b.bio, 1000, "Biographie"), cv = coverOf(b.cover);
  let info = null; if (kind !== "phys") info = buildBook(title, STR(b.text, 20, 3000000, "Texte du livre"));
  const r = run("INSERT INTO books(title,author,cat,lang,kind,price,stock,summary,bio,cover,cover_mime,cover_v,pages,toc,words,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", title, author, cat, lang, kind, price, stock, summary, bio, cv ? cv.buf : null, cv ? cv.mime : null, cv ? 1 : 0, info ? JSON.stringify(info.pages) : null, info ? JSON.stringify(info.toc) : null, info ? info.words : 0, Date.now());
  audit(who(c), "Livre ajouté : " + title); return { id: Number(r.lastInsertRowid), pages: info ? info.pages.length : 0, chapters: info ? info.toc.filter(x => x.l === 1).length : 0 };
});
route("PUT", "/api/admin/books/(\\d+)", AB, c => {
  const id = +c.m[1], cur = q1("SELECT * FROM books WHERE id=?", id); if (!cur) fail(404, "Livre introuvable");
  const b = c.b, pack = !!cur.pack, f = {};
  f.title = b.title !== undefined ? STR(b.title, 1, 150, "Titre") : cur.title;
  f.author = b.author !== undefined ? STR(b.author, 1, 100, "Auteur") : cur.author;
  f.cat = cur.cat; f.kind = cur.kind; f.lang = cur.lang;
  if (!pack) { if (b.lang !== undefined) { if (b.lang !== "fr" && b.lang !== "ar") fail(400, "Langue invalide"); f.lang = b.lang; } if (b.cat !== undefined) f.cat = b.cat; else if (f.lang !== cur.lang) fail(400, "Choisissez une catégorie pour cette langue"); if (!catOk(f.lang, f.cat)) fail(400, "Catégorie invalide pour cette langue"); if (b.kind !== undefined) { if (!["free", "paid", "phys"].includes(b.kind)) fail(400, "Type invalide"); f.kind = b.kind; } }
  f.price = f.kind === "free" ? 0 : (b.price !== undefined ? INT(b.price, 1, 10000000, "Prix") : (cur.price > 0 ? cur.price : fail(400, "Prix requis")));
  f.stock = f.kind === "phys" ? (b.stock !== undefined ? INT(b.stock, 0, 100000, "Stock") : cur.stock) : 0;
  f.summary = b.summary !== undefined ? OPT(b.summary, 2000, "Résumé") : cur.summary; f.bio = b.bio !== undefined ? OPT(b.bio, 1000, "Biographie") : cur.bio;
  f.hidden = b.hidden !== undefined ? (b.hidden ? 1 : 0) : cur.hidden;
  let pages = cur.pages, toc = cur.toc, words = cur.words, info = null;
  if (!pack && typeof b.text === "string" && b.text.trim()) { info = buildBook(f.title, STR(b.text, 20, 3000000, "Texte du livre")); pages = JSON.stringify(info.pages); toc = JSON.stringify(info.toc); words = info.words; }
  else if (pages && f.title !== cur.title) { try { const pg = JSON.parse(pages); if (pg[0].startsWith("@ ")) { const k = pg[0].indexOf("\n\n"); pg[0] = "@ " + f.title + (k >= 0 ? pg[0].slice(k) : ""); pages = JSON.stringify(pg); } } catch { } }
  if (!pack && f.kind !== "phys" && !pages) fail(400, "Ajoutez le texte du livre pour le rendre lisible");
  const cv = pack ? null : coverOf(b.cover);
  tx(() => {
    run("UPDATE books SET title=?,author=?,cat=?,lang=?,kind=?,price=?,stock=?,summary=?,bio=?,hidden=?,pages=?,toc=?,words=? WHERE id=?", f.title, f.author, f.cat, f.lang, f.kind, f.price, f.stock, f.summary, f.bio, f.hidden, pages, toc, words, id);
    if (cv) run("UPDATE books SET cover=?,cover_mime=?,cover_v=cover_v+1 WHERE id=?", cv.buf, cv.mime, id);
  });
  audit(who(c), "Livre modifié : " + f.title + (b.hidden !== undefined ? (f.hidden ? " (retiré)" : " (remis en vente)") : "")); return { ok: true, pages: info ? info.pages.length : undefined, chapters: info ? info.toc.filter(x => x.l === 1).length : undefined };
});
route("DELETE", "/api/admin/books/(\\d+)", A, c => {
  const id = +c.m[1], cur = q1("SELECT title FROM books WHERE id=?", id); if (!cur) fail(404, "Livre introuvable");
  tx(() => { for (const p of q("SELECT id,pack FROM books WHERE pack IS NOT NULL")) if (JSON.parse(p.pack).includes(id)) run("DELETE FROM books WHERE id=?", p.id); run("DELETE FROM books WHERE id=?", id); });
  audit(who(c), "Livre supprimé : " + cur.title); return { ok: true };
});
route("DELETE", "/api/admin/reviews/(\\d+)", A, c => { run("DELETE FROM reviews WHERE id=?", +c.m[1]); audit(who(c), "Avis supprimé #" + c.m[1]); return { ok: true }; });

route("GET", "/api/admin/payments", A, () => ({ payments: q("SELECT p.id,p.title,p.amount,p.method,p.tx,p.status,p.created,u.name,u.email FROM payments p JOIN users u ON u.id=p.user_id ORDER BY (p.status='En attente') DESC,p.created DESC LIMIT 300") }));
route("POST", "/api/admin/payments/([A-Z0-9-]+)/(validate|reject)", A, c => {
  tx(() => {
    const p = q1("SELECT * FROM payments WHERE id=?", c.m[1]); if (!p) fail(404, "Paiement introuvable");
    if (p.status !== "En attente") fail(409, "Ce paiement est déjà traité");
    if (c.m[2] === "reject") { run("UPDATE payments SET status='Refusé',decided=? WHERE id=?", Date.now(), p.id); return; }
    const b = p.book_id ? q1("SELECT id,pack FROM books WHERE id=?", p.book_id) : null; if (!b) fail(409, "Le livre a été supprimé : refusez ce paiement");
    for (const i of (b.pack ? JSON.parse(b.pack) : [b.id])) run("INSERT OR IGNORE INTO ent(user_id,book_id,created) VALUES(?,?,?)", p.user_id, i, Date.now());
    run("UPDATE payments SET status='Validé',decided=? WHERE id=?", Date.now(), p.id);
  });
  audit(who(c), (c.m[2] === "validate" ? "Paiement validé : " : "Paiement refusé : ") + c.m[1]); return { ok: true };
});
const STATUSES = ["En préparation", "Expédiée", "Livrée", "Annulée"];
route("GET", "/api/admin/orders", A, () => ({ orders: q("SELECT * FROM orders ORDER BY created DESC LIMIT 300").map(o => ({ ...o, items: JSON.parse(o.items) })) }));
route("PUT", "/api/admin/orders/(CIBA-\\d+)", A, c => {
  tx(() => {
    const o = q1("SELECT * FROM orders WHERE ref=?", c.m[1]); if (!o) fail(404, "Commande introuvable");
    let st = o.status; if (c.b.status !== undefined) { if (!STATUSES.includes(c.b.status)) fail(400, "Statut invalide"); st = c.b.status; }
    if (o.status === "Annulée" && st !== "Annulée") fail(409, "Commande annulée : le stock a été remis, créez une nouvelle commande");
    if (st === "Annulée" && o.status !== "Annulée") for (const it of JSON.parse(o.items)) run("UPDATE books SET stock=stock+? WHERE id=?", it.q, it.id);
    run("UPDATE orders SET status=?,driver=?,tracking=? WHERE ref=?", st, c.b.driver !== undefined ? OPT(c.b.driver, 80, "Livreur") : o.driver, c.b.tracking !== undefined ? OPT(c.b.tracking, 80, "Suivi") : o.tracking, o.ref);
  });
  audit(who(c), "Commande " + c.m[1] + " mise à jour"); return { ok: true };
});
route("POST", "/api/admin/zones", A, c => { const r = run("INSERT INTO zones(name,fee) VALUES(?,?)", STR(c.b.name, 1, 60, "Zone"), INT(c.b.fee, 0, 1e7, "Frais")); audit(who(c), "Zone ajoutée : " + c.b.name); return { id: Number(r.lastInsertRowid) }; });
route("PUT", "/api/admin/zones/(\\d+)", A, c => {
  const z = q1("SELECT id,name,fee FROM zones WHERE id=?", +c.m[1]); if (!z) fail(404, "Zone introuvable");
  run("UPDATE zones SET name=?,fee=? WHERE id=?", c.b.name !== undefined ? STR(c.b.name, 1, 60, "Zone") : z.name, c.b.fee !== undefined ? INT(c.b.fee, 0, 1e7, "Frais") : z.fee, z.id); audit(who(c), "Zone modifiée : " + z.name); return { ok: true };
});
route("DELETE", "/api/admin/zones/(\\d+)", A, c => { if (q1("SELECT COUNT(*) n FROM zones").n <= 1) fail(409, "Gardez au moins une zone de livraison"); run("DELETE FROM zones WHERE id=?", +c.m[1]); audit(who(c), "Zone supprimée #" + c.m[1]); return { ok: true }; });
route("PUT", "/api/admin/config", A, c => { cfgSet("wave", STR(c.b.wave, 4, 40, "Numéro Wave")); cfgSet("om", STR(c.b.om, 4, 40, "Numéro Orange Money")); audit(who(c), "Numéros de paiement modifiés"); return { ok: true }; });
route("GET", "/api/admin/promos", A, () => ({ promos: q("SELECT code,percent FROM promos ORDER BY code") }));
route("POST", "/api/admin/promos", A, c => {
  const code = STR(c.b.code, 3, 30, "Code").toUpperCase(); if (!/^[A-Z0-9]+$/.test(code)) fail(400, "Code : lettres et chiffres seulement");
  run("INSERT INTO promos(code,percent) VALUES(?,?) ON CONFLICT(code) DO UPDATE SET percent=excluded.percent", code, INT(c.b.percent, 1, 90, "Réduction")); audit(who(c), "Code promo : " + code); return { ok: true };
});
route("DELETE", "/api/admin/promos/([A-Z0-9]+)", A, c => { run("DELETE FROM promos WHERE code=?", c.m[1]); audit(who(c), "Code promo supprimé : " + c.m[1]); return { ok: true }; });
route("GET", "/api/admin/users", A, () => ({ users: q("SELECT u.id,u.name,u.email,u.created,(SELECT COUNT(*) FROM ent WHERE user_id=u.id) n FROM users u WHERE u.role='client' ORDER BY u.id DESC LIMIT 500") }));
route("POST", "/api/admin/users/(\\d+)/reset", A, async c => {
  const u = q1("SELECT id,email,role FROM users WHERE id=?", +c.m[1]); if (!u) fail(404, "Client introuvable"); if (u.role === "admin") fail(403, "Impossible pour un administrateur");
  const pw = crypto.randomBytes(9).toString("base64url"); run("UPDATE users SET pw=? WHERE id=?", await hashPw(pw), u.id); audit(who(c), "Mot de passe réinitialisé : " + u.email); return { password: pw };
});
route("GET", "/api/admin/audit", A, () => ({ log: q("SELECT ts,who,txt FROM audit ORDER BY id DESC LIMIT 80") }));
route("GET", "/api/admin/stats", A, () => ({
  digital: q("SELECT strftime('%Y-%m',decided/1000,'unixepoch') m,SUM(amount) s FROM payments WHERE status='Validé' GROUP BY m ORDER BY m DESC"),
  physical: q("SELECT strftime('%Y-%m',created/1000,'unixepoch') m,SUM(total) s FROM orders WHERE status!='Annulée' GROUP BY m ORDER BY m DESC"),
  top: q("SELECT title,reads,(SELECT COUNT(*) FROM payments WHERE book_id=books.id AND status='Validé') sold FROM books WHERE pack IS NULL ORDER BY reads+(SELECT COUNT(*) FROM payments WHERE book_id=books.id AND status='Validé') DESC LIMIT 8")
}));
const csv = rows => "\ufeff" + rows.map(r => r.map(x => { x = String(x == null ? "" : x); if (/^[=+\-@\t\r]/.test(x)) x = "'" + x; return '"' + x.replace(/"/g, '""') + '"'; }).join(";")).join("\r\n");
function sendCsv(c, name, rows) { const b = Buffer.from(csv(rows)); c.res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Content-Length": b.length, "Cache-Control": "no-store" }); c.res.end(b); c.sent = true; }
const dt = t => t ? new Date(t).toISOString().slice(0, 10) : "";
route("GET", "/api/admin/export/orders.csv", A, c => sendCsv(c, "commandes-ciba.csv", [["Référence", "Date", "Client", "Téléphone", "Adresse", "Zone", "Articles", "Total FCFA", "Statut", "Livreur", "Suivi"], ...q("SELECT * FROM orders ORDER BY created DESC").map(o => [o.ref, dt(o.created), o.name, o.phone, o.address, o.zone, JSON.parse(o.items).map(i => i.title + " x" + i.q).join(" ; "), o.total, o.status, o.driver, o.tracking])]));
route("GET", "/api/admin/export/payments.csv", A, c => sendCsv(c, "paiements-ciba.csv", [["Référence", "Date", "Client", "E-mail", "Livre", "Montant FCFA", "Moyen", "Transaction", "Statut"], ...q("SELECT p.*,u.name,u.email FROM payments p JOIN users u ON u.id=p.user_id ORDER BY p.created DESC").map(p => [p.id, dt(p.created), p.name, p.email, p.title, p.amount, p.method, p.tx, p.status])]));
route("GET", "/api/admin/backup", A, c => {
  const tmp = path.join(os.tmpdir(), "ciba-backup-" + crypto.randomBytes(6).toString("hex") + ".db");
  db.exec("VACUUM INTO '" + tmp.replace(/'/g, "''") + "'");
  const b = fs.readFileSync(tmp); fs.unlinkSync(tmp); audit(who(c), "Sauvegarde téléchargée");
  c.res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="ciba-sauvegarde-${dt(Date.now())}.db"`, "Content-Length": b.length, "Cache-Control": "no-store" }); c.res.end(b); c.sent = true;
});

/* ---------- Serveur ---------- */
const server = http.createServer(async (req, res) => {
  try {
    const p = new URL(req.url, "http://x").pathname; secHdr(req, res);
    const get = req.method === "GET" || req.method === "HEAD";
    if (get) {
      if (ASSETS[p]) return sendAsset(req, res, ASSETS[p], p);
      if (p === "/health") { res.writeHead(200, { "Content-Type": "text/plain" }); return res.end("ok"); }
    }
    let r = null, m = null;
    for (const x of ROUTES) { if (x.m !== (req.method === "HEAD" ? "GET" : req.method)) continue; m = x.re.exec(p); if (m) { r = x; break; } }
    if (!r) { const other = ROUTES.some(x => x.re.test(p)); return json(res, other ? 405 : 404, { error: other ? "Méthode non autorisée" : "Introuvable" }); }
    const c = { req, res, p, m, u: null, b: {}, sent: false };
    rl("ip:" + ipOf(req), 600, 60000);
    const uid = readSession(req); if (uid) c.u = q1("SELECT id,email,name,role FROM users WHERE id=?", uid) || null;
    if (!get) {
      if (req.headers["x-requested-with"] !== "ciba") fail(403, "Requête refusée");
      const o = req.headers.origin; if (o) { let h = ""; try { h = new URL(o).host; } catch { } if (h !== req.headers.host) fail(403, "Origine refusée"); }
      c.b = await readJson(req, r.opt.limit || 100000);
    }
    if (r.opt.auth && !c.u) fail(401, "Connexion requise");
    if (r.opt.auth === "admin" && c.u.role !== "admin") fail(403, "Accès réservé à l'administrateur");
    const out = await r.fn(c);
    if (!c.sent) json(res, 200, out === undefined ? { ok: true } : out);
  } catch (e) {
    if (res.headersSent) { try { res.end(); } catch { } return; }
    if (e instanceof HttpError) return json(res, e.code, { error: e.message, ...e.extra });
    console.error("[ciba] erreur :", e); json(res, 500, { error: "Erreur du serveur. Réessayez." });
  }
});
server.requestTimeout = 60000; server.headersTimeout = 20000;
function stop() { server.close(() => { try { db.close(); } catch { } process.exit(0); }); setTimeout(() => process.exit(0), 8000).unref(); }
process.on("SIGTERM", stop); process.on("SIGINT", stop);
process.on("unhandledRejection", e => console.error("[ciba] rejet non géré :", e));
bootAdmin().then(() => server.listen(PORT, "0.0.0.0", () => console.log(`[ciba] prêt sur le port ${PORT} · données : ${DATA_DIR}${PERSISTENT ? "" : " (non permanentes)"}`))).catch(e => { console.error("[ciba] démarrage impossible :", e); process.exit(1); });
