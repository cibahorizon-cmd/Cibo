"use strict";
/* CIBOO : restaure la dernière sauvegarde Supabase dans un fichier de base vide.
   Lancé automatiquement au démarrage quand le disque est vide (ex. nouveau service Render).
   Usage : node restore-supabase.js <chemin du fichier .db à créer>
   Code de sortie : 0 = restauré, 3 = aucune sauvegarde (premier démarrage normal), 1 = erreur. */
const fs = require("node:fs"), zlib = require("node:zlib");
const SB = require("./supabase");
const dest = process.argv[2];
const out = o => { process.stdout.write(JSON.stringify(o) + "\n"); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  if (!dest) { out({ error: "chemin manquant" }); process.exit(1); }
  if (!SB.configured) { out({ none: true, why: SB.problem || "Supabase non configuré" }); process.exit(SB.problem ? 1 : 3); }
  let gz = null, meta = null, last = null;
  for (let i = 0; i < 3; i++) {                       // quelques essais : le réseau peut mettre un instant à répondre au démarrage
    try {
      gz = await SB.get("latest.db.gz");
      const m = await SB.get("latest.json"); try { meta = m ? JSON.parse(m.toString()) : null; } catch { meta = null; }
      last = null; break;
    } catch (e) { last = e; if (e.status && e.status < 500 && e.status !== 429) break; if (i < 2) await sleep(+process.env.RESTORE_RETRY_MS || 4000); }
  }
  if (last) { out({ error: last.message }); process.exit(1); }
  if (!gz) { out({ none: true }); process.exit(3); }
  const tmp = dest + ".incoming";
  try {
    fs.writeFileSync(tmp, zlib.gunzipSync(gz, { maxOutputLength: 1024 * 1024 * 1024 }));
    SB.checkDb(tmp);
    for (const s of ["-wal", "-shm"]) fs.rmSync(dest + s, { force: true });
    fs.renameSync(tmp, dest);
  } catch (e) { fs.rmSync(tmp, { force: true }); out({ error: "la sauvegarde Supabase est illisible (" + e.message + ")" }); process.exit(1); }
  out({ ok: true, at: meta && meta.at, counts: meta && meta.counts });
  process.exit(0);
})().catch(e => { out({ error: e.message }); process.exit(1); });
