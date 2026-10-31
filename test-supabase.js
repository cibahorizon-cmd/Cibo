"use strict";
/* Tests de la sauvegarde Supabase avec un FAUX Supabase (mock-supabase.js) : aucun compte réel n'est utilisé.
   Utilisation : npm run test:supabase */
const { spawn, spawnSync } = require("node:child_process"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), zlib = require("node:zlib"), assert = require("node:assert/strict");
const { startMock } = require("./mock-supabase"), SB = require("./supabase");
const { DatabaseSync } = require("node:sqlite");
const KEY = "sb_secret_TEST_" + "k".repeat(24);
const JWT = "eyJhbGciOiJIUzI1NiJ9." + Buffer.from(JSON.stringify({ role: "service_role", ref: "test" })).toString("base64url") + ".signature-test-0123456789";
const BK = "ciboo-sauvegardes/";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms, what) => { const t = Date.now(); for (; ;) { try { const v = await fn(); if (v) return v; } catch { } if (Date.now() - t > ms) throw new Error("Délai dépassé : " + what); await sleep(120); } };
const tmpdirs = [], mk = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "ciboo-sb-")); tmpdirs.push(d); return d; };
const wipe = d => { for (const f of fs.readdirSync(d)) fs.rmSync(path.join(d, f), { recursive: true, force: true }); };

class Client {
  constructor(base) { this.base = base; this.cookie = ""; }
  async call(method, p, body) {
    const h = { "x-requested-with": "ciba" }; if (body !== undefined) h["content-type"] = "application/json"; if (this.cookie) h.cookie = this.cookie;
    const r = await fetch(this.base + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0].endsWith("=") ? "" : sc.split(";")[0];
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { }
    return { status: r.status, json, text };
  }
  get(p) { return this.call("GET", p); } put(p, b) { return this.call("PUT", p, b); } post(p, b) { return this.call("POST", p, b === undefined ? {} : b); }
}
const sites = [];
async function startSite(dir, env = {}) {
  const port = 4100 + Math.floor(Math.random() * 800), base = "http://127.0.0.1:" + port;
  const e = { ...process.env, PORT: String(port), DATA_DIR: dir, PERSISTENT_DATA: "1", SESSION_SECRET: "test-secret-test-secret-1234", ADMIN_EMAIL: "admin@ciboo.sn", ADMIN_PASSWORD: "MotDePasseAdmin1", ADMIN_TOTP_SECRET: "", BACKUP_DEBOUNCE_MS: "300", BACKUP_MIN_INTERVAL_MS: "600", RESTORE_RETRY_MS: "100", SUPABASE_URL: "", SUPABASE_SECRET_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "", SUPABASE_BUCKET: "", ...env };
  const proc = spawn(process.execPath, [path.join(__dirname, "server.js")], { env: e, stdio: ["ignore", "pipe", "pipe"] });
  const s = { port, base, proc, log: "", exited: new Promise(r => proc.on("exit", c => r(c))) };
  proc.stdout.on("data", d => s.log += d); proc.stderr.on("data", d => s.log += d); sites.push(s);
  await waitFor(async () => (await fetch(base + "/health")).ok, 25000, "démarrage du site\n" + s.log);
  return s;
}
async function stopSite(s) { if (s.proc.exitCode === null && s.proc.signalCode === null) { s.proc.kill("SIGTERM"); await Promise.race([s.exited, sleep(20000)]); } }
async function admin(s) { const c = new Client(s.base), r = await c.post("/api/login", { email: "admin@ciboo.sn", password: "MotDePasseAdmin1" }); assert.equal(r.status, 200, "connexion admin : " + r.text); return c; }
async function signup(s, name) { const c = new Client(s.base), r = await c.post("/api/signup", { email: name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase() + "@ciboo.sn", name, password: "motdepasse1" }); assert.equal(r.status, 200, r.text); return c; }
const meta = mock => { const v = mock.store.get(BK + "latest.json"); return v ? JSON.parse(v.buf.toString()) : null; };
const keys = (mock, pre) => [...mock.store.keys()].filter(k => k.startsWith(BK + pre)).map(k => k.slice(BK.length));
const clientsIn = gz => { const f = path.join(os.tmpdir(), "ciboo-chk-" + Math.random().toString(36).slice(2) + ".db"); fs.writeFileSync(f, zlib.gunzipSync(gz)); try { SB.checkDb(f); const d = new DatabaseSync(f); try { return d.prepare("SELECT COUNT(*) n FROM users WHERE role='client'").get().n; } finally { d.close(); } } finally { fs.rmSync(f, { force: true }); } };
const today = new Date().toISOString().slice(0, 10);

let n = 0; const ok = (name, fn) => fn().then(() => { n++; console.log("  ✔ " + name); }).catch(e => { console.error("  ✘ " + name + "\n    " + (e && (e.stack || e.message))); throw e; });
(async () => {
  console.log("Tests de la sauvegarde Supabase (faux Supabase)");
  const mock = await startMock(KEY), mock2 = await startMock(JWT);
  const sbEnv = (m, k) => ({ SUPABASE_URL: m.url, SUPABASE_SECRET_KEY: k });
  const dirA = mk(), dirB = mk();
  let sA, sB, instA, nPuts;

  await ok("réglage refusé : la clé publique est détectée, aucune sauvegarde tentée", async () => {
    const d = mk(), s = await startSite(d, { SUPABASE_URL: mock.url, SUPABASE_SECRET_KEY: "sb_publishable_abcdefghijklmnop" }), a = await admin(s);
    const i = (await a.get("/api/admin/supabase")).json; assert.equal(i.configured, false); assert.match(i.problem, /PUBLIQUE/);
    assert.ok((await a.get("/api/admin/summary")).json.warn.some(w => /mal réglé/.test(w)));
    assert.equal((await a.post("/api/admin/supabase/test")).status, 400); assert.equal(mock.puts.length, 0); assert.equal(mock.buckets.size, 0);
    await stopSite(s);
  });
  await ok("sans Supabase : le site marche et prévient l'administrateur", async () => {
    const d = mk(), s = await startSite(d), a = await admin(s);
    const i = (await a.get("/api/admin/supabase")).json; assert.equal(i.configured, false); assert.equal(i.problem, "");
    assert.ok((await a.get("/api/admin/summary")).json.warn.some(w => /Activez la sauvegarde Supabase/.test(w)));
    assert.equal((await a.post("/api/admin/supabase/backup")).status, 400); await stopSite(s);
  });
  await ok("premier démarrage : espace privé créé, première copie envoyée", async () => {
    sA = await startSite(dirA, sbEnv(mock, KEY));
    await waitFor(() => meta(mock), 10000, "première sauvegarde");
    assert.ok(mock.buckets.has("ciboo-sauvegardes"));
    const k = keys(mock, ""); for (const f of ["latest.db.gz", "latest.json", "history/" + today + ".db.gz"]) assert.ok(k.includes(f), "manque " + f + " parmi " + k);
    const m = meta(mock); assert.equal(m.instance.length, 36); assert.ok(m.counts.livres >= 13); assert.equal(m.counts.clients, 0);
    assert.equal(clientsIn(mock.store.get(BK + "latest.db.gz").buf), 0);          // la copie est une vraie base lisible
    const a = await admin(sA), i = (await a.get("/api/admin/supabase")).json; instA = i.instance;
    assert.equal(i.configured, true); assert.equal(i.remoteSame, true); assert.equal(i.restoreError, ""); assert.ok(i.lastOk); assert.deepEqual(mock.bad, []);
  });
  await ok("une modification (inscription) déclenche une sauvegarde automatique", async () => {
    await signup(sA, "Zoé"); await waitFor(() => meta(mock).counts.clients === 1, 10000, "sauvegarde après inscription");
    assert.equal(meta(mock).reason, "automatique"); assert.equal(clientsIn(mock.store.get(BK + "latest.db.gz").buf), 1);
  });
  await ok("la simple lecture d'un livre ne déclenche aucune sauvegarde", async () => {
    await sleep(1800); nPuts = mock.puts.length;
    const books = (await new Client(sA.base).get("/api/books")).json.books, free = books.find(b => b.t === "Contes de la savane").id;
    for (let i = 0; i < 4; i++) { const r = await new Client(sA.base).get(`/api/books/${free}/page/0`); assert.equal(r.status, 200); }
    await sleep(1800); assert.equal(mock.puts.length, nPuts, "des envois inutiles ont eu lieu");
  });
  await ok("« Sauvegarder maintenant » attend une sauvegarde automatique en cours au lieu d'échouer", async () => {
    const a = await admin(sA), at0 = meta(mock).at; mock.delay = 250;
    assert.equal((await a.put("/api/admin/config", { wave: "77 111 11 11", om: "77 222 22 22" })).status, 200);       // modification d'un réglage : lance une sauvegarde automatique
    await waitFor(async () => (await a.get("/api/admin/supabase")).json.busy, 5000, "sauvegarde automatique en cours");
    const r = await a.post("/api/admin/supabase/backup"); mock.delay = 0; assert.equal(r.status, 200, r.text);
    assert.notEqual(meta(mock).at, at0); assert.equal(meta(mock).counts.clients, 1);
  });
  await ok("arrêt propre : une dernière copie part avant l'extinction", async () => {
    await stopSite(sA);
    sA = await startSite(dirA, { ...sbEnv(mock, KEY), BACKUP_DEBOUNCE_MS: "600000", BACKUP_MIN_INTERVAL_MS: "600000" });
    await waitFor(() => meta(mock).reason === "démarrage", 10000, "copie de démarrage"); await sleep(300);
    await signup(sA, "Lamine"); assert.equal(meta(mock).counts.clients, 1);      // pas encore envoyé (délai long)
    await stopSite(sA); assert.equal(meta(mock).counts.clients, 2); assert.equal(meta(mock).reason, "arrêt du service");
  });
  await ok("disque perdu (nouveau service) : les données reviennent toutes seules", async () => {
    wipe(dirA); assert.equal(fs.readdirSync(dirA).length, 0);
    const s = await startSite(dirA, sbEnv(mock, KEY)); assert.match(s.log, /remises automatiquement/);
    const a = await admin(s), sum = (await a.get("/api/admin/summary")).json; assert.equal(sum.users, 2);
    assert.equal((await new Client(s.base).post("/api/login", { email: "zoe@ciboo.sn", password: "motdepasse1" })).status, 200);
    assert.equal((await new Client(s.base).post("/api/login", { email: "lamine@ciboo.sn", password: "motdepasse1" })).status, 200);
    const i = (await a.get("/api/admin/supabase")).json; assert.equal(i.instance, instA); assert.match(i.restored, /remises automatiquement/); assert.equal(i.conflict, null);
    for (const p of ["/", "/app.js", "/api/admin/supabase", "/api/admin/summary"]) assert.ok(!(await a.get(p)).text.includes(KEY), "la clé fuit dans " + p);
    assert.ok(!s.log.includes(KEY), "la clé fuit dans les journaux"); sA = s;
  });
  await ok("conflit : une AUTRE base ne peut pas écraser les sauvegardes", async () => {
    const s0 = await startSite(dirB); await signup(s0, "Intrus"); await stopSite(s0);
    const before = mock.store.get(BK + "latest.json").buf.toString(), p0 = mock.puts.length;
    const s = await startSite(dirB, sbEnv(mock, KEY)); await sleep(1500);
    const a = await admin(s), i = (await a.get("/api/admin/supabase")).json;
    assert.ok(i.conflict, "conflit non détecté"); assert.equal(i.remoteSame, false);
    assert.ok((await a.get("/api/admin/summary")).json.warn.some(w => /AUTRE base/.test(w)));
    await signup(s, "Autre"); await sleep(1800);                                   // les sauvegardes automatiques sont suspendues
    assert.equal(mock.store.get(BK + "latest.json").buf.toString(), before); assert.equal(mock.puts.length, p0);
    const r = await a.post("/api/admin/supabase/backup"); assert.equal(r.status, 409); assert.match(r.json.error, /autre base/);
    assert.equal((await a.post("/api/admin/supabase/overwrite", { confirm: "oui" })).status, 400);
    assert.equal(mock.store.get(BK + "latest.json").buf.toString(), before);
    const w = await a.post("/api/admin/supabase/overwrite", { confirm: "REMPLACER" }); assert.equal(w.status, 200, w.text);
    assert.notEqual(meta(mock).instance, JSON.parse(before).instance); assert.equal(meta(mock).counts.clients, 2);
    const safe = keys(mock, "before-restore/"); assert.equal(safe.length, 1);     // l'ancienne copie est gardée
    assert.equal(clientsIn(mock.store.get(BK + safe[0]).buf), 2); assert.equal((await a.get("/api/admin/supabase")).json.conflict, null);
    sA && await stopSite(sA); sB = s;
  });
  await ok("restauration par l'administrateur : confirmations, copie de sécurité, redémarrage", async () => {
    const a = await admin(sB), info = (await a.get("/api/admin/supabase")).json; assert.equal(info.safety.length, 1);
    assert.equal((await a.post("/api/admin/supabase/restore", { file: "latest" })).status, 400);                                     // sans confirmation
    assert.equal((await a.post("/api/admin/supabase/restore", { file: "../../etc/passwd", confirm: "RESTAURER" })).status, 400);      // nom piégé
    assert.equal((await a.post("/api/admin/supabase/restore", { file: "history/1999-01-01", confirm: "RESTAURER" })).status, 404);    // n'existe pas
    assert.equal((await fetch(sB.base + "/health")).status, 200);
    assert.equal((await new Client(sB.base).post("/api/admin/supabase/restore", { file: "latest", confirm: "RESTAURER" })).status, 401);  // il faut être administrateur
    const target = info.safety[0].file; assert.match(target, /^before-restore\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/);
    const r = await a.post("/api/admin/supabase/restore", { file: target, confirm: "RESTAURER" }); assert.equal(r.status, 200, r.text); assert.equal(r.json.restarting, true);
    await Promise.race([sB.exited, sleep(15000)]); assert.notEqual(sB.proc.exitCode, null, "le service devait s'arrêter pour redémarrer");
    sB = await startSite(dirB, sbEnv(mock, KEY)); assert.match(sB.log, /restaurée à la demande/);
    const b = await admin(sB), sum = (await b.get("/api/admin/summary")).json; assert.equal(sum.users, 2);                          // Zoé et Lamine reviennent
    assert.equal((await new Client(sB.base).post("/api/login", { email: "zoe@ciboo.sn", password: "motdepasse1" })).status, 200);
    assert.equal((await new Client(sB.base).post("/api/login", { email: "intrus@ciboo.sn", password: "motdepasse1" })).status, 401);  // l'autre base a disparu
    const i = (await b.get("/api/admin/supabase")).json; assert.equal(i.conflict, null); assert.equal(i.remoteSame, true); assert.equal(i.safety.length, 2);
    await signup(sB, "Nouveau"); await waitFor(() => meta(mock).counts.clients === 3, 10000, "sauvegarde après restauration");
  });
  await ok("panne de Supabase : le site continue, l'erreur est signalée, la reprise est automatique", async () => {
    mock.failing = true; await signup(sB, "Panne");
    const a = await admin(sB); const i = await waitFor(async () => { const x = (await a.get("/api/admin/supabase")).json; return x.error && x; }, 10000, "erreur signalée");
    assert.match(i.error, /problème momentané|injoignable/); assert.ok((await a.get("/api/admin/summary")).json.warn.some(w => /dernière sauvegarde Supabase a échoué/.test(w)));
    assert.equal((await fetch(sB.base + "/api/books")).status, 200);
    mock.failing = false; await waitFor(() => meta(mock).counts.clients === 4, 15000, "reprise après panne");
    assert.equal((await a.get("/api/admin/supabase")).json.error, "");
  });
  await ok("disque vide ET Supabase en panne : rien n'est écrasé, puis restauration par l'administrateur", async () => {
    await stopSite(sB); wipe(dirB); mock.failing = true;
    const before = mock.store.get(BK + "latest.json").buf.toString(), p0 = mock.puts.length;
    sB = await startSite(dirB, sbEnv(mock, KEY)); assert.match(sB.log, /sauvegardes automatiques sont suspendues/);
    mock.failing = false; const a = await admin(sB); await signup(sB, "Vide"); await sleep(2000);
    assert.ok((await a.get("/api/admin/summary")).json.warn.some(w => /suspendues/.test(w)));
    assert.equal(mock.store.get(BK + "latest.json").buf.toString(), before); assert.equal(mock.puts.length, p0, "la sauvegarde existante a été écrasée !");
    assert.equal((await a.post("/api/admin/supabase/backup")).status, 409);
    const r = await a.post("/api/admin/supabase/restore", { file: "latest", confirm: "RESTAURER" }); assert.equal(r.status, 200, r.text);
    await Promise.race([sB.exited, sleep(15000)]); sB = await startSite(dirB, sbEnv(mock, KEY));
    const b = await admin(sB); assert.equal((await b.get("/api/admin/summary")).json.users, 4);
    assert.equal((await new Client(sB.base).post("/api/login", { email: "panne@ciboo.sn", password: "motdepasse1" })).status, 200);
    assert.equal((await new Client(sB.base).post("/api/login", { email: "vide@ciboo.sn", password: "motdepasse1" })).status, 401);
    assert.equal((await b.get("/api/admin/supabase")).json.restoreError, "");
  });
  await ok("sauvegarde abîmée sur Supabase : refusée, rien n'est cassé", async () => {
    mock.store.get(BK + "latest.db.gz").buf = zlib.gzipSync(Buffer.from("ceci n'est pas une base de données"));
    await stopSite(sB); wipe(dirB);
    sB = await startSite(dirB, sbEnv(mock, KEY)); assert.match(sB.log, /illisible/);
    const a = await admin(sB), i = (await a.get("/api/admin/supabase")).json; assert.match(i.restoreError, /illisible/);
    const r = await a.post("/api/admin/supabase/restore", { file: "latest", confirm: "RESTAURER" }); assert.equal(r.status, 400); assert.match(r.json.error, /refusée/);
    assert.equal((await fetch(sB.base + "/health")).status, 200);
    const good = keys(mock, "history/")[0]; assert.ok(good);                              // une copie datée saine reste utilisable
    const r2 = await a.post("/api/admin/supabase/restore", { file: good.replace(/\.db\.gz$/, ""), confirm: "RESTAURER" }); assert.equal(r2.status, 200, r2.text);
    await Promise.race([sB.exited, sleep(15000)]); sB = await startSite(dirB, sbEnv(mock, KEY));
    assert.equal((await (await admin(sB)).get("/api/admin/summary")).json.users, 4);
  });
  await ok("contact régulier avec Supabase : une panne est repérée sans modification, puis rattrapée", async () => {
    const m3 = await startMock(KEY), s = await startSite(mk(), { ...sbEnv(m3, KEY), SUPABASE_PING_MS: "400" }), a = await admin(s);
    await waitFor(() => meta(m3), 10000, "copie initiale"); const l0 = m3.lists; await waitFor(() => m3.lists >= l0 + 2, 6000, "contacts réguliers");
    m3.failing = true; await waitFor(async () => (await a.get("/api/admin/supabase")).json.error, 6000, "panne repérée par le contact");
    m3.failing = false; const at0 = meta(m3).at; await waitFor(async () => !(await a.get("/api/admin/supabase")).json.error, 8000, "reprise");
    await waitFor(() => meta(m3).at !== at0, 8000, "copie de rattrapage"); assert.equal(meta(m3).reason, "rattrapage"); assert.deepEqual(m3.bad, []);
    await stopSite(s); m3.close();
  });
  await ok("clé historique (JWT) acceptée ; historique limité à 14 jours ; bucket privé", async () => {
    for (let d = 1; d <= 20; d++) mock2.store.set(BK + "history/2020-01-" + String(d).padStart(2, "0") + ".db.gz", { buf: Buffer.from("x"), type: "", updated: "2020-01-01T00:00:00Z" });
    mock2.buckets.add("ciboo-sauvegardes");
    const s = await startSite(mk(), sbEnv(mock2, JWT));
    await waitFor(() => meta(mock2), 10000, "copie avec clé JWT"); await waitFor(() => keys(mock2, "history/").length === 14, 10000, "nettoyage de l'historique");
    const h = keys(mock2, "history/").sort(); assert.equal(h[0], "history/2020-01-08.db.gz"); assert.ok(h.includes("history/" + today + ".db.gz"));
    assert.deepEqual(mock2.bad, []); await stopSite(s);
  });
  await ok("adresse du projet : l'adresse du tableau de bord ou de l'API est acceptée, les mauvaises refusées", async () => {
    const t = (u, k = KEY) => JSON.parse(spawnSync(process.execPath, ["-e", "const s=require('./supabase');console.log(JSON.stringify({c:s.configured,h:s.host,p:s.problem}))"], { cwd: __dirname, env: { ...process.env, SUPABASE_URL: u, SUPABASE_SECRET_KEY: k, SUPABASE_SERVICE_ROLE_KEY: "" }, encoding: "utf8" }).stdout);
    assert.equal(t("https://supabase.com/dashboard/project/abcdefghijklmnopqrst").h, "abcdefghijklmnopqrst.supabase.co");
    assert.equal(t("https://abcdefghijklmnopqrst.supabase.co/rest/v1/").h, "abcdefghijklmnopqrst.supabase.co");
    assert.equal(t("abcdefghijklmnopqrst.supabase.co").c, true);
    assert.equal(t("https://pirate.example.com").c, false); assert.equal(t("http://abcdefghijklmnopqrst.supabase.co").c, false);
    assert.equal(t("https://abcdefghijklmnopqrst.supabase.co", "").c, false);
  });
  await ok("aucune requête n'a été refusée pour mauvaise authentification", async () => { assert.deepEqual(mock.bad, []); assert.deepEqual(mock2.bad, []); });

  for (const s of sites) await stopSite(s);
  mock.close(); mock2.close(); for (const d of tmpdirs) fs.rmSync(d, { recursive: true, force: true });
  console.log(`\n${n} vérifications Supabase réussies.`); process.exit(0);
})().catch(async e => { console.error("\nÉCHEC :", e && e.message); for (const s of sites) { if (s.proc.exitCode === null) s.proc.kill("SIGKILL"); } if (sites.length) console.error("--- journal du dernier site ---\n" + sites[sites.length - 1].log.slice(-1500)); process.exit(1); });
