"use strict";
/* Ciboo : interface du site. Toutes les données viennent du serveur (/api). */
const $ = i => document.getElementById(i),
  esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => "&#" + c.charCodeAt(0) + ";"),
  fmt = n => Number(n || 0).toLocaleString("fr-FR") + " FCFA",
  dfr = t => new Date(t).toLocaleDateString("fr-FR");
const S = { u: null, B: [], cfg: { zones: [], wave: "", om: "" }, flt: "all", q: "", fltA: "all", qA: "", off: false };
const CATS = ["Roman", "Guide", "Manuel de formation", "développement personnel", "Autres"],
  ARC = [["Religion et spiritualité", "Religion", "الدين والروحانيات"], ["Langue arabe", "Langue arabe", "اللغة العربية"], ["Histoire et civilisation", "Histoire", "التاريخ والحضارة"], ["Littérature et poésie", "Littérature", "الأدب والشعر"], ["Sciences et savoirs", "Sciences", "العلوم والمعارف"], ["Enfants et contes", "Enfants", "الأطفال والقصص"], ["Éducation et formation", "Éducation", "التعليم والتكوين"]],
  AR = Object.fromEntries(ARC.map(c => [c[0], c[2]])),
  catOpts = (sel, lang) => lang === "ar" ? ARC.map(c => `<option value="${esc(c[0])}"${c[0] === sel ? " selected" : ""}>${c[2]} · ${c[1]}</option>`).join("") : CATS.map(k => `<option${k === sel ? " selected" : ""}>${esc(k)}</option>`).join(""),
  col = id => `hsl(${(id * 47) % 360} 38% 32%)`;
let toastT;
function toast(t) { const e = $("toast"); e.textContent = t; e.style.display = "block"; clearTimeout(toastT); toastT = setTimeout(() => e.style.display = "none", 3200); }
async function api(p, o = {}) {
  const h = { "x-requested-with": "ciba" }; let b;
  if (o.body !== undefined) { h["content-type"] = "application/json"; b = JSON.stringify(o.body); }
  let r; try { r = await fetch("/api" + p, { method: o.method || "GET", headers: h, body: b, credentials: "same-origin" }); }
  catch (e) { throw Object.assign(new Error("Connexion impossible. Vérifiez votre Internet."), { net: true }); }
  let d = null; try { d = await r.json(); } catch { }
  if (!r.ok) throw Object.assign(new Error((d && d.error) || "Erreur " + r.status), { status: r.status, data: d });
  return d;
}
const act = async f => { try { return await f(); } catch (e) { toast(e.message); return undefined; } };
const lsg = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } },
  lss = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } };
let cart = lsg("ciba:cart", {});
const cartN = () => Object.values(cart).reduce((a, b) => a + b, 0);
const saveCart = () => { lss("ciba:cart", cart); nav(); };
const rpKey = () => "ciba:rp:" + (S.u ? S.u.id : 0), RP = () => lsg(rpKey(), { last: {}, bk: {} });

/* ---------- Chargement ---------- */
async function load() { const [m, b, c] = await Promise.all([api("/me"), api("/books"), api("/config")]); S.u = m.user; S.B = b.books; S.cfg = c; S.off = false; }
async function refreshBooks() { try { const [m, b] = await Promise.all([api("/me"), api("/books")]); S.u = m.user; S.B = b.books; } catch { } }

/* ---------- Navigation ---------- */
let cur = "cat";
function nav() {
  const T = [["cat", "Catalogue"], ["ar", "Livres arabes"], ["lib", "Bibliothèque"], ["cart", "Panier " + cartN()], ["acc", S.u ? "Mon compte" : "Connexion"], ["info", "Infos"]];
  if (S.u && S.u.role === "admin") T.push(["adm", "Admin"]);
  $("nav").innerHTML = T.map(t => `<button data-v="${t[0]}" class="${t[0] === cur ? "on" : ""}">${t[1]}</button>`).join("");
}
$("nav").onclick = e => { if (e.target.dataset.v) view(e.target.dataset.v); };
function view(v) {
  cur = v; document.querySelectorAll(".view").forEach(e => e.classList.toggle("on", e.id === v)); nav();
  ({ cat: grid, ar: gridA, lib: libv, cart: cartv, acc: accv, adm: admv }[v] || (() => { }))(); scrollTo(0, 0);
}

/* ---------- Catalogue ---------- */
const FIL = [["all", "Tous"], ["free", "Gratuits à lire"], ["paid", "Numériques payants"], ["phys", "Livres physiques"], ["Guide", "Guides"], ["Manuel de formation", "Manuels de formation"], ["Roman", "Romans"], ["Pack", "Packs"]];
$("chips").innerHTML = FIL.map(f => `<button class="chip${f[0] === "all" ? " on" : ""}" data-f="${esc(f[0])}">${f[1]}</button>`).join("");
$("chips").onclick = e => { if (e.target.dataset.f) { S.flt = e.target.dataset.f; $("chips").querySelectorAll(".chip").forEach(c => c.classList.toggle("on", c === e.target)); grid(); } };
$("s").oninput = e => { S.q = e.target.value; grid(); };
const lbl = b => b.f === "free" ? '<span class="tag g">Lecture gratuite</span>' : b.inc ? '<span class="tag">Pack</span>' : b.f === "paid" ? '<span class="tag">Lecture en ligne</span>' : '<span class="tag">Livre physique</span>';
const rat = b => b.rn ? `<span class="mut">★ ${b.rt} (${b.rn} avis)</span>` : "";
const cover = b => `<div class="cv" dir="auto" data-d="${b.id}" style="background:${b.cv ? `linear-gradient(transparent 35%,rgba(0,0,0,.75)),url(/cover/${b.id}?v=${b.cv}) center/cover` : col(b.id)}"><i>${esc(AR[b.k] || b.k)}</i>${esc(b.t)}</div>`;
function btns(b) {
  if (b.inc) return b.own ? '<button class="btn" data-v2="lib">Ma bibliothèque</button>' : b.pend ? '<span class="tag p">Paiement en attente</span>' : `<button class="btn" data-b="${b.id}">Acheter le pack</button>`;
  if (b.f === "phys") return b.s < 1 ? '<span class="tag">Épuisé</span>' : `<button class="btn" data-c="${b.id}">Ajouter au panier</button>`;
  if (b.own) return `<button class="btn" data-r="${b.id}">Lire</button>`;
  return `<button class="btn alt" data-r="${b.id}">Lire un extrait</button>` + (b.pend ? '<span class="tag p">Paiement en attente</span>' : `<button class="btn" data-b="${b.id}">Acheter</button>`);
}
const cards = (L, empty) => L.length ? L.map(b => `<div class="bk">${cover(b)}<div class="bi"><b dir="auto" data-d="${b.id}" style="cursor:pointer">${esc(b.t)}</b><span class="mut" dir="auto">${esc(b.a)}</span>${lbl(b)}<span class="pr">${b.f === "free" ? "Gratuit" : fmt(b.p)}</span>${rat(b)}${btns(b)}</div></div>`).join("") : `<p class="mut">${empty}</p>`;
const FILA = [["all", "Tous · الكل"], ["free", "Gratuits · مجانية"], ["paid", "Payants · مدفوعة"], ["phys", "Papier · ورقية"], ...ARC.map(c => [c[0], c[2] + " · " + c[1]])];
$("chipsa").innerHTML = FILA.map(f => `<button class="chip${f[0] === "all" ? " on" : ""}" data-f="${esc(f[0])}">${esc(f[1])}</button>`).join("");
$("chipsa").onclick = e => { if (e.target.dataset.f) { S.fltA = e.target.dataset.f; $("chipsa").querySelectorAll(".chip").forEach(c => c.classList.toggle("on", c === e.target)); gridA(); } };
$("sa").oninput = e => { S.qA = e.target.value; gridA(); };
function gridA() {
  if (S.off) { $("grida").innerHTML = '<p class="note">Le catalogue demande une connexion. Vos livres enregistrés se lisent dans Bibliothèque.</p>'; return; }
  const q = S.qA.toLowerCase(), L = S.B.filter(b => !b.h && b.l === "ar" && (S.fltA === "all" || b.f === S.fltA || b.k === S.fltA) && (b.t + " " + b.a).toLowerCase().includes(q));
  $("grida").innerHTML = cards(L, "Aucun livre arabe dans ce domaine pour le moment.");
}
function grid() {
  if (S.off) { $("grid").innerHTML = '<p class="note">Le catalogue demande une connexion. Vos livres enregistrés se lisent dans Bibliothèque.</p>'; return; }
  const q = S.q.toLowerCase(), L = S.B.filter(b => !b.h && b.l !== "ar" && (S.flt === "all" || b.f === S.flt || b.k === S.flt) && (b.t + " " + b.a).toLowerCase().includes(q));
  $("grid").innerHTML = cards(L, "Aucun livre trouvé.");
}
document.addEventListener("click", e => {
  const t = e.target.closest("[data-d],[data-r],[data-b],[data-c],[data-v2],[data-o],[data-oo],[data-od],[data-rv],[data-rdel]"); if (!t) return; const d = t.dataset;
  if (d.d) det(+d.d); else if (d.r) { if (d.lk) toast("Achetez ce livre pour lire ce chapitre."); else openR(+d.r, d.pg !== undefined ? +d.pg : undefined); } else if (d.b) buy(+d.b); else if (d.c) addCart(+d.c); else if (d.v2) { $("dt").classList.remove("on"); view(d.v2); }
  else if (d.o) offSave(+d.o); else if (d.oo) openOff(+d.oo); else if (d.od) offDel(+d.od); else if (d.rv) sendReview(+d.rv); else if (d.rdel) delReview(+d.rdel, +d.bk);
});
function addCart(id) {
  const b = S.B.find(x => x.id === id); if (!b || b.f !== "phys") return;
  if ((cart[id] || 0) >= b.s) { toast("Stock maximum atteint pour ce livre"); return; }
  cart[id] = (cart[id] || 0) + 1; saveCart(); toast("Ajouté au panier");
}

/* ---------- Fiche d'un livre ---------- */
$("dt").addEventListener("click", e => { if (e.target.id === "dx") $("dt").classList.remove("on"); });
async function det(id) {
  const d = await act(() => api("/books/" + id)); if (!d) return; const b = d.book, adm = S.u && S.u.role === "admin";
  const canRev = S.u && b.own && !b.inc && b.f !== "phys", toc = d.toc || [], lk = !b.own;
  $("dt").innerHTML = `<div class="bar"><b style="flex:1">Fiche du livre</b><button class="btn sm" id="dx">Fermer</button></div><div style="overflow-y:auto;padding:14px;max-width:680px;width:100%;margin:0 auto"><div style="max-width:200px">${cover(b)}</div><h1 dir="auto">${esc(b.t)}</h1><p class="mut">${esc(b.a)} · ${esc(b.k)}</p><p>${lbl(b)} <span class="pr">${b.f === "free" ? "Gratuit" : fmt(b.p)}</span> ${rat(b)}</p><div>${btns(b)}</div>
${toc.length ? `<h2>Sommaire</h2><div class="card" style="max-height:280px;overflow:auto;padding:2px 12px">${toc.map(x => `<button class="ti l${x.l}" data-r="${b.id}" data-pg="${x.p}"${lk && x.p > 0 ? ' data-lk="1"' : ""}>${lk && x.p > 0 ? "🔒 " : ""}<em>${esc(x.t)}</em><span>p. ${x.p + 1}</span></button>`).join("")}</div>${d.words ? `<p class="mut">Environ ${d.words.toLocaleString("fr-FR")} mots · lecture d'environ ${Math.max(1, Math.round(d.words / (b.l === "ar" ? 170 : 220) / 5) * 5)} min</p>` : ""}` : ""}<h2>Résumé</h2><p dir="auto">${esc(b.sm || "Résumé à venir.")}</p><h2>À propos de l'auteur</h2><p dir="auto">${esc(b.bio || "Présentation de l'auteur à venir.")}</p>${d.excerpt ? `<h2>Extrait gratuit</h2><p dir="auto" style="white-space:pre-wrap">${esc(d.excerpt)}…</p>` : ""}
<h2>Avis des lecteurs</h2>${d.reviews.length ? d.reviews.map(x => `<div class="card"><b>${"★".repeat(x.n)}${"☆".repeat(5 - x.n)}</b> <span class="mut">${esc(x.u)} · ${dfr(x.d)}</span><p>${esc(x.c)}</p>${adm ? `<button class="btn alt sm" data-rdel="${x.id}" data-bk="${b.id}">Supprimer cet avis</button>` : ""}</div>`).join("") : '<p class="mut">Aucun avis pour le moment.</p>'}
${canRev ? `<div class="card"><label for="rnt">Votre note</label><select id="rnt"><option>5</option><option>4</option><option>3</option><option>2</option><option>1</option></select><label for="rtx">Votre avis</label><textarea id="rtx" rows="3" maxlength="400"></textarea><button class="btn" style="margin-top:10px" data-rv="${b.id}">Publier mon avis</button></div>` : '<p class="mut">Connectez-vous, puis lisez ou achetez ce livre pour donner votre avis.</p>'}</div>`;
  $("dt").classList.add("on");
}
async function sendReview(id) {
  const c = $("rtx").value.trim(); if (c.length < 2) { toast("Écrivez votre avis"); return; }
  if (!(await act(() => api("/reviews", { method: "POST", body: { bookId: id, note: +$("rnt").value, comment: c } })))) return;
  toast("Merci pour votre avis"); await refreshBooks(); grid(); det(id);
}
async function delReview(rid, bid) { if (!confirm("Supprimer cet avis ?")) return; if (await act(() => api("/admin/reviews/" + rid, { method: "DELETE" }))) { await refreshBooks(); det(bid); } }

/* ---------- Achat d'un livre numérique ---------- */
let PB = null;
function buy(id) {
  const b = S.B.find(x => x.id === id); if (!b) return;
  closeReader(); if (!S.u) { $("dt").classList.remove("on"); toast("Connectez-vous pour acheter"); view("acc"); return; }
  PB = b; $("pt").textContent = b.t; $("pp").textContent = fmt(b.p); $("ph").value = ""; payins(); $("py").classList.add("on");
}
function payins() { if (!PB) return; const m = $("pm").value; $("pins").textContent = `1. Envoyez ${fmt(PB.p)} par ${m} au ${m === "Wave" ? S.cfg.wave : S.cfg.om}. 2. Notez le numéro de transaction reçu par SMS. 3. Saisissez-le ci-dessous.`; }
$("pm").onchange = payins; $("px").onclick = () => $("py").classList.remove("on");
$("pgo").onclick = async () => {
  const tx = $("ph").value.trim(); if (tx.length < 6) { toast("Entrez le numéro de transaction"); return; }
  if (!(await act(() => api("/payments", { method: "POST", body: { bookId: PB.id, method: $("pm").value, tx } })))) return;
  $("py").classList.remove("on"); $("dt").classList.remove("on"); toast("Paiement envoyé. Le livre s'ouvrira dès sa confirmation."); await refreshBooks(); view("acc");
};

/* ---------- Lecteur ---------- */
let R = null, ST = "toc", spk = false;
let RS = { fs: 19, ff: "serif", lh: 1.75, w: 680, th: "auto", jus: false, rate: 1, auto: false, ...lsg("ciba:reader", {}) };
const saveRS = () => lss("ciba:reader", RS);
function applyPrefs() {
  const r = $("rd"); r.style.setProperty("--rfs", RS.fs + "px"); r.style.setProperty("--rlh", RS.lh); r.style.setProperty("--rw", RS.w + "px");
  r.classList.remove("th-light", "th-sepia", "th-dark", "ff-sans", "jus");
  if (RS.th !== "auto") r.classList.add("th-" + RS.th); if (RS.ff === "sans") r.classList.add("ff-sans"); if (RS.jus) r.classList.add("jus");
}
function wmk() { const t = (R && R.wm || "visiteur") + " · Ciba Édition"; $("wm").style.backgroundImage = 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27300%27 height=%27170%27%3E%3Ctext x=%2710%27 y=%2790%27 font-size=%2716%27 font-family=%27sans-serif%27 fill=%27%23888%27 transform=%27rotate(-25 150 85)%27%3E' + encodeURIComponent(t) + '%3C/text%3E%3C/svg%3E")'; }
const normq = x => String(x).normalize("NFD").replace(/[\u0300-\u036f\u064b-\u065f\u0670\u0640]/g, "").toLowerCase();
function tocIdx(i) { let k = -1; (R.toc || []).forEach((c, n) => { if (c.p <= i) k = n; }); return k; }
function chapterAt(i) { const T = R.toc || [], h = T.some(c => c.l === 1) ? T.filter(c => c.l === 1) : T; let t = ""; for (const c of h) if (c.p <= i) t = c.t; return t; }
async function openR(id, page) {
  const b = S.B.find(x => x.id === id); if (!b) return;
  R = { id, t: b.t, l: b.l, i: page != null ? page : (RP().last[id] || 0), total: 0, toc: [], words: 0, wm: S.u ? S.u.email : "visiteur", off: false, prev: false, locked: false, own: !!b.own, price: b.p };
  stopSpeak(); closeSheet(); $("dt").classList.remove("on"); $("rd-t").textContent = b.t; $("rd-c").textContent = ""; $("pg").textContent = ""; wmk(); applyPrefs(); $("rd").classList.add("on");
  const myR = R, t = await act(() => api(`/books/${id}/toc`)); if (R !== myR) return;
  if (t) { R.toc = t.toc; R.words = t.words; R.total = t.total; if (R.i >= t.total) R.i = 0; }
  if (!R.own && R.i > 0) R.i = 0;
  await rp();
}
function go(i) {
  if (!R) return; i = Math.max(0, Math.min(i, (R.total || 1) - 1));
  if (!R.off && !R.own && i > 0) { R.i = 0; lockPanel(); return; }
  stopSpeak(); R.i = i; rp();
}
function renderPage(text) {
  const pg = $("pg"); pg.textContent = "";
  for (const para of text.split("\n\n")) {
    let el, t = para;
    if (t.startsWith("@ ")) { el = document.createElement("h1"); el.className = "bt"; t = t.slice(2); }
    else if (t.startsWith("# ")) { el = document.createElement("h2"); el.className = "ch"; t = t.slice(2); }
    else if (t.startsWith("## ")) { el = document.createElement("h3"); el.className = "sc"; t = t.slice(3); }
    else el = document.createElement("p");
    el.textContent = t; pg.appendChild(el);
  }
}
async function rp() {
  const pg = $("pg"), myR = R, myI = R.i; R.locked = false; let d;
  try { d = R.off ? { text: R.pgs[R.i], total: R.pgs.length, preview: false } : await api(`/books/${R.id}/page/${R.i}`); }
  catch (e) { if (R !== myR) return; if (e.status === 403) { lockPanel(); return; } pg.textContent = e.message; return; }
  if (R !== myR || R.i !== myI) return;
  R.total = d.total; R.prev = d.preview; if (d.wm) { R.wm = d.wm; wmk(); }
  pg.dir = R.l === "ar" ? "rtl" : "ltr"; pg.lang = R.l === "ar" ? "ar" : "fr";
  renderPage(d.text); $("rd-body").scrollTop = 0;
  const p = RP(); p.last[R.id] = R.i; lss(rpKey(), p);
  paint();
}
function paint() {
  const T = R.total || 1, pct = Math.round((R.i + 1) / T * 100), m = R.words ? Math.max(1, Math.ceil(R.words * (1 - (R.i + 1) / T) / (R.l === "ar" ? 170 : 220))) : 0;
  $("rd-bar").style.width = pct + "%";
  $("rd-c").textContent = chapterAt(R.i) || (R.prev ? "Extrait" : "");
  $("rd-pos").textContent = R.prev && !R.own ? "Extrait · touchez pour le sommaire" : `Page ${R.i + 1} / ${T} · ${pct} %` + (m && R.i < T - 1 ? `\n≈ ${m} min restantes` : "");
  $("rd-bm").textContent = (RP().bk[R.id] || []).includes(R.i) ? "★" : "☆";
  $("pv").disabled = R.i === 0; $("nx").disabled = !R.prev && R.i >= T - 1;
}
function lockPanel() {
  const b = S.B.find(x => x.id === R.id); R.locked = true; closeSheet(); $("pg").dir = "ltr"; $("pg").textContent = "";
  const d = document.createElement("div"); d.className = "lock";
  d.innerHTML = `<h2>🔒 La suite du livre est réservée</h2><p class="mut">Achetez ce livre pour le lire en entier : tous les chapitres s'ouvrent.</p><button class="btn" data-b="${R.id}">Acheter pour ${fmt(b ? b.p : 0)}</button><p><button class="btn alt" data-g="0">Revenir à l'extrait</button></p>`;
  $("pg").appendChild(d); $("rd-pos").textContent = "Extrait"; $("nx").disabled = true; $("pv").disabled = false;
}
$("nx").onclick = () => { if (!R) return; if (R.prev && !R.own) { lockPanel(); return; } go(R.i + 1); };
$("pv").onclick = () => { if (!R) return; if (R.locked) { rp(); return; } go(R.i - 1); };
$("pg").addEventListener("click", e => { const g = e.target.closest("[data-g]"); if (g && R) go(+g.dataset.g); });
function closeReader() { stopSpeak(); closeSheet(); $("rd").classList.remove("on"); R = null; }
$("rd-x").onclick = closeReader;
$("rd-bm").onclick = () => {
  if (!R || R.locked) return; const p = RP(), a = p.bk[R.id] = p.bk[R.id] || [], i = a.indexOf(R.i);
  i < 0 ? a.push(R.i) : a.splice(i, 1); lss(rpKey(), p); paint(); toast(i < 0 ? "Page ajoutée aux signets" : "Signet retiré");
};
/* panneau : sommaire, recherche, signets, réglages */
const TABS = [["toc", "Sommaire"], ["find", "Chercher"], ["bk", "Signets"], ["set", "Réglages"]];
function openSheet(tab) { if (!R) return; $("rd-shade").hidden = false; $("rd-sheet").hidden = false; sheetTab(tab); }
function closeSheet() { $("rd-shade").hidden = true; $("rd-sheet").hidden = true; }
function sheetTab(tab) { ST = tab; $("rd-tabs").innerHTML = TABS.map(t => `<button data-st="${t[0]}" class="${t[0] === tab ? "on" : ""}">${t[1]}</button>`).join(""); ({ toc: sTOC, find: sFind, bk: sBk, set: sSet }[tab])($("rd-sb")); }
function sTOC(c) {
  const last = RP().last[R.id] || 0, T = R.toc || [], locked = !R.off && !R.own, ci = tocIdx(R.i), tot = R.total || 1;
  let h = `<div class="row"><input id="rd-gn" type="number" inputmode="numeric" min="1" max="${tot}" placeholder="N° de page (1 à ${tot})" aria-label="Numéro de page"><button class="btn sm" id="rd-gg" style="margin:0">Aller</button></div><button class="ti" data-g="0"><b>Début du livre</b><span>p. 1</span></button>`;
  if (last > 0 && last !== R.i) h += `<button class="ti" data-g="${last}"><b>Reprendre où j'étais</b><span>p. ${last + 1}</span></button>`;
  if (!T.length) h += '<p class="mut" style="margin-top:12px">Ce livre n\'a pas de chapitres repérés. Utilisez le numéro de page ou la recherche.</p>';
  h += T.map((x, n) => `<button class="ti l${x.l}${n === ci ? " cur" : ""}" data-g="${x.p}">${locked && x.p > 0 ? "🔒 " : ""}<em>${esc(x.t)}</em><span>p. ${x.p + 1}</span></button>`).join("");
  c.innerHTML = h;
}
function sFind(c) {
  c.innerHTML = '<div class="row"><input id="rd-q" placeholder="Mot ou phrase à chercher" maxlength="60" dir="auto" aria-label="Rechercher dans le livre"><button class="btn sm" id="rd-qg" style="margin:0">Chercher</button></div><div id="rd-qr"></div>';
  const run = async () => {
    const q = $("rd-q").value.trim(); if (q.length < 2) { toast("Écrivez au moins 2 lettres"); return; }
    $("rd-qr").innerHTML = '<p class="mut">Recherche…</p>'; let res = [], lim = false;
    try {
      if (R.off) { const nq = normq(q); R.pgs.forEach((pg, p) => { for (const para of pg.split("\n\n")) if (normq(para).includes(nq)) { res.push({ p, s: para.replace(/^(@|#{1,2}) /, "").slice(0, 130) }); break; } }); }
      else { const r = await api(`/books/${R.id}/search?q=${encodeURIComponent(q)}`); res = r.results; lim = r.limited; }
    } catch (e) { $("rd-qr").innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
    $("rd-qr").innerHTML = (res.length ? res.map(x => `<button class="ti" data-g="${x.p}"><em dir="auto">${esc(x.s)}</em><span>p. ${x.p + 1}</span></button>`).join("") : '<p class="mut">Aucun résultat.</p>') + (lim ? '<p class="note">Achetez le livre pour chercher dans tout le texte.</p>' : "");
  };
  $("rd-qg").onclick = run; $("rd-q").onkeydown = e => { if (e.key === "Enter") run(); };
}
function sBk(c) {
  const bk = (RP().bk[R.id] || []).slice().sort((a, b) => a - b);
  c.innerHTML = bk.length ? bk.map(p => `<div class="bkrow"><button class="ti" data-g="${p}"><em>${esc(chapterAt(p) || "Page " + (p + 1))}</em><span>p. ${p + 1}</span></button><button class="ib" data-bd="${p}" aria-label="Supprimer ce signet">🗑</button></div>`).join("") : '<p class="mut">Aucun signet. Touchez ☆ en haut de la page de lecture pour marquer une page.</p>';
}
function sSet(c) {
  const seg = (k, o) => `<div class="seg">${o.map(x => `<button data-s="${k}" data-sv="${x[0]}" class="${String(RS[k]) === String(x[0]) ? "on" : ""}">${x[1]}</button>`).join("")}</div>`;
  c.innerHTML = `<b>Taille du texte</b><div class="seg"><button data-sz="-1" aria-label="Réduire">A−</button><button disabled style="opacity:1">${RS.fs} px</button><button data-sz="1" aria-label="Agrandir">A+</button></div>
<b>Police</b>${seg("ff", [["serif", "Classique"], ["sans", "Moderne"]])}<b>Interligne</b>${seg("lh", [[1.5, "Serré"], [1.75, "Normal"], [2.05, "Aéré"]])}<b>Largeur du texte</b>${seg("w", [[560, "Étroite"], [680, "Normale"], [820, "Large"]])}<b>Thème</b>${seg("th", [["auto", "Auto"], ["light", "Clair"], ["sepia", "Sépia"], ["dark", "Nuit"]])}<b>Texte justifié</b>${seg("jus", [[false, "Non"], [true, "Oui"]])}
<b>Lecture à voix haute</b><div class="seg"><button data-sp="go">▶ Écouter la page</button><button data-sp="stop">⏹ Arrêter</button></div><b>Vitesse de la voix</b>${seg("rate", [[0.8, "Lente"], [1, "Normale"], [1.25, "Rapide"]])}<b>Tourner la page toute seule</b>${seg("auto", [[false, "Non"], [true, "Oui"]])}<p class="mut">Vos réglages sont gardés sur cet appareil.</p>`;
}
$("rd-sheet").addEventListener("click", e => {
  const t = e.target.closest("button"); if (!t) return; const d = t.dataset;
  if (d.st) sheetTab(d.st);
  else if (d.g !== undefined) { closeSheet(); go(+d.g); }
  else if (d.sz) { RS.fs = Math.max(14, Math.min(32, RS.fs + 2 * +d.sz)); saveRS(); applyPrefs(); sSet($("rd-sb")); }
  else if (d.s) { RS[d.s] = ["lh", "w", "rate"].includes(d.s) ? +d.sv : ["jus", "auto"].includes(d.s) ? d.sv === "true" : d.sv; saveRS(); applyPrefs(); sSet($("rd-sb")); }
  else if (d.sp === "go") speak(); else if (d.sp === "stop") stopSpeak();
  else if (d.bd !== undefined) { const p = RP(); p.bk[R.id] = (p.bk[R.id] || []).filter(x => x !== +d.bd); lss(rpKey(), p); sBk($("rd-sb")); paint(); }
  else if (t.id === "rd-gg") { const n = +$("rd-gn").value; if (n >= 1 && n <= (R.total || 1)) { closeSheet(); go(n - 1); } else toast("Entrez une page entre 1 et " + (R.total || 1)); }
});
$("rd-sheet").addEventListener("keydown", e => { if (e.key === "Enter" && e.target.id === "rd-gn") $("rd-gg").click(); });
$("rd-toc").onclick = () => openSheet("toc"); $("rd-set").onclick = () => openSheet("set"); $("rd-pos").onclick = () => openSheet("toc");
$("rd-sx").onclick = closeSheet; $("rd-shade").onclick = closeSheet;
/* lecture à voix haute */
function stopSpeak() { spk = false; try { speechSynthesis.cancel(); } catch { } }
function speak() {
  if (!("speechSynthesis" in window)) { toast("La lecture à voix haute n'est pas disponible sur cet appareil."); return; }
  if (!R || R.locked) return; stopSpeak(); const text = $("pg").innerText.trim(); if (!text) return;
  const ar = R.l === "ar", voices = speechSynthesis.getVoices();
  if (voices.length && !voices.some(v => v.lang.toLowerCase().startsWith(ar ? "ar" : "fr"))) toast(ar ? "Aucune voix arabe trouvée sur cet appareil." : "Aucune voix française trouvée sur cet appareil.");
  const u = new SpeechSynthesisUtterance(text); u.lang = ar ? "ar-SA" : "fr-FR"; u.rate = RS.rate; spk = true;
  u.onend = () => { if (spk && R && RS.auto && !R.prev && R.i < R.total - 1) { R.i++; rp().then(() => { if (spk) speak(); }); } else spk = false; };
  u.onerror = () => { spk = false; }; closeSheet(); speechSynthesis.speak(u);
}
/* clavier, balayage et protections */
document.addEventListener("keydown", e => {
  if (!$("rd").classList.contains("on") || !R) return;
  if ((e.ctrlKey || e.metaKey) && "cspa".includes(e.key.toLowerCase())) { e.preventDefault(); return; }
  if (e.target.matches && e.target.matches("input,textarea,select")) { if (e.key === "Escape") closeSheet(); return; }
  const rtl = R.l === "ar";
  if (e.key === "Escape") { $("rd-sheet").hidden ? closeReader() : closeSheet(); }
  else if (e.key === "ArrowRight") (rtl ? $("pv") : $("nx")).click(); else if (e.key === "ArrowLeft") (rtl ? $("nx") : $("pv")).click();
  else if (e.key === "t" || e.key === "T") openSheet("toc");
});
let tx0 = 0, ty0 = 0;
$("rd-body").addEventListener("touchstart", e => { tx0 = e.touches[0].clientX; ty0 = e.touches[0].clientY; }, { passive: true });
$("rd-body").addEventListener("touchend", e => { if (!R || !$("rd-sheet").hidden) return; const t = e.changedTouches[0], dx = t.clientX - tx0, dy = t.clientY - ty0; if (Math.abs(dx) > 70 && Math.abs(dy) < 45) (R.l === "ar" ? dx > 0 : dx < 0) ? $("nx").click() : $("pv").click(); }, { passive: true });
["contextmenu", "copy", "cut", "dragstart", "selectstart"].forEach(t => $("rd").addEventListener(t, e => { if (!(e.target.matches && e.target.matches("input,textarea"))) e.preventDefault(); }));
document.addEventListener("visibilitychange", () => $("pg").classList.toggle("hid", document.hidden));
window.addEventListener("blur", () => $("pg").classList.add("hid")); window.addEventListener("focus", () => $("pg").classList.remove("hid"));

/* ---------- Lecture hors ligne (copie valable 30 jours sur l'appareil) ---------- */
const OFF = {};
function idb() { return new Promise((ok, ko) => { try { const r = indexedDB.open("ciba-off", 1); r.onupgradeneeded = () => r.result.createObjectStore("b", { keyPath: "id" }); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); } catch (e) { ko(e); } }); }
const idbx = (m, f) => idb().then(d => new Promise((ok, ko) => { const t = d.transaction("b", m), q = f(t.objectStore("b")); t.oncomplete = () => ok(q && q.result); t.onerror = () => ko(t.error); }));
async function offLoad() { try { const L = await idbx("readonly", o => o.getAll()), n = Date.now(); for (const k in OFF) delete OFF[k]; (L || []).forEach(r => { if (r.exp > n) OFF[r.id] = r; else idbx("readwrite", o => o.delete(r.id)).catch(() => { }); }); } catch { } }
async function offSave(id) {
  if (!S.u) { toast("Connectez-vous pour enregistrer ce livre"); view("acc"); return; }
  const r = await act(() => api(`/books/${id}/offline`)); if (!r) return;
  try { await idbx("readwrite", o => o.put(r)); await offLoad(); toast("Livre enregistré : lisible hors ligne pendant 30 jours"); libv(); } catch { toast("Enregistrement impossible sur cet appareil"); }
}
async function offList() {
  const c = $("offl"); if (!c) return; await offLoad(); const L = Object.values(OFF).filter(r => !S.u || r.em === S.u.email);
  c.innerHTML = L.length ? `<h2>Lisibles hors ligne sur cet appareil</h2><div class="grid">${L.map(r => `<div class="bk"><div class="cv" style="background:${col(r.id)}"><i>${esc(r.k)}</i>${esc(r.t)}</div><div class="bi"><span class="tag g">Hors ligne</span><span class="mut">Valable jusqu'au ${dfr(r.exp)}</span><button class="btn" data-oo="${r.id}">Lire</button><button class="btn alt" data-od="${r.id}">Retirer de l'appareil</button></div></div>`).join("")}</div>` : "";
}
function openOff(id) {
  const r = OFF[id]; if (!r || r.exp <= Date.now()) { toast("Licence expirée : reconnectez-vous pour renouveler"); offDel(id); return; }
  R = { id, t: r.t, l: r.l, i: RP().last[id] || 0, total: r.pg.length, toc: r.toc || [], words: r.words || 0, wm: r.em, off: true, pgs: r.pg, prev: false, locked: false, own: true };
  if (R.i >= r.pg.length) R.i = 0; stopSpeak(); closeSheet(); $("rd-t").textContent = r.t; wmk(); applyPrefs(); $("rd").classList.add("on"); rp();
}
function offDel(id) { idbx("readwrite", o => o.delete(id)).then(offLoad).then(() => { if (cur === "lib") libv(); }).catch(() => { }); }

/* ---------- Bibliothèque ---------- */
async function libv() {
  const c = $("libl"); let pend = [];
  if (S.u && !S.off) { const r = await act(() => api("/payments/mine")); if (r) pend = r.payments.filter(p => p.status === "En attente"); }
  const p = RP(), L = S.B.filter(b => b.own && !b.inc && b.f !== "phys");
  c.innerHTML = `<div id="offl"></div>${S.u ? "" : '<p class="note">Connectez-vous pour retrouver vos livres achetés.</p>'}${pend.length ? `<p class="note">⏳ En attente de validation : ${pend.map(x => esc(x.title)).join(", ")}</p>` : ""}<div class="grid">${L.map(b => `<div class="bk">${cover(b)}<div class="bi"><b dir="auto">${esc(b.t)}</b>${lbl(b)}${(p.bk[b.id] || []).length ? `<span class="mut">Marque-pages : p.${p.bk[b.id].map(x => x + 1).join(", ")}</span>` : ""}<button class="btn" data-r="${b.id}">${p.last[b.id] ? "Reprendre (p." + (p.last[b.id] + 1) + ")" : "Lire"}</button>${S.u ? `<button class="btn alt" data-o="${b.id}">${OFF[b.id] ? "Hors ligne ✔ (renouveler)" : "Lire hors ligne"}</button>` : ""}</div></div>`).join("")}</div>`;
  offList();
}

/* ---------- Panier et commande ---------- */
let promo = { code: "", pct: 0 };
function cartv() {
  const c = $("cartl"), it = Object.keys(cart).map(k => S.B.find(b => b.id == k && b.f === "phys")).filter(Boolean).filter(b => cart[b.id] > 0);
  if (!it.length) { c.innerHTML = '<p class="mut">Votre panier est vide. Ajoutez un livre physique depuis le catalogue.</p>'; return; }
  const sub = it.reduce((s, b) => s + b.p * cart[b.id], 0);
  c.innerHTML = `<div class="card">${it.map(b => `<div class="line"><span>${esc(b.t)}<br><span class="mut">${fmt(b.p)}</span></span><span><button class="btn alt sm" data-q="${b.id}:-1">−</button> ${cart[b.id]} <button class="btn alt sm" data-q="${b.id}:1">+</button></span></div>`).join("")}</div>
<h2>Livraison</h2><div class="card"><label for="nm">Nom complet</label><input id="nm" autocomplete="name" maxlength="80"><label for="tl">Téléphone</label><input id="tl" type="tel" autocomplete="tel" maxlength="30"><label for="vl">Ville ou zone</label><select id="vl">${S.cfg.zones.map(z => `<option value="${z.id}">${esc(z.name)} (${fmt(z.fee)})</option>`).join("")}</select><label for="ad">Adresse et repère</label><input id="ad" autocomplete="street-address" maxlength="200">
<label for="pc">Code promo</label><input id="pc" placeholder="CIBA10" maxlength="30" value="${esc(promo.code)}"><p class="line"><span>Sous-total</span><b>${fmt(sub)}</b></p><p class="line"><span>Livraison</span><b id="lv"></b></p><p class="line"><span>Total</span><b id="tt"></b></p>
<button class="btn" style="width:100%;margin-top:10px" id="ord">Confirmer la commande</button><p class="mut">Paiement à la livraison ou par Mobile Money, selon votre choix lors de l'appel de confirmation.</p></div>`;
  const up = () => { const z = S.cfg.zones.find(x => x.id == $("vl").value) || { fee: 0 }, d = Math.round(sub * promo.pct / 100); $("lv").textContent = fmt(z.fee) + (d ? " · remise −" + fmt(d) : ""); $("tt").textContent = fmt(sub - d + z.fee); };
  up(); $("vl").onchange = up;
  $("pc").onchange = async () => { const v = $("pc").value.trim(); if (!v) { promo = { code: "", pct: 0 }; up(); return; } try { const r = await api("/promo/check", { method: "POST", body: { code: v } }); promo = { code: r.code, pct: r.percent }; toast("Code appliqué : −" + r.percent + " %"); } catch (e) { promo = { code: "", pct: 0 }; toast(e.message); } up(); };
  $("ord").onclick = async () => {
    const body = { items: it.map(b => ({ id: b.id, q: cart[b.id] })), name: $("nm").value, phone: $("tl").value, address: $("ad").value, zoneId: +$("vl").value, promo: promo.code };
    if (!body.name.trim() || body.phone.replace(/\D/g, "").length < 9 || !body.address.trim()) { toast("Complétez nom, téléphone et adresse"); return; }
    const r = await act(() => api("/orders", { method: "POST", body })); if (!r) return;
    cart = {}; saveCart(); promo = { code: "", pct: 0 }; await refreshBooks();
    c.innerHTML = `<div class="card"><h2>Commande enregistrée ✔</h2><p>Référence : <b>${esc(r.ref)}</b></p><p>Total à payer : <b>${fmt(r.total)}</b></p><p class="mut">Nous vous appelons pour confirmer la livraison.</p><button class="btn" data-v2="cat">Retour au catalogue</button></div>`;
  };
}
$("cartl").onclick = e => { const q = e.target.dataset.q; if (!q) return; const [k, d] = q.split(":"), b = S.B.find(x => x.id == k); cart[k] = Math.max(0, Math.min((cart[k] || 0) + +d, b ? b.s : 0)); if (!cart[k]) delete cart[k]; saveCart(); cartv(); };

/* ---------- Compte ---------- */
async function afterAuth(r) { S.u = r.user; await refreshBooks(); toast("Bienvenue " + r.user.name); view(r.user.role === "admin" ? "adm" : "acc"); }
async function accv() {
  const a = $("acc");
  if (!S.u) {
    a.innerHTML = `<h1>Connexion</h1><div class="card"><label for="ae">E-mail</label><input id="ae" type="email" autocomplete="email"><label for="an">Nom (pour créer un compte)</label><input id="an" autocomplete="name" maxlength="60"><label for="ap">Mot de passe (8 caractères minimum)</label><input id="ap" type="password" autocomplete="current-password"><div id="acw" style="display:none"><label for="ac">Code de vérification (administrateur)</label><input id="ac" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div><p class="err" id="aer"></p><button class="btn" id="al">Se connecter</button> <button class="btn alt" id="as">Créer un compte</button></div><p class="mut">Vos données servent uniquement à gérer votre compte et vos achats.</p>`;
    $("al").onclick = async () => { $("aer").textContent = ""; try { afterAuth(await api("/login", { method: "POST", body: { email: $("ae").value, password: $("ap").value, code: $("ac").value } })); } catch (e) { if (e.data && e.data.needCode) $("acw").style.display = "block"; $("aer").textContent = e.message; } };
    $("as").onclick = async () => { $("aer").textContent = ""; try { afterAuth(await api("/signup", { method: "POST", body: { email: $("ae").value, name: $("an").value, password: $("ap").value } })); } catch (e) { $("aer").textContent = e.message; } };
    return;
  }
  const [o, p] = await Promise.all([act(() => api("/orders/mine")), act(() => api("/payments/mine"))]);
  const od = o ? o.orders : [], pm = p ? p.payments : [];
  a.innerHTML = `<h1>Bonjour ${esc(S.u.name)}</h1><p class="mut">${esc(S.u.email)}</p><button class="btn alt sm" id="lo">Se déconnecter</button>
<h2>Mes paiements de livres numériques</h2>${pm.length ? `<div class="card wrap"><table><tr><th>Livre</th><th>Montant</th><th>Statut</th></tr>${pm.map(x => `<tr><td>${esc(x.title)}</td><td>${fmt(x.amount)}</td><td>${esc(x.status)}</td></tr>`).join("")}</table></div>` : '<p class="mut">Aucun paiement.</p>'}
<h2>Mes commandes de livres physiques</h2>${od.length ? `<div class="card wrap"><table><tr><th>Réf.</th><th>Articles</th><th>Total</th><th>Statut</th></tr>${od.map(x => `<tr><td>${esc(x.ref)}</td><td>${x.items.map(i => esc(i.title) + " ×" + i.q).join(", ")}</td><td>${fmt(x.total)}</td><td>${esc(x.status)}${x.driver ? "<br>Livreur : " + esc(x.driver) : ""}${x.tracking ? "<br>Suivi : " + esc(x.tracking) : ""}</td></tr>`).join("")}</table></div>` : '<p class="mut">Aucune commande.</p>'}
${S.u.role === "admin" ? "" : '<h2>Mes données</h2><button class="btn alt sm" id="cpw">Changer mon mot de passe</button> <button class="btn alt sm" id="del">Supprimer mon compte</button>'}`;
  $("lo").onclick = async () => { await act(() => api("/logout", { method: "POST", body: {} })); S.u = null; await refreshBooks(); toast("Vous êtes déconnecté"); view("cat"); };
  if ($("cpw")) $("cpw").onclick = async () => { const o = prompt("Mot de passe actuel :"); if (!o) return; const n = prompt("Nouveau mot de passe (8 caractères minimum) :"); if (!n) return; if (await act(() => api("/me/password", { method: "POST", body: { old: o, password: n } }))) toast("Mot de passe modifié"); };
  if ($("del")) $("del").onclick = async () => {
    const pw = prompt("Pour supprimer définitivement votre compte, entrez votre mot de passe :"); if (!pw) return;
    if (await act(() => api("/me/delete", { method: "POST", body: { password: pw } }))) { S.u = null; await refreshBooks(); toast("Compte supprimé"); view("cat"); }
  };
}

/* ---------- Lecture d'un fichier Word / texte (côté navigateur) ---------- */
async function docxText(buf){const v=new DataView(buf),u=new Uint8Array(buf),td=new TextDecoder();let e=u.length-22;while(e>=0&&v.getUint32(e,true)!==0x06054b50)e--;if(e<0)throw 0;
 const n=v.getUint16(e+10,true);let p=v.getUint32(e+16,true);
 for(let i=0;i<n;i++){const m=v.getUint16(p+10,true),cs=v.getUint32(p+20,true),nl=v.getUint16(p+28,true),xl=v.getUint16(p+30,true),cl=v.getUint16(p+32,true),lo=v.getUint32(p+42,true),nm=td.decode(u.subarray(p+46,p+46+nl));
  if(nm==="word/document.xml"){const st=lo+30+v.getUint16(lo+26,true)+v.getUint16(lo+28,true),d=u.subarray(st,st+cs);
   const xml=m===0?td.decode(d):await new Response(new Blob([d]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text();
   const ent=s=>s.replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,"&");
   return (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g)||[]).map(q=>{
    const sm=/<w:pStyle w:val="([^"]*)"/.exec(q),ol=/<w:outlineLvl w:val="(\d)"/.exec(q);let lv=0;
    if(ol)lv=+ol[1]+1;else if(sm){const h=/^(?:heading|titre|title|titel|überschrift|rubrik)\s*(\d)$/i.exec(sm[1]);if(h)lv=+h[1]}
    q=q.replace(/<w:tab\/>/g,"<w:t> </w:t>").replace(/<w:br[^>]*\/>/g,"<w:t>\n</w:t>");let t="";for(const r of q.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g))t+=r[1];
    t=ent(t).replace(/\s*\n\s*/g," ").trim();return t&&lv>=1&&lv<=2?(lv===1?"# ":"## ")+t:t}).filter(Boolean).join("\n")}
  p+=46+nl+xl+cl}
 throw 0}
async function readText(f, prog) {
  if (/\.docx$/i.test(f.name)) { try { return await docxText(await f.arrayBuffer()); } catch { throw new Error("Lecture impossible : fichier protégé ou sans texte."); } }
  if (/\.pdf$/i.test(f.name)) return pdfToText(f, prog || (() => { }));
  if (/\.(doc|epub)$/i.test(f.name)) throw new Error("Les fichiers .doc et EPUB ne sont pas acceptés : enregistrez-les en .docx ou en PDF.");
  if (f.size > 3e6) throw new Error("Fichier trop lourd (3 Mo maximum).");
  return f.text();
}
const textInfo = t => { const w = t.split(/\s+/).filter(Boolean).length, ch = (t.match(/^# /gm) || []).length; return `${w.toLocaleString("fr-FR")} mots, ` + (ch ? ch + " chapitre(s) repéré(s) dans le fichier" : "aucun titre de chapitre repéré (le site cherchera « Chapitre 1 », « الفصل الأول »…)"); };
/* ---------- Lecture d'un PDF dans le navigateur (texte, titres et plan des chapitres) ---------- */
const RTLC = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/g, LATC = /[A-Za-z\u00c0-\u024f]/g;
function pdfLines(items) {
  const G = []; let cur = null;
  for (const it of items) {
    if (typeof it.str !== "string") continue;
    const x = it.transform[4], y = it.transform[5], h = it.height || Math.abs(it.transform[3]) || 10, w = it.width || 0;
    if (!cur && !it.str.trim()) continue;
    if (!cur || Math.abs(y - cur.y) > Math.max(2, Math.min(cur.h, h) * 0.45)) { cur = { its: [], y, h, x0: x, x1: x + w }; G.push(cur); }
    cur.its.push({ s: it.str, x, w }); cur.h = Math.max(cur.h, h); cur.x0 = Math.min(cur.x0, x); cur.x1 = Math.max(cur.x1, x + w);
  }
  return G.map(l => {
    const raw = l.its.map(i => i.s).join("").normalize("NFKC"), ar = (raw.match(RTLC) || []).length > (raw.match(LATC) || []).length;
    const its = ar ? l.its.slice().sort((a, b) => b.x - a.x) : l.its; let s = "", prev = null;   // lignes arabes : lecture de droite à gauche
    for (const it of its) {
      if (prev) { const gap = ar ? prev.x - (it.x + it.w) : it.x - (prev.x + prev.w); if (gap > l.h * 0.18 && !/\s$/.test(s) && !/^\s/.test(it.s)) s += " "; }
      s += it.s; prev = it;
    }
    return { s: s.normalize("NFKC").replace(/\s+/g, " ").trim(), y: l.y, h: l.h, x0: l.x0, x1: l.x1 };
  }).filter(l => l.s);
}
async function pdfToText(f, prog) {
  if (f.size > 40e6) throw new Error("PDF trop lourd (40 Mo maximum).");
  let lib; try { lib = await import("/pdf.min.mjs"); } catch { throw new Error("Le lecteur de PDF n'est pas disponible sur ce site (fichiers pdf.min.mjs et pdf.worker.min.mjs manquants)."); }
  lib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  let doc; try { doc = await lib.getDocument({ data: new Uint8Array(await f.arrayBuffer()), isEvalSupported: false, disableFontFace: true, useWorkerFetch: false, verbosity: 0 }).promise; }
  catch (e) { throw new Error(e && e.name === "PasswordException" ? "Ce PDF est protégé par un mot de passe." : "Lecture impossible : fichier PDF abîmé ou non reconnu."); }
  const N = doc.numPages; if (N > 1500) throw new Error("PDF trop long (1500 pages maximum).");
  const marks = {}; let nm = 0;
  try {
    const walk = async (items, lvl) => { for (const it of items || []) { let d = it.dest; if (typeof d === "string") d = await doc.getDestination(d); if (Array.isArray(d) && d[0] != null) { const pi = typeof d[0] === "object" ? await doc.getPageIndex(d[0]) : d[0]; (marks[pi] = marks[pi] || []).push({ t: String(it.title || "").replace(/\s+/g, " ").trim(), l: lvl }); nm++; } if (lvl < 2) await walk(it.items, lvl + 1); } };
    await walk(await doc.getOutline(), 1);
  } catch { }
  const pages = [];
  for (let p = 1; p <= N; p++) { prog("Lecture du PDF : page " + p + " sur " + N + "…"); const page = await doc.getPage(p); pages.push(pdfLines((await page.getTextContent()).items)); page.cleanup(); }
  // taille du texte courant, puis retrait des en-têtes, pieds de page et numéros de page
  const sz = {}; pages.flat().forEach(l => { const k = Math.round(l.h); sz[k] = (sz[k] || 0) + l.s.length; });
  const body = +(Object.entries(sz).sort((a, b) => b[1] - a[1])[0] || [10])[0];
  const top = {}, bot = {}, key = s => s.replace(/\d+/g, "#"), ext = pg => pg.length ? [pg.reduce((a, b) => b.y > a.y ? b : a), pg.reduce((a, b) => b.y < a.y ? b : a)] : [];
  pages.forEach(pg => { const [t, b] = ext(pg); if (t) top[key(t.s)] = (top[key(t.s)] || 0) + 1; if (b) bot[key(b.s)] = (bot[key(b.s)] || 0) + 1; });
  const rep = Math.max(3, N * 0.5), isNum = s => s.length <= 8 && /^[\divxlc\s\-–—.·]+$/i.test(s);
  const clean = pages.map(pg => { const [t, b] = ext(pg); return pg.filter(l => !((l === t && (top[key(l.s)] >= rep || isNum(l.s))) || (l === b && (bot[key(l.s)] >= rep || isNum(l.s))))); });
  const blocks = []; const END = /[.!?؟:…»"”)]$/;
  clean.forEach((pg, pi) => {
    const ys = []; for (let i = 1; i < pg.length; i++) { const d = pg[i - 1].y - pg[i].y; if (d > 0) ys.push(d); } ys.sort((a, b) => a - b);
    const ms = ys.length ? ys[Math.floor(ys.length / 2)] : 14, maxW = Math.max(1, ...pg.map(l => l.x1 - l.x0)); let first = true;
    const texts = pg.map(l => l.s), fixed = (marks[pi] || []).map(m => {   // titre du plan enregistré à l'envers par certains logiciels : on garde la version qui figure dans la page
      let t = m.t.normalize("NFKC"); if ((t.match(RTLC) || []).length && !texts.some(x => x.includes(t))) { const r = t.split(" ").reverse().join(" "); if (texts.some(x => x.includes(r))) t = r; }
      return { t, l: m.l };
    });
    for (const m of fixed) blocks.push({ t: m.t, h: m.l, ps: first }), first = false;
    const skip = new Set(fixed.map(m => m.t.toLowerCase()));
    for (let i = 0; i < pg.length; i++) {
      const l = pg[i], prev = pg[i - 1], last = blocks[blocks.length - 1];
      if (skip.has(l.s.toLowerCase())) continue;
      const hl = nm || !(l.h >= body * 1.25 && l.s.length <= 100) ? 0 : (l.h >= body * 1.6 ? 1 : 2);
      const brk = !prev || (prev.y - l.y) > ms * 1.45 || ((prev.x1 - prev.x0) < maxW * 0.72 && END.test(prev.s));
      if (last && last.pg === pi && hl === last.h && !brk) { last.t = last.t.endsWith("-") && /^\p{Ll}/u.test(l.s) ? last.t.slice(0, -1) + l.s : last.t + " " + l.s; continue; }
      blocks.push({ t: l.s, h: hl, ps: first, pg: pi }); first = false;
    }
  });
  // paragraphe coupé par un changement de page
  const out = [];
  for (const b of blocks) { const q = out[out.length - 1]; if (q && b.ps && b.h === 0 && q.h === 0 && !END.test(q.t)) q.t += " " + b.t; else out.push({ ...b }); }
  const text = out.map(b => (b.h === 1 ? "# " : b.h === 2 ? "## " : "") + b.t.replace(/^#+\s*/, "")).join("\n");
  if (text.replace(/\s/g, "").length < Math.min(200, N * 20)) throw new Error("Aucun texte trouvé dans ce PDF : c'est probablement un PDF scanné (des images). Utilisez un PDF avec du texte, ou un fichier Word.");
  return text;
}
async function coverData(f) {
  if (f.size > 4 * 1024 * 1024) throw new Error("Image trop lourde (4 Mo maximum).");
  try {
    const bmp = await createImageBitmap(f), sc = Math.min(1, 1000 / Math.max(bmp.width, bmp.height));
    if (sc === 1 && f.size < 350000 && /^image\/(jpeg|png|webp)$/.test(f.type)) return await dataUrl(f);
    const cv = document.createElement("canvas"); cv.width = Math.max(1, Math.round(bmp.width * sc)); cv.height = Math.max(1, Math.round(bmp.height * sc));
    const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(bmp, 0, 0, cv.width, cv.height);
    return cv.toDataURL("image/jpeg", 0.86);
  } catch { if (/^image\/(jpeg|png|webp|gif)$/.test(f.type)) return await dataUrl(f); throw new Error("Image non reconnue (utilisez JPEG, PNG ou WebP)."); }
}

const dataUrl = f => new Promise((ok, ko) => { const x = new FileReader(); x.onload = () => ok(x.result); x.onerror = () => ko(new Error("Lecture de l'image impossible")); x.readAsDataURL(f); });

/* ---------- Administration ---------- */
let AT = "dash", EB = null;
const TT = [["dash", "Tableau de bord"], ["add", "Ajouter un livre"], ["edit", "Modifier un livre"], ["rem", "Retirer un livre"], ["pay", "Paiements"], ["ord", "Commandes"], ["liv", "Livraison"], ["stat", "Ventes et export"], ["promo", "Codes promo"], ["cli", "Clients"], ["log", "Journal"]];
const TY = { free: "Gratuit", paid: "Numérique payant", phys: "Physique" };
async function admv() {
  const a = $("adm");
  if (!S.u || S.u.role !== "admin") { a.innerHTML = '<div class="note">Réservé à l\'administrateur. Connectez-vous depuis l\'onglet Connexion.</div>'; return; }
  a.innerHTML = `<h1>Espace administrateur</h1><div class="chips" id="at">${TT.map(t => `<button class="chip${t[0] === AT ? " on" : ""}" data-at="${t[0]}">${t[1]}</button>`).join("")}</div><div id="adc"></div>`;
  $("at").onclick = e => { if (e.target.dataset.at) { AT = e.target.dataset.at; admv(); } };
  const c = $("adc"); try { await ATAB[AT](c); } catch (e) { c.innerHTML = '<p class="err">' + esc(e.message) + "</p>"; }
}
const ATAB = {};
ATAB.dash = async c => {
  const s = await api("/admin/summary");
  c.innerHTML = `${s.warn.map(w => `<p class="note" style="margin-bottom:8px">${esc(w)}</p>`).join("")}${s.pending ? `<p class="note" style="margin-bottom:8px">⏳ ${s.pending} paiement(s) à valider dans l'onglet Paiements.</p>` : ""}<div class="grid"><div class="card"><b>${s.books}</b><p class="mut">livres au catalogue (${s.hidden} retirés)</p></div><div class="card"><b>${s.free} · ${s.paid} · ${s.phys}</b><p class="mut">gratuits · numériques payants · physiques</p></div><div class="card"><b>${s.orders}</b><p class="mut">commandes physiques</p></div><div class="card"><b>${fmt(s.revenue)}</b><p class="mut">ventes confirmées</p></div><div class="card"><b>${s.users}</b><p class="mut">comptes clients</p></div></div>
<h2>Sauvegarde</h2><p class="mut">Téléchargez régulièrement une copie complète de vos données.</p><a class="btn alt" href="/api/admin/backup" download>Télécharger une sauvegarde</a>`;
};
ATAB.add = async c => {
  c.innerHTML = `<div class="card"><div class="row2"><div><label for="ft">Titre</label><input id="ft" maxlength="150" dir="auto"></div><div><label for="fa">Auteur</label><input id="fa" maxlength="100" dir="auto"></div></div>
<div class="row2"><div><label for="fl">Langue du livre</label><select id="fl"><option value="fr">Français</option><option value="ar">Arabe (عربي)</option></select></div><div><label for="fk">Catégorie ou domaine</label><select id="fk">${catOpts()}</select></div></div><div class="row2"><div><label for="ff">Type</label><select id="ff"><option value="free">Gratuit en ligne</option><option value="paid">Numérique payant</option><option value="phys">Livre physique</option></select></div></div>
<div class="row2"><div><label for="fp">Prix (FCFA)</label><input id="fp" type="number" min="0"></div><div id="fsw"><label for="fs">Stock (livre physique)</label><input id="fs" type="number" min="0" value="20"></div></div>
<label for="fm">Résumé</label><textarea id="fm" rows="3" maxlength="2000" dir="auto"></textarea><label for="fo">À propos de l'auteur</label><textarea id="fo" rows="2" maxlength="1000" dir="auto"></textarea>
<div id="ftw"><label for="fw">Livre numérique : fichier Word (.docx), PDF (.pdf) ou texte (.txt, .md)</label><input id="fw" type="file"><p id="fi" class="mut" aria-live="polite"></p><label for="fx">… ou collez le texte du livre</label><textarea id="fx" rows="5" dir="auto"></textarea></div>
<label for="fj">Couverture (image jusqu'à 4 Mo, facultatif)</label><input id="fj" type="file" accept="image/*"><button class="btn" style="margin-top:10px" id="fg">Ajouter au catalogue</button></div>`;
  let TX = ""; const sync = () => { const f = $("ff").value; $("fsw").style.display = f === "phys" ? "block" : "none"; $("ftw").style.display = f === "phys" ? "none" : "block"; $("fp").disabled = f === "free"; if (f === "free") $("fp").value = ""; };
  $("ff").onchange = sync; sync(); $("fl").onchange = () => { $("fk").innerHTML = catOpts(undefined, $("fl").value); };
  $("fw").onchange = async e => { const f = e.target.files[0]; if (!f) return; $("fi").textContent = "Lecture…"; try { TX = await readText(f, m => { $("fi").textContent = m; }); $("fi").textContent = "✔ " + f.name + " lu : " + textInfo(TX) + "."; if (!$("ft").value) $("ft").value = f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "); } catch (er) { TX = ""; $("fi").textContent = er.message; } };
  $("fg").onclick = async () => {
    const f = $("ff").value, file = $("fj").files[0], body = { lang: $("fl").value, title: $("ft").value, author: $("fa").value, cat: $("fk").value, kind: f, price: +$("fp").value || 0, stock: +$("fs").value || 0, summary: $("fm").value, bio: $("fo").value };
    if (f !== "phys") body.text = TX || $("fx").value.trim();
    if (file) { body.cover = await act(() => coverData(file)); if (!body.cover) return; }
    const r = await act(() => api("/admin/books", { method: "POST", body })); if (!r) return; toast("Livre ajouté" + (r.pages ? " : " + r.pages + " pages, " + r.chapters + " chapitre(s)" : "") + "."); await refreshBooks(); admv();
  };
};
ATAB.edit = async c => {
  const L = (await api("/admin/books")).books; if (!L.length) { c.innerHTML = '<p class="mut">Aucun livre.</p>'; return; }
  if (!EB || !L.find(b => b.id === EB)) EB = L[0].id; const b = L.find(x => x.id === EB), pk = !!b.inc;
  c.innerHTML = `<label for="eb">Livre à modifier</label><select id="eb">${L.map(x => `<option value="${x.id}"${x.id === EB ? " selected" : ""}>${esc(x.t)}${x.h ? " (retiré)" : ""}</option>`).join("")}</select>
<div class="card"><div class="row2"><div><label for="et">Titre</label><input id="et" value="${esc(b.t)}" maxlength="150" dir="auto"></div><div><label for="ea">Auteur</label><input id="ea" value="${esc(b.a)}" maxlength="100" dir="auto"></div></div>
${pk ? "" : `<div class="row2"><div><label for="elg">Langue du livre</label><select id="elg"><option value="fr"${b.l !== "ar" ? " selected" : ""}>Français</option><option value="ar"${b.l === "ar" ? " selected" : ""}>Arabe (عربي)</option></select></div><div><label for="ek">Catégorie ou domaine</label><select id="ek">${catOpts(b.k, b.l)}</select></div></div><div class="row2"><div><label for="ef">Type</label><select id="ef">${Object.keys(TY).map(k => `<option value="${k}"${k === b.f ? " selected" : ""}>${TY[k]}</option>`).join("")}</select></div></div>`}
<div class="row2"><div><label for="ep">Prix (FCFA)</label><input id="ep" type="number" min="0" value="${b.p || 0}"></div>${pk ? "" : `<div><label for="es">Stock (livre physique)</label><input id="es" type="number" min="0" value="${b.s == null ? 0 : b.s}"></div>`}</div>
<label for="em">Résumé</label><textarea id="em" rows="4" maxlength="2000" dir="auto">${esc(b.sm)}</textarea><label for="eo">À propos de l'auteur</label><textarea id="eo" rows="3" maxlength="1000" dir="auto">${esc(b.bio)}</textarea>
${pk ? "" : `<p class="mut">Texte actuel : ${b.np ? b.np + " pages, " + (b.ch ? b.ch + " entrée(s) au sommaire" : "pas de sommaire") : "aucun"}. Pour le remplacer (Word, PDF ou texte) :</p><input id="ew" type="file"><p id="ei" class="mut" aria-live="polite"></p><label for="ex">… ou collez le nouveau texte</label><textarea id="ex" rows="4"></textarea><label for="ej">Nouvelle couverture (image jusqu'à 4 Mo, facultatif)</label><input id="ej" type="file" accept="image/*">`}
<button class="btn" style="margin-top:10px" id="eg">Enregistrer les modifications</button></div>`;
  $("eb").onchange = e => { EB = +e.target.value; admv(); }; if ($("elg")) $("elg").onchange = () => { $("ek").innerHTML = catOpts(undefined, $("elg").value); };
  let TX = ""; if ($("ew")) $("ew").onchange = async e => { const f = e.target.files[0]; if (!f) return; $("ei").textContent = "Lecture…"; try { TX = await readText(f, m => { $("ei").textContent = m; }); $("ei").textContent = "✔ " + f.name + " lu : " + textInfo(TX) + "."; } catch (er) { TX = ""; $("ei").textContent = er.message; } };
  $("eg").onclick = async () => {
    const body = { title: $("et").value, author: $("ea").value, summary: $("em").value, bio: $("eo").value, price: +$("ep").value || 0 };
    if (!pk) { body.cat = $("ek").value; body.lang = $("elg").value; body.kind = $("ef").value; body.stock = +$("es").value || 0; const t = TX || $("ex").value.trim(); if (t) body.text = t; const f = $("ej").files[0]; if (f) { body.cover = await act(() => coverData(f)); if (!body.cover) return; } }
    if (body.kind === "free") delete body.price;
    if (!(await act(() => api("/admin/books/" + b.id, { method: "PUT", body })))) return; toast("Modifications enregistrées"); await refreshBooks(); admv();
  };
};
ATAB.rem = async c => {
  const L = (await api("/admin/books")).books;
  c.innerHTML = `<p class="mut">« Retirer » cache le livre du catalogue : les clients qui l'ont acheté peuvent toujours le lire, et vous pouvez le remettre en vente. « Supprimer » l'efface définitivement.</p><div class="card">${L.map(b => `<div class="line"><span>${esc(b.t)}<br><span class="mut">${TY[b.f]}${b.l === "ar" ? " · arabe" : ""}${b.inc ? " · pack" : ""}${b.h ? " · retiré" : ""}</span></span><span><button class="btn alt sm" data-rm="${b.id}">${b.h ? "Remettre" : "Retirer"}</button> <button class="btn sm" style="background:#c0392b;color:#fff" data-rd="${b.id}">Supprimer</button></span></div>`).join("")}</div>`;
  c.onclick = async e => {
    const d = e.target.dataset, b = L.find(x => x.id == (d.rm || d.rd)); if (!b) return;
    if (d.rm) { if (await act(() => api("/admin/books/" + b.id, { method: "PUT", body: { hidden: !b.h } }))) { await refreshBooks(); admv(); } }
    else if (confirm("Supprimer définitivement « " + b.t + " » ? Les clients qui l'ont acheté perdront l'accès.")) { if (await act(() => api("/admin/books/" + b.id, { method: "DELETE" }))) { delete cart[b.id]; saveCart(); await refreshBooks(); admv(); } }
  };
};
ATAB.pay = async c => {
  const P = (await api("/admin/payments")).payments;
  c.innerHTML = P.length ? `<div class="card wrap"><table><tr><th>Réf.</th><th>Client</th><th>Livre</th><th>Montant</th><th>Transaction</th><th>Statut</th></tr>${P.map(x => `<tr><td>${esc(x.id)}<br><span class="mut">${dfr(x.created)}</span></td><td>${esc(x.name)}<br>${esc(x.email)}</td><td>${esc(x.title)}</td><td>${fmt(x.amount)}<br>${esc(x.method)}</td><td>${esc(x.tx)}</td><td>${x.status === "En attente" ? `<button class="btn sm" data-pv="${x.id}">Valider</button> <button class="btn alt sm" data-pr="${x.id}">Refuser</button>` : esc(x.status)}</td></tr>`).join("")}</table></div><p class="mut">Vérifiez le numéro de transaction dans votre application Wave ou Orange Money avant de valider.</p>` : '<p class="mut">Aucun paiement reçu pour le moment.</p>';
  c.onclick = async e => { const d = e.target.dataset, id = d.pv || d.pr; if (!id) return; if (await act(() => api(`/admin/payments/${id}/${d.pv ? "validate" : "reject"}`, { method: "POST", body: {} }))) { toast(d.pv ? "Paiement validé : le livre est accessible au client" : "Paiement refusé"); admv(); } };
};
ATAB.ord = async c => {
  const O = (await api("/admin/orders")).orders;
  c.innerHTML = O.length ? `<div class="card wrap"><table><tr><th>Réf.</th><th>Client</th><th>Articles</th><th>Total</th><th>Suivi</th></tr>${O.map(o => `<tr><td>${esc(o.ref)}<br><span class="mut">${dfr(o.created)}</span></td><td>${esc(o.name)}<br>${esc(o.phone)}<br><span class="mut">${esc(o.address)} (${esc(o.zone)})</span></td><td>${o.items.map(i => esc(i.title) + " ×" + i.q).join(", ")}</td><td>${fmt(o.total)}</td><td><select data-os="${esc(o.ref)}">${["En préparation", "Expédiée", "Livrée", "Annulée"].map(x => `<option${x === o.status ? " selected" : ""}>${x}</option>`).join("")}</select><input placeholder="Livreur" style="margin-top:4px" data-ol="${esc(o.ref)}" value="${esc(o.driver)}"><input placeholder="N° de suivi" style="margin-top:4px" data-osv="${esc(o.ref)}" value="${esc(o.tracking)}"></td></tr>`).join("")}</table></div><p class="mut">Annuler une commande remet les livres en stock.</p>` : '<p class="mut">Aucune commande.</p>';
  c.onchange = async e => {
    const d = e.target.dataset, v = e.target.value, ref = d.os || d.ol || d.osv; if (!ref) return;
    const body = d.os ? { status: v } : d.ol ? { driver: v } : { tracking: v };
    if (await act(() => api("/admin/orders/" + ref, { method: "PUT", body }))) { toast("Enregistré"); if (d.os) { await refreshBooks(); admv(); } } else admv();
  };
};
ATAB.liv = async c => {
  const [cfg] = await Promise.all([api("/config")]); S.cfg = cfg;
  c.innerHTML = `<p class="mut">Ces tarifs s'affichent dans le panier. Les commandes déjà passées gardent leur prix.</p><div class="card">${cfg.zones.map(z => `<div class="row2"><div><label>Zone</label><input data-zn="${z.id}" value="${esc(z.name)}" maxlength="60"></div><div><label>Frais (FCFA)</label><input type="number" min="0" data-zf="${z.id}" value="${z.fee}"></div></div><button class="btn alt sm" style="margin-top:6px" data-zd="${z.id}">Supprimer cette zone</button><hr>`).join("")}</div>
<h2>Nouvelle zone</h2><div class="card"><div class="row2"><div><label for="zn1">Zone</label><input id="zn1" maxlength="60"></div><div><label for="zf1">Frais (FCFA)</label><input id="zf1" type="number" min="0"></div></div><button class="btn" style="margin-top:10px" id="zb">Ajouter la zone</button></div>
<h2>Numéros de paiement</h2><div class="card"><label for="cw">Wave</label><input id="cw" value="${esc(cfg.wave)}" maxlength="40"><label for="co">Orange Money</label><input id="co" value="${esc(cfg.om)}" maxlength="40"><button class="btn" style="margin-top:10px" id="cs">Enregistrer</button></div>`;
  c.onchange = async e => { const d = e.target.dataset, v = e.target.value; let r;
    if (d.zn) r = await act(() => api("/admin/zones/" + d.zn, { method: "PUT", body: { name: v } })); else if (d.zf) r = await act(() => api("/admin/zones/" + d.zf, { method: "PUT", body: { fee: +v } })); else return;
    if (r) toast("Enregistré"); };
  c.onclick = async e => { const z = e.target.dataset.zd; if (z && confirm("Supprimer cette zone ?")) { if (await act(() => api("/admin/zones/" + z, { method: "DELETE" }))) admv(); } };
  $("zb").onclick = async () => { if (await act(() => api("/admin/zones", { method: "POST", body: { name: $("zn1").value, fee: $("zf1").value === "" ? -1 : +$("zf1").value } }))) admv(); };
  $("cs").onclick = async () => { if (await act(() => api("/admin/config", { method: "PUT", body: { wave: $("cw").value, om: $("co").value } }))) toast("Numéros enregistrés"); };
};
ATAB.stat = async c => {
  const s = await api("/admin/stats"), M = {};
  s.digital.forEach(x => (M[x.m] = M[x.m] || { n: 0, p: 0 }).n = x.s); s.physical.forEach(x => (M[x.m] = M[x.m] || { n: 0, p: 0 }).p = x.s);
  const ms = Object.keys(M).sort().reverse(), mn = m => new Date(m + "-01T12:00:00").toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  c.innerHTML = `<h2>Ventes par mois</h2>${ms.length ? `<div class="card wrap"><table><tr><th>Mois</th><th>Numérique</th><th>Physique</th><th>Total</th></tr>${ms.map(m => `<tr><td>${esc(mn(m))}</td><td>${fmt(M[m].n)}</td><td>${fmt(M[m].p)}</td><td><b>${fmt(M[m].n + M[m].p)}</b></td></tr>`).join("")}</table></div>` : '<p class="mut">Aucune vente pour le moment.</p>'}
<h2>Livres les plus lus et achetés</h2><div class="card wrap"><table><tr><th>Livre</th><th>Achats numériques</th><th>Lectures</th></tr>${s.top.map(b => `<tr><td>${esc(b.title)}</td><td>${b.sold}</td><td>${b.reads}</td></tr>`).join("")}</table></div>
<h2>Exporter pour Excel (CSV)</h2><a class="btn" href="/api/admin/export/orders.csv" download>Commandes physiques</a> <a class="btn alt" href="/api/admin/export/payments.csv" download>Paiements numériques</a>`;
};
ATAB.promo = async c => {
  const P = (await api("/admin/promos")).promos;
  c.innerHTML = `<div class="card">${P.map(p => `<div class="line"><span><b>${esc(p.code)}</b> · −${p.percent} %</span><button class="btn alt sm" data-pd="${esc(p.code)}">Supprimer</button></div>`).join("") || '<p class="mut">Aucun code.</p>'}</div><h2>Nouveau code</h2><div class="card"><div class="row2"><div><label for="pc1">Code</label><input id="pc1" placeholder="NOUVEAU20" maxlength="30"></div><div><label for="pc2">Réduction (%)</label><input id="pc2" type="number" min="1" max="90"></div></div><button class="btn" style="margin-top:10px" id="pc3">Créer le code</button></div>`;
  c.onclick = async e => { const k = e.target.dataset.pd; if (k && await act(() => api("/admin/promos/" + k, { method: "DELETE" }))) admv(); };
  $("pc3").onclick = async () => { if (await act(() => api("/admin/promos", { method: "POST", body: { code: $("pc1").value, percent: +$("pc2").value } }))) admv(); };
};
ATAB.cli = async c => {
  const U = (await api("/admin/users")).users;
  c.innerHTML = U.length ? `<div class="card wrap"><table><tr><th>Nom</th><th>E-mail</th><th>Inscrit le</th><th>Livres</th><th></th></tr>${U.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${dfr(u.created)}</td><td>${u.n}</td><td><button class="btn alt sm" data-ur="${u.id}" data-ue="${esc(u.email)}">Nouveau mot de passe</button></td></tr>`).join("")}</table></div><p class="mut">Les mots de passe ne sont jamais visibles, même pour vous. Si un client oublie le sien, générez-en un temporaire et communiquez-le lui.</p>` : '<p class="mut">Aucun compte client pour le moment.</p>';
  c.onclick = async e => { const id = e.target.dataset.ur; if (!id || !confirm("Générer un mot de passe temporaire pour " + e.target.dataset.ue + " ?")) return; const r = await act(() => api(`/admin/users/${id}/reset`, { method: "POST", body: {} })); if (r) alert("Mot de passe temporaire pour " + e.target.dataset.ue + " :\n\n" + r.password + "\n\nCommuniquez-le au client. Il pourra le changer dans Mon compte."); };
};
ATAB.log = async c => {
  const L = (await api("/admin/audit")).log;
  c.innerHTML = L.length ? `<div class="card">${L.map(x => `<p class="mut" style="margin:4px 0">${dfr(x.ts)} ${new Date(x.ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} · ${esc(x.who)} · ${esc(x.txt)}</p>`).join("")}</div>` : '<p class="mut">Aucune action enregistrée.</p>';
};

/* ---------- Installation sur le téléphone et hors connexion ---------- */
let dp = null; const sa = matchMedia("(display-mode: standalone)").matches || navigator.standalone, lgg = k => { try { return localStorage.getItem(k); } catch { return null; } };
function bn(t, b) { if (sa || lgg("ciba-ix")) return; $("it").textContent = t; $("ib").style.display = b ? "inline-block" : "none"; $("ins").style.display = "block"; }
addEventListener("beforeinstallprompt", e => { e.preventDefault(); dp = e; bn("Installez Ciba Édition sur votre téléphone pour l'ouvrir en un geste.", true); });
$("ib").onclick = async () => { if (dp) { dp.prompt(); await dp.userChoice; dp = null; $("ins").style.display = "none"; } };
$("ix").onclick = () => { $("ins").style.display = "none"; try { localStorage.setItem("ciba-ix", "1"); } catch { } };
if (/iphone|ipad|ipod/i.test(navigator.userAgent)) bn("Sur iPhone : touchez Partager, puis « Sur l'écran d'accueil » pour installer Ciba Édition.", false);
const offBar = () => $("off").style.display = navigator.onLine ? "none" : "block"; addEventListener("online", () => { offBar(); if (S.off) boot(); }); addEventListener("offline", offBar); offBar();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => { });

/* ---------- Démarrage ---------- */
async function boot() { try { await load(); } catch (e) { S.off = true; } offLoad(); nav(); view(S.off ? "lib" : cur === "adm" || cur === "acc" ? cur : "cat"); }
boot();
