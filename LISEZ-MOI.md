# Ciba Édition : mettre le site en ligne sur Render

Ce dossier contient le site complet : pages, comptes clients, livres lisibles en ligne, commandes, paiements Wave et Orange Money validés par vous, espace administrateur et base de données. Tout tourne dans **un seul service** Render, sans autre compte à créer.

## Fichiers (à envoyer tous, à la racine, sans dossier)

`server.js` · `totp.js` · `app.js` · `index.html` · `sw.js` · `package.json` · `render.yaml` · `test.js` · `LISEZ-MOI.md` · `pdf.min.mjs` · `pdf.worker.min.mjs` · `PDFJS-LICENSE.txt`

Les deux fichiers `pdf…mjs` sont le lecteur de PDF (pdf.js, licence Apache 2.0, voir `PDFJS-LICENSE.txt`). Sans eux, le site fonctionne mais l'envoi de livres PDF est désactivé.

## Coût (à vérifier sur render.com/pricing avant de payer)

- Pour conserver vos données, il faut un service **payant** avec un **disque permanent**. Au moment de la rédaction : service Starter à 7 $ par mois, disque à 0,25 $ par Go et par mois (1 Go suffit pour commencer).
- Le plan gratuit de Render **efface les données** à chaque redémarrage et s'endort après 15 minutes sans visite. Utilisez-le seulement pour un essai.
- Render n'est pas lié à vos livres : vous pouvez récupérer une sauvegarde à tout moment (voir plus bas) et changer d'hébergeur.

## Mise en ligne, étape par étape

1. **GitHub** : créez un compte sur github.com, puis un dépôt **privé** nommé `ciba-edition` (New repository, cochez Private).
2. **Envoyer les fichiers** : si vous avez reçu un dossier compressé (`.zip`), décompressez-le d'abord. Dans le dépôt, « Add file » puis « Upload files », glissez les 12 fichiers, puis « Commit changes ».
3. **Render** : créez un compte sur render.com et connectez votre compte GitHub.
4. **Créer le service** : « New + » puis « Blueprint », choisissez le dépôt `ciba-edition`. Render lit `render.yaml` et vous demande deux valeurs :
   - `ADMIN_EMAIL` : votre e-mail d'administrateur ;
   - `ADMIN_PASSWORD` : un mot de passe long (10 caractères minimum), que vous seul connaissez.
5. Validez (« Apply » ou « Deploy Blueprint »). Render demande un moyen de paiement pour le service payant. Attendez que l'état passe à **Live**, puis ouvrez l'adresse en `.onrender.com`.
6. **Première connexion** : onglet **Connexion**, entrez votre e-mail et votre mot de passe d'administrateur. L'onglet **Admin** apparaît alors.

> Si le Blueprint pose problème, créez le service à la main : « New + » puis « Web Service », même dépôt, Runtime **Node**, Build `npm install --omit=dev`, Start `node server.js`, type **Starter**, « Add Disk » (nom `ciba-data`, chemin `/var/data`, 1 Go), Health Check Path `/health`, et les variables du tableau plus bas.

## À faire juste après (onglet Admin)

1. **Livraison** : remplacez les numéros Wave et Orange Money d'exemple par les vôtres, et réglez vos zones et tarifs.
2. **Retirer un livre** : supprimez les livres d'exemple.
3. **Ajouter un livre** : déposez votre fichier Word (.docx) ou PDF, ou collez le texte, ajoutez couverture et résumé (voir la section suivante).
4. Remplacez le numéro WhatsApp d'exemple dans `index.html` (cherchez `221700000000`), puis rechargez le fichier sur GitHub.
5. Le **Tableau de bord** affiche des alertes tant que ces points ne sont pas réglés.

## Ajouter un livre : formats, chapitres et couverture

- **Formats acceptés** : Word (.docx), **PDF avec du texte** (.pdf) et texte (.txt, .md), ou texte collé. Le fichier est lu dans votre navigateur ; le site garde le texte, pas le fichier. Les anciens .doc et les EPUB ne sont pas acceptés : enregistrez-les en .docx ou en PDF.
- **PDF** : le site récupère le texte, reconstitue les paragraphes, retire les en-têtes, pieds de page et numéros de page, et lit les mots arabes de droite à gauche. Les chapitres viennent du **plan (signets) du PDF**, ou à défaut des titres en gros caractères. Un **PDF scanné** (photos de pages) ne contient pas de texte : le site le refuse et vous le dit. Les images, tableaux et colonnes multiples des PDF ne sont pas repris ; pour une mise en page soignée, préférez un fichier Word.
- **Chapitres et sommaire** : dans Word, utilisez les styles **Titre 1** (chapitre) et **Titre 2** (sous-partie). Dans un texte collé ou un fichier .txt, écrivez les titres sur une ligne qui commence par `# ` (chapitre) ou `## ` (sous-partie). Sans aucun titre marqué, le site repère les lignes du type « Chapitre 3 », « Introduction », « Conclusion », « الفصل الأول », « المقدمة ». Chaque chapitre commence sur une nouvelle page.
- **Couverture** : image jusqu'à **4 Mo** (JPEG, PNG ou WebP). Le site la réduit automatiquement pour que les pages restent rapides sur téléphone.
- **Modifier un livre** : vous pouvez remplacer le texte (Word, PDF ou collé) ; le sommaire est refait. Changer le titre met aussi à jour la page de titre.

## La page de lecture

- **Sommaire** : le client voit les chapitres sur la fiche du livre et dans la lecture (bouton ☰). Il peut commencer au début, reprendre où il s'était arrêté, cliquer sur le chapitre 5, ou taper un numéro de page. Pour un livre payant non acheté, les chapitres sont visibles mais verrouillés : seule l'ouverture du livre est lisible.
- **Rechercher dans le livre** (sans tenir compte des accents ni des majuscules) et **signets** sur les pages de son choix.
- **Réglages** (Aa), gardés sur l'appareil : taille du texte, police classique ou moderne, interligne, largeur, thème clair, sépia, nuit ou automatique, texte justifié.
- **Lecture à voix haute** (voix de l'appareil, français ou arabe selon le livre, avec vitesse réglable et page tournée automatiquement), barre de progression, temps de lecture restant, balayage du doigt ou flèches du clavier pour tourner les pages.
- Les livres arabes s'affichent de droite à gauche. La lecture hors ligne (copie de 30 jours) garde le sommaire, la recherche et les signets.

## Livres arabes

Le menu **Livres arabes** (الكتب العربية) regroupe les livres en arabe par **domaine** : religion et spiritualité, langue arabe, histoire et civilisation, littérature et poésie, sciences et savoirs, enfants et contes, éducation et formation. Il a ses propres filtres et sa recherche, qui accepte l'arabe. Les livres arabes n'apparaissent que dans cet onglet.

- **Ajouter un livre arabe** : Admin, « Ajouter un livre », choisissez **Langue du livre : Arabe**, puis le domaine. Déposez un fichier Word (.docx) en arabe ou collez le texte. Le champ « Modifier un livre » permet de changer la langue ou le domaine.
- **Lecture** : les livres arabes s'affichent de droite à gauche, avec les polices arabes de l'appareil du lecteur.
- Six livres d'exemple sont fournis : retirez-les comme les autres exemples.
- Attention aux droits : une édition critique (تحقيق) ou une mise en page récente d'un texte ancien a ses propres droits. Pour les textes religieux, vérifiez l'exactitude du texte et sa source.

## Double authentification de l'administrateur (recommandée)

1. Sur Render, ouvrez le service, onglet **Shell**, tapez `node server.js --totp` (ou `npm run totp` sur un ordinateur avec Node 22). Copiez le **secret** affiché.
2. Dans une application d'authentification (Google Authenticator, Aegis), choisissez « Saisir une clé de configuration » et collez le secret.
3. Sur Render, onglet **Environment**, ajoutez la variable `ADMIN_TOTP_SECRET` avec ce secret, puis enregistrez.
4. À chaque connexion, le site demande alors le code à 6 chiffres.
5. En cas de blocage (téléphone perdu), supprimez la variable `ADMIN_TOTP_SECRET` sur Render : la double authentification est désactivée.

## Mettre à jour le site

Modifiez un fichier sur GitHub (icône crayon, puis « Commit changes ») : Render republie tout seul en une à deux minutes. **Pour installer une nouvelle version du site**, envoyez à nouveau tous les fichiers du dossier (ceux qui ont le même nom remplacent les anciens). Les livres, comptes et commandes restent sur le disque, et la base se met à jour toute seule : les anciens livres reçoivent leur sommaire automatiquement. Une courte coupure pendant la publication est normale.

## Sauvegardes

- Admin, **Tableau de bord**, « Télécharger une sauvegarde » : copie complète des données (fichier `.db`). Faites-le chaque semaine.
- Admin, **Ventes et export** : commandes et paiements en CSV pour Excel.
- Selon la documentation de Render, le disque est aussi copié automatiquement chaque jour.

## Variables d'environnement

| Variable | Rôle |
|---|---|
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Compte administrateur (le mot de passe de Render remplace l'ancien à chaque démarrage) |
| `SESSION_SECRET` | Clé des connexions (générée par Render) |
| `DATA_DIR`, `PERSISTENT_DATA` | Dossier de la base (`/var/data`) et indication que le disque est permanent (`1`) |
| `NODE_VERSION` | Version de Node (22) |
| `ADMIN_TOTP_SECRET` | Double authentification (facultatif) |

## Essayer chez vous

Avec Node 22.13 ou plus récent : `npm test` lance 21 vérifications automatiques. `ADMIN_EMAIL=moi@exemple.sn ADMIN_PASSWORD=UnMotDePasseLong1 npm start` lance le site sur http://localhost:3000.

## Comment ça marche, et ses limites

- **Achat numérique** : le client envoie l'argent par Wave ou Orange Money, saisit le numéro de transaction, et vous validez dans l'onglet **Paiements** après avoir vérifié dans votre application. Il n'y a pas de paiement automatique.
- **Livres numériques** : le texte est gardé sur le serveur et envoyé page par page. Un visiteur sans achat ne reçoit que le début. Les protections contre la copie (clic droit, filigrane au nom du client) dissuadent, mais rien n'empêche une capture d'écran.
- **Lecture hors ligne** : la copie est valable 30 jours sur l'appareil et n'est pas chiffrée.
- **Pas de SMS ni d'e-mails automatiques** : les clients voient l'état de leurs paiements et commandes dans **Mon compte**. Un client qui oublie son mot de passe vous le demande, vous générez un mot de passe temporaire dans **Clients**.
- **Une seule instance** : la base est un fichier sur un disque, ce qui convient à une boutique qui démarre. Pour beaucoup de trafic, il faudra passer à une base PostgreSQL.
- Le texte des pages Infos et des conditions de vente est un modèle : faites-le valider, ainsi que les démarches auprès de la CDP (loi n° 2008-12).

## En cas de problème

Ouvrez l'onglet **Logs** du service sur Render. Messages utiles : « ADMIN_PASSWORD trop court » (choisissez 10 caractères ou plus), « Mot de passe administrateur généré » (utilisez ce mot de passe pour vous connecter, puis définissez `ADMIN_PASSWORD`), « SESSION_SECRET absent » (ajoutez la variable).
