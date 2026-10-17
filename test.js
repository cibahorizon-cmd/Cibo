"use strict";
/* Tests automatiques : lance le serveur avec une base temporaire et vérifie les parcours essentiels.
   Utilisation : npm test */
const { spawn } = require("node:child_process"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict");
const PORT = 3900 + Math.floor(Math.random() * 90), BASE = "http://127.0.0.1:" + PORT;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ciba-test-"));
const TOTP = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // secret de test (RFC 6238)
const env = { ...process.env, PORT: String(PORT), DATA_DIR: dir, PERSISTENT_DATA: "1", SESSION_SECRET: "test-secret-test-secret-1234", ADMIN_EMAIL: "admin@ciba.sn", ADMIN_PASSWORD: "MotDePasseAdmin1", ADMIN_TOTP_SECRET: TOTP };
const srv = spawn(process.execPath, [path.join(__dirname, "server.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; srv.stdout.on("data", d => log += d); srv.stderr.on("data", d => log += d);
const sleep = ms => new Promise(r => setTimeout(r, ms));
class Client {
  constructor() { this.cookie = ""; }
  async call(method, p, body, extra = {}) {
    const h = { "x-requested-with": "ciba", ...extra }; if (body !== undefined) h["content-type"] = "application/json"; if (this.cookie) h.cookie = this.cookie;
    const r = await fetch(BASE + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0].endsWith("=") ? "" : sc.split(";")[0];
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { }
    return { status: r.status, json: j, text: t, headers: r.headers };
  }
  get(p) { return this.call("GET", p); } post(p, b) { return this.call("POST", p, b === undefined ? {} : b); } put(p, b) { return this.call("PUT", p, b); } del(p) { return this.call("DELETE", p); }
}
let n = 0; const ok = (name, fn) => fn().then(() => { n++; console.log("  ✔ " + name); }).catch(e => { console.error("  ✘ " + name + "\n    " + (e && e.message)); throw e; });
(async () => {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + "/health")).ok) break; } catch { } await sleep(250); if (i === 59) throw new Error("Le serveur n'a pas démarré :\n" + log); }
  const anon = new Client(), awa = new Client(), bob = new Client(), adm = new Client();
  const { totp } = require("./totp");
  console.log("Tests Ciba Édition");
  await ok("code TOTP conforme à la norme RFC 6238", async () => assert.equal(totp(TOTP, 59000), "287082"));
  await ok("page d'accueil, application, icône et santé", async () => {
    const h = await anon.get("/"); assert.equal(h.status, 200); assert.match(h.text, /Ciba Édition/); assert.match(h.headers.get("content-security-policy"), /script-src 'self'/);
    assert.equal((await anon.get("/app.js")).status, 200); assert.equal((await anon.get("/sw.js")).status, 200); assert.equal((await anon.get("/icon-192.png")).status, 200);
    assert.equal((await anon.get("/manifest.webmanifest")).status, 200); assert.equal((await anon.get("/health")).text, "ok");
    assert.equal((await anon.get("/inconnu")).status, 404); assert.equal((await anon.get("/../server.js")).status, 404);
  });
  let books;
  await ok("catalogue public : exemples chargés, textes cachés", async () => {
    const r = await anon.get("/api/books"); assert.equal(r.status, 200); books = r.json.books; assert.ok(books.length >= 13);
    assert.ok(!r.text.includes("Texte d'exemple"), "le texte des livres ne doit pas fuiter dans la liste");
    assert.ok(books.find(b => b.t === "Pack Entrepreneur").inc.length === 2);
  });
  const id = t => books.find(b => b.t === t).id;
  await ok("lecture : gratuit complet, payant limité à un extrait", async () => {
    const free = id("Contes de la savane"), paid = id("Guide du jeune entrepreneur");
    const tc = (await anon.get(`/api/books/${free}/toc`)).json; assert.deepEqual(tc.toc.map(x => x.p), [0, 2, 4]); assert.equal(tc.total, 6); assert.ok(tc.words > 100);
    const a = await anon.get(`/api/books/${free}/page/2`); assert.equal(a.status, 200); assert.match(a.json.text, /^# Chapitre 2 : Le voyage/);
    const p0 = await anon.get(`/api/books/${paid}/page/0`); assert.equal(p0.status, 200); assert.equal(p0.json.preview, true);
    const p1 = await anon.get(`/api/books/${paid}/page/1`); assert.equal(p1.status, 403); assert.equal(p1.json.locked, true);
    assert.equal((await anon.get(`/api/books/${paid}/offline`)).status, 401);
  });
  await ok("inscription, connexion, session, refus des erreurs", async () => {
    assert.equal((await awa.post("/api/signup", { email: "awa@ciba.sn", name: "Awa", password: "court" })).status, 400);
    const s = await awa.post("/api/signup", { email: "Awa@Ciba.sn", name: "Awa", password: "motdepasse1" }); assert.equal(s.status, 200); assert.equal(s.json.user.email, "awa@ciba.sn");
    assert.equal((await awa.get("/api/me")).json.user.name, "Awa");
    assert.equal((await bob.post("/api/signup", { email: "awa@ciba.sn", name: "Xavier", password: "motdepasse1" })).status, 409);
    assert.equal((await bob.post("/api/signup", { email: "bob@ciba.sn", name: "Bob", password: "motdepasse2" })).status, 200);
    await awa.post("/api/logout"); assert.equal((await awa.get("/api/me")).json.user, null);
    assert.equal((await awa.post("/api/login", { email: "awa@ciba.sn", password: "mauvais" })).status, 401);
    assert.equal((await awa.post("/api/login", { email: "awa@ciba.sn", password: "motdepasse1" })).status, 200);
  });
  await ok("protection : requêtes sans en-tête ou d'une autre origine refusées", async () => {
    const r = await fetch(BASE + "/api/logout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); assert.equal(r.status, 403);
    const r2 = await fetch(BASE + "/api/logout", { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "ciba", origin: "https://pirate.example" }, body: "{}" }); assert.equal(r2.status, 403);
    assert.equal((await anon.get("/api/admin/summary")).status, 401); assert.equal((await awa.get("/api/admin/summary")).status, 403);
  });
  await ok("administrateur : mot de passe, puis code à deux facteurs", async () => {
    const a = await adm.post("/api/login", { email: "admin@ciba.sn", password: "MotDePasseAdmin1" }); assert.equal(a.status, 401); assert.equal(a.json.needCode, true);
    assert.equal((await adm.post("/api/login", { email: "admin@ciba.sn", password: "MotDePasseAdmin1", code: "000000" })).status, 401);
    const code = totp(TOTP, Date.now()); const b = await adm.post("/api/login", { email: "admin@ciba.sn", password: "MotDePasseAdmin1", code });
    assert.equal(b.status, 200); assert.equal(b.json.user.role, "admin"); assert.equal((await adm.get("/api/admin/summary")).status, 200);
  });
  const paid = () => id("Guide du jeune entrepreneur");
  let payId;
  await ok("achat numérique : paiement en attente, validation, accès ouvert", async () => {
    assert.equal((await anon.post("/api/payments", { bookId: paid(), method: "Wave", tx: "T123456" })).status, 401);
    assert.equal((await awa.post("/api/payments", { bookId: paid(), method: "Carte", tx: "T123456" })).status, 400);
    assert.equal((await awa.post("/api/payments", { bookId: id("Contes de la savane"), method: "Wave", tx: "T123456" })).status, 400);
    const p = await awa.post("/api/payments", { bookId: paid(), method: "Wave", tx: "T123456" }); assert.equal(p.status, 200); payId = p.json.id;
    assert.equal((await awa.post("/api/payments", { bookId: paid(), method: "Wave", tx: "T999999" })).status, 409, "doublon en attente");
    assert.equal((await bob.post("/api/payments", { bookId: paid(), method: "Wave", tx: "T123456" })).status, 409, "transaction déjà utilisée");
    assert.equal((await awa.get(`/api/books/${paid()}/page/2`)).status, 403, "pas d'accès avant validation");
    assert.equal((await awa.post(`/api/admin/payments/${payId}/validate`)).status, 403, "un client ne valide pas");
    assert.equal((await adm.post(`/api/admin/payments/${payId}/validate`)).status, 200);
    assert.equal((await adm.post(`/api/admin/payments/${payId}/validate`)).status, 409);
    const r = await awa.get(`/api/books/${paid()}/page/2`); assert.equal(r.status, 200); assert.equal(r.json.preview, false);
    const off = await awa.get(`/api/books/${paid()}/offline`); assert.equal(off.status, 200); assert.equal(off.json.pg.length, 6);
    assert.equal((await bob.get(`/api/books/${paid()}/page/2`)).status, 403, "l'accès est personnel");
  });
  await ok("pack : la validation ouvre tous les livres du pack", async () => {
    const pack = id("Pack Entrepreneur"), compta = id("Comptabilité de base");
    const p = await awa.post("/api/payments", { bookId: pack, method: "Orange Money", tx: "OM-778899" }); assert.equal(p.status, 200);
    assert.equal((await adm.post(`/api/admin/payments/${p.json.id}/validate`)).status, 200);
    assert.equal((await awa.get(`/api/books/${compta}/page/1`)).status, 200);
    assert.equal((await awa.post("/api/payments", { bookId: pack, method: "Wave", tx: "T555555" })).status, 409, "pack déjà possédé");
  });
  await ok("refus d'un paiement", async () => {
    const p = await bob.post("/api/payments", { bookId: id("Réussir son BFEM"), method: "Wave", tx: "T424242" }); assert.equal(p.status, 200);
    assert.equal((await adm.post(`/api/admin/payments/${p.json.id}/reject`)).status, 200);
    assert.equal((await bob.get(`/api/books/${id("Réussir son BFEM")}/page/1`)).status, 403);
    assert.equal((await bob.post("/api/payments", { bookId: id("Réussir son BFEM"), method: "Wave", tx: "T424242" })).status, 200, "transaction refusée réutilisable");
  });
  await ok("avis réservés aux lecteurs, un avis par livre", async () => {
    assert.equal((await bob.post("/api/reviews", { bookId: paid(), note: 5, comment: "Super" })).status, 403);
    assert.equal((await awa.post("/api/reviews", { bookId: paid(), note: 6, comment: "Super" })).status, 400);
    assert.equal((await awa.post("/api/reviews", { bookId: paid(), note: 4, comment: "Très utile" })).status, 200);
    assert.equal((await awa.post("/api/reviews", { bookId: paid(), note: 5, comment: "Excellent" })).status, 200);
    const d = (await anon.get(`/api/books/${paid()}`)).json; assert.equal(d.reviews.length, 1); assert.equal(d.book.rt, 5);
  });
  await ok("commande physique : prix, stock, code promo calculés par le serveur", async () => {
    const cfg = (await anon.get("/api/config")).json, dakar = cfg.zones.find(z => z.name === "Dakar").id, bk = id("Le baobab et la lune");
    const bad = [{ items: [], name: "A B", phone: "771234567", address: "Rue 1 Dakar", zoneId: dakar }, { items: [{ id: paid(), q: 1 }], name: "A B", phone: "771234567", address: "Rue 1 Dakar", zoneId: dakar }, { items: [{ id: bk, q: 99 }], name: "A B", phone: "771234567", address: "Rue 1 Dakar", zoneId: dakar }, { items: [{ id: bk, q: 1 }], name: "A B", phone: "12", address: "Rue 1 Dakar", zoneId: dakar }, { items: [{ id: bk, q: 1 }], name: "A B", phone: "771234567", address: "Rue 1 Dakar", zoneId: dakar, promo: "FAUX" }];
    for (const b of bad) assert.ok([400, 409].includes((await anon.post("/api/orders", b)).status));
    const r = await awa.post("/api/orders", { items: [{ id: bk, q: 2 }], name: "Awa Ndiaye", phone: "77 123 45 67", address: "Medina, Rue 10", zoneId: dakar, promo: "ciba10" });
    assert.equal(r.status, 200); assert.equal(r.json.total, 13000 - 1300 + 1500); assert.match(r.json.ref, /^CIBA-\d{5}$/);
    const after = (await anon.get("/api/books")).json.books.find(b => b.id === bk); assert.equal(after.s, 18, "stock réduit");
    const mine = (await awa.get("/api/orders/mine")).json.orders; assert.equal(mine.length, 1); assert.equal(mine[0].status, "En préparation");
    assert.equal((await adm.put(`/api/admin/orders/${r.json.ref}`, { status: "Expédiée", driver: "Moussa", tracking: "SUIVI-1" })).status, 200);
    assert.equal((await awa.get("/api/orders/mine")).json.orders[0].driver, "Moussa");
    assert.equal((await adm.put(`/api/admin/orders/${r.json.ref}`, { status: "Annulée" })).status, 200);
    assert.equal((await anon.get("/api/books")).json.books.find(b => b.id === bk).s, 20, "stock remis après annulation");
    assert.equal((await adm.put(`/api/admin/orders/${r.json.ref}`, { status: "Livrée" })).status, 409);
  });
  let newId;
  await ok("administration : ajouter, modifier, cacher, supprimer un livre", async () => {
    assert.equal((await adm.post("/api/admin/books", { title: "Livre test", author: "Moi", cat: "Roman", kind: "paid", price: 2000, text: "court" })).status, 400);
    const png = "data:image/png;base64," + Buffer.from("fakepng").toString("base64");
    const a = await adm.post("/api/admin/books", { title: "Livre test", author: "Moi", cat: "Roman", kind: "paid", price: 2000, text: "Premier paragraphe du livre.\n\nDeuxième paragraphe, assez long pour exister.\n" + "Mot ".repeat(600), summary: "Un résumé", cover: png });
    assert.equal(a.status, 200); newId = a.json.id;
    assert.equal((await adm.post("/api/admin/books", { title: "Mauvaise couv", author: "Moi", cat: "Roman", kind: "free", text: "x".repeat(40), cover: "data:image/svg+xml;base64,PHN2Zz4=" })).status, 400);
    const cv = await anon.get(`/cover/${newId}`); assert.equal(cv.status, 200); assert.equal(cv.headers.get("content-type"), "image/png");
    assert.ok((await anon.get(`/api/books/${newId}`)).json.book.cv >= 1);
    assert.equal((await adm.put(`/api/admin/books/${newId}`, { title: "Livre modifié", price: 2500, bio: "Auteur" })).status, 200);
    assert.equal((await anon.get(`/api/books/${newId}`)).json.book.p, 2500);
    assert.equal((await adm.put(`/api/admin/books/${newId}`, { hidden: true })).status, 200);
    assert.ok(!(await anon.get("/api/books")).json.books.find(b => b.id === newId), "livre retiré invisible");
    assert.equal((await anon.get(`/api/books/${newId}`)).status, 404);
    assert.ok((await adm.get("/api/admin/books")).json.books.find(b => b.id === newId).h === 1);
    assert.equal((await adm.put(`/api/admin/books/${newId}`, { hidden: false })).status, 200);
    assert.equal((await awa.put(`/api/admin/books/${newId}`, { title: "Pirate" })).status, 403);
    const phys = await adm.post("/api/admin/books", { title: "Papier", author: "Moi", cat: "Guide", kind: "phys", price: 4000, stock: 5 }); assert.equal(phys.status, 200);
    assert.equal((await adm.del(`/api/admin/books/${newId}`)).status, 200); assert.equal((await adm.del(`/api/admin/books/${phys.json.id}`)).status, 200);
    assert.equal((await anon.get(`/api/books/${newId}`)).status, 404);
  });
  await ok("retrait d'un livre acheté : le client le garde ; suppression d'un livre d'un pack retire le pack", async () => {
    const g = paid(); assert.equal((await adm.put(`/api/admin/books/${g}`, { hidden: true })).status, 200);
    assert.ok((await awa.get("/api/books")).json.books.find(b => b.id === g), "le propriétaire voit son livre retiré");
    assert.ok(!(await bob.get("/api/books")).json.books.find(b => b.id === g));
    assert.equal((await awa.get(`/api/books/${g}/page/3`)).status, 200);
    await adm.put(`/api/admin/books/${g}`, { hidden: false });
    const pack = id("Pack Entrepreneur"), compta = id("Comptabilité de base");
    assert.ok((await anon.get("/api/books")).json.books.find(b => b.id === pack));
    assert.equal((await adm.del(`/api/admin/books/${compta}`)).status, 200);
    assert.ok(!(await anon.get("/api/books")).json.books.find(b => b.id === pack), "le pack disparaît avec l'un de ses livres");
  });
  await ok("livres arabes : domaines, langue, lecture, validations", async () => {
    const all = (await anon.get("/api/books")).json.books, ar = all.filter(b => b.l === "ar");
    assert.ok(ar.length >= 6, "exemples arabes présents"); assert.ok(all.filter(b => b.l !== "ar").length >= 8);
    assert.ok(new Set(ar.map(b => b.k)).size >= 6, "plusieurs domaines");
    const free = ar.find(b => b.f === "free"), tca = (await anon.get(`/api/books/${free.id}/toc`)).json.toc, p = await anon.get(`/api/books/${free.id}/page/${tca[1].p}`); assert.equal(tca.length, 3); assert.equal(p.status, 200); assert.equal(p.json.l, "ar"); assert.match(p.json.text, /^# الفصل 2/);
    const body = { title: "كتاب تجريبي", author: "مؤلف", cat: "Langue arabe", lang: "ar", kind: "free", text: "بسم الله الرحمن الرحيم. هذا نص عربي طويل بما يكفي للاختبار.\n\nالفقرة الثانية من الكتاب." };
    assert.equal((await adm.post("/api/admin/books", { ...body, cat: "Roman" })).status, 400, "Roman n'est pas un domaine arabe");
    assert.equal((await adm.post("/api/admin/books", { ...body, lang: "de" })).status, 400);
    const a = await adm.post("/api/admin/books", body); assert.equal(a.status, 200);
    const pg = await anon.get(`/api/books/${a.json.id}/page/0`); assert.match(pg.json.text, /^@ كتاب تجريبي\n\nبسم الله/); assert.equal(pg.json.l, "ar");
    assert.equal((await adm.put(`/api/admin/books/${a.json.id}`, { lang: "fr" })).status, 400, "changer de langue demande une catégorie");
    assert.equal((await adm.put(`/api/admin/books/${a.json.id}`, { lang: "fr", cat: "Roman" })).status, 200);
    assert.equal((await anon.get(`/api/books/${a.json.id}`)).json.book.l, "fr");
    assert.equal((await adm.put(`/api/admin/books/${a.json.id}`, { lang: "ar", cat: "Histoire et civilisation" })).status, 200);
    assert.equal((await adm.put(`/api/admin/books/${a.json.id}`, { cat: "Roman" })).status, 400);
    assert.equal((await awa.get(`/api/books/${a.json.id}/offline`)).json.l, "ar");
    assert.equal((await adm.del(`/api/admin/books/${a.json.id}`)).status, 200);
  });
  await ok("sommaire, chapitres, recherche dans le livre, couverture de 4 Mo", async () => {
    const mk = async (title, text, extra = {}) => { const r = await adm.post("/api/admin/books", { title, author: "Moi", cat: "Guide", kind: "free", text, ...extra }); assert.equal(r.status, 200, r.text); return r.json; };
    const filler = "Une phrase du livre pour remplir la page. ".repeat(30);
    const a = await mk("Avec marqueurs", `# Chapitre un\n${filler}\n## Une sous-partie\n${filler}\n# Chapitre deux\n${filler}\n${filler}\n# Conclusion\nFin du livre, étude finale.`);
    assert.ok(a.chapters === 3 && a.pages >= 4);
    const t1 = (await anon.get(`/api/books/${a.id}/toc`)).json.toc; assert.deepEqual(t1.map(x => x.t), ["Chapitre un", "Une sous-partie", "Chapitre deux", "Conclusion"]); assert.deepEqual(t1.map(x => x.l), [1, 2, 1, 1]);
    assert.ok(t1[3].p > t1[2].p && t1[2].p > t1[0].p, "chaque chapitre commence sur une nouvelle page");
    const pageOf = async p => (await anon.get(`/api/books/${a.id}/page/${p}`)).json.text;
    assert.match(await pageOf(t1[2].p), /^# Chapitre deux/); assert.match(await pageOf(0), /^@ Avec marqueurs\n\n# Chapitre un/);
    const b = await mk("Sans marqueurs", `Chapitre 1 : Les débuts\n${filler}\nChapitre 2 : La suite\n${filler}\nIntroduction\nConclusion\n${filler}`);
    assert.deepEqual((await anon.get(`/api/books/${b.id}/toc`)).json.toc.map(x => x.t), ["Chapitre 1 : Les débuts", "Chapitre 2 : La suite", "Introduction", "Conclusion"], "détection automatique");
    const c2 = await mk("نص عربي", `الفصل الأول\n${filler}\nالفصل الثاني\n${filler}\nالخاتمة\nنهاية`, { cat: "Langue arabe", lang: "ar" });
    assert.equal((await anon.get(`/api/books/${c2.id}/toc`)).json.toc.length, 3);
    const s1 = (await anon.get(`/api/books/${a.id}/search?q=ETUDE`)).json; assert.equal(s1.limited, false); assert.equal(s1.results.length, 1); assert.match(s1.results[0].s, /étude finale/); assert.equal(s1.results[0].p, t1[3].p);
    assert.equal((await anon.get(`/api/books/${a.id}/search?q=x`)).status, 400);
    const pd = id("Guide du jeune entrepreneur"); assert.ok((await anon.get(`/api/books/${pd}/toc`)).json.toc.length === 3, "sommaire visible avant achat");
    const s2 = (await anon.get(`/api/books/${pd}/search?q=Texte`)).json; assert.equal(s2.limited, true); assert.ok(s2.results.every(r => r.p === 0));
    assert.equal((await adm.put(`/api/admin/books/${a.id}`, { title: "Titre changé" })).status, 200); assert.match(await pageOf(0), /^@ Titre changé\n\n# Chapitre un/);
    const up = await adm.put(`/api/admin/books/${a.id}`, { text: "# Seul chapitre\n" + filler }); assert.equal(up.json.chapters, 1);
    assert.deepEqual((await anon.get(`/api/books/${a.id}/toc`)).json.toc.map(x => x.t), ["Seul chapitre"]);
    const big = n => "data:image/png;base64," + Buffer.alloc(n, 7).toString("base64");
    assert.equal((await adm.put(`/api/admin/books/${a.id}`, { cover: big(3.5 * 1024 * 1024) })).status, 200, "couverture de 3,5 Mo acceptée");
    const tooBig = await adm.put(`/api/admin/books/${a.id}`, { cover: big(4.2 * 1024 * 1024) }); assert.equal(tooBig.status, 400); assert.match(tooBig.json.error, /4 Mo/);
    assert.equal((await anon.get(`/cover/${a.id}`)).status, 200);
    for (const x of [a.id, b.id, c2.id]) await adm.del(`/api/admin/books/${x}`);
  });
  await ok("livraison, codes promo, numéros de paiement", async () => {
    const z = await adm.post("/api/admin/zones", { name: "Saint-Louis", fee: 3000 }); assert.equal(z.status, 200);
    assert.equal((await adm.put(`/api/admin/zones/${z.json.id}`, { fee: 3200 })).status, 200);
    assert.ok((await anon.get("/api/config")).json.zones.find(x => x.name === "Saint-Louis" && x.fee === 3200));
    assert.equal((await adm.del(`/api/admin/zones/${z.json.id}`)).status, 200);
    assert.equal((await adm.post("/api/admin/promos", { code: "ete20", percent: 20 })).status, 200);
    assert.equal((await anon.post("/api/promo/check", { code: "ETE20" })).json.percent, 20);
    assert.equal((await adm.del("/api/admin/promos/ETE20")).status, 200); assert.equal((await anon.post("/api/promo/check", { code: "ETE20" })).status, 404);
    assert.equal((await adm.put("/api/admin/config", { wave: "77 111 22 33", om: "78 111 22 33" })).status, 200);
    assert.equal((await anon.get("/api/config")).json.wave, "77 111 22 33");
  });
  await ok("statistiques, clients, journal, exports CSV et sauvegarde", async () => {
    const s = (await adm.get("/api/admin/stats")).json; assert.ok(s.digital.length >= 1 && s.top.length >= 1);
    const sum = (await adm.get("/api/admin/summary")).json; assert.ok(sum.users >= 2 && sum.revenue > 0 && Array.isArray(sum.warn));
    assert.ok((await adm.get("/api/admin/users")).json.users.length >= 2); assert.ok((await adm.get("/api/admin/audit")).json.log.length > 5);
    const c = await adm.get("/api/admin/export/payments.csv"); assert.match(c.headers.get("content-type"), /text\/csv/); assert.match(c.text, /Référence/);
    const o = await adm.get("/api/admin/export/orders.csv"); assert.equal(o.status, 200);
    const bk = await adm.get("/api/admin/backup"); assert.equal(bk.status, 200); assert.ok(bk.text.startsWith("SQLite format 3") || bk.text.length > 1000);
  });
  await ok("mot de passe : changement par le client, réinitialisation par l'admin", async () => {
    assert.equal((await awa.post("/api/me/password", { old: "faux", password: "nouveaumdp1" })).status, 401);
    assert.equal((await awa.post("/api/me/password", { old: "motdepasse1", password: "court" })).status, 400);
    assert.equal((await awa.post("/api/me/password", { old: "motdepasse1", password: "nouveaumdp1" })).status, 200);
    const c2 = new Client(); assert.equal((await c2.post("/api/login", { email: "awa@ciba.sn", password: "motdepasse1" })).status, 401);
    assert.equal((await c2.post("/api/login", { email: "awa@ciba.sn", password: "nouveaumdp1" })).status, 200);
    const u = (await adm.get("/api/admin/users")).json.users.find(x => x.email === "awa@ciba.sn");
    assert.equal((await awa.post(`/api/admin/users/${u.id}/reset`)).status, 403);
    const r = await adm.post(`/api/admin/users/${u.id}/reset`); assert.equal(r.status, 200); assert.ok(r.json.password.length >= 9);
    const c3 = new Client(); assert.equal((await c3.post("/api/login", { email: "awa@ciba.sn", password: r.json.password })).status, 200);
    assert.equal((await c3.post("/api/me/password", { old: r.json.password, password: "motdepasse1" })).status, 200);
  });
  await ok("suppression d'un compte client", async () => {
    assert.equal((await bob.post("/api/me/delete", { password: "faux" })).status, 401);
    assert.equal((await bob.post("/api/me/delete", { password: "motdepasse2" })).status, 200);
    assert.equal((await bob.post("/api/login", { email: "bob@ciba.sn", password: "motdepasse2" })).status, 401);
    assert.equal((await adm.post("/api/me/delete", { password: "MotDePasseAdmin1" })).status, 403);
  });
  await ok("verrouillage après plusieurs mots de passe faux", async () => {
    const c = new Client(); for (let i = 0; i < 5; i++) await c.post("/api/login", { email: "awa@ciba.sn", password: "faux" + i });
    assert.equal((await c.post("/api/login", { email: "awa@ciba.sn", password: "motdepasse1" })).status, 429);
  });
  console.log(`\n${n} vérifications réussies.`);
})().then(() => { srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); process.exit(0); })
  .catch(e => { console.error("\nÉCHEC :", e && e.message); console.error("--- journal du serveur ---\n" + log); srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); process.exit(1); });
