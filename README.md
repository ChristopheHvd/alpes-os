# AlpesOS

Command centre local bâti sur le cadre ARMS : Applications, Routines, Memory, Skills.
Une page, une adresse, qui montre le travail sans jamais devenir l'endroit où il est stocké.

![statut](https://img.shields.io/badge/statut-usage%20personnel-orange)

## Ce que la page affiche

Une barre du haut ouvre chaque onglet (`#projets`, `#finances`, `#linkedin`, `#second-brain`, `#outils`) ;
le bouton « Demander à l'assistant » (⌘K) ouvre l'assistant, le bouton Démo remplace les finances
affichées par un jeu fictif.

| Onglet | Contenu |
|------|---------|
| Aujourd'hui | Bande Finances (encaissé, à encaisser, projection sur 3 mois), la todo du jour lue et écrite dans le second brain, les projets en cours, les agents, le post LinkedIn du jour |
| Projets | Les projets au long cours, avec leur prochaine étape éditable |
| Finances | Échéances lues dans le frontmatter de `brain/finance`, graphique mensuel, devis cochés « comptés » dans la projection |
| LinkedIn | Le plan éditorial du mois : post du jour préparé chaque matin par Claude, retouche, publication directe sur le profil |
| Second brain | Le graphe force-directed : un nœud par note, une arête par lien markdown. Filtre par domaine et par texte, fiche de concept, champ « Interroger » |
| Outils | Les micro apps (une skill Claude Code lancée en mode headless) et les supports de formation |

Gmail et l'agenda ne s'affichent plus, mais l'assistant et le stand-up continuent de les lire.

## Installation

```bash
npm install
cp config/config.example.json config/config.json
cp config/branding.example.json config/branding.json
npm start                      # http://localhost:4545
```

Renseigner dans `config/config.json` le chemin du second brain et le label Gmail,
puis dans `config/branding.json` l'identité et les coordonnées bancaires qui
alimentent les documents générés. Ces deux fichiers ne sont jamais versionnés.

### Gmail et Google Calendar

Créer un client OAuth de type « Desktop app » dans Google Cloud Console, activer
les API Gmail et Calendar, puis déposer le fichier dans `credentials/client_secret.json`.
Le premier lancement propose un lien d'autorisation. Les jetons restent en local.

### LinkedIn

Le plan vit dans le second brain (`brain/references/plan-linkedin-AAAA-MM.md`, liste
`posts:` dans le frontmatter), les visuels dans le Drive (`<drive>/03.COMMUNICATION/LinkedIn/AAAA-MM/Jxx.*`).
Chaque matin dès `linkedin.prepareAt`, la skill `linkedin-post` prépare le post du jour
(texte, premier commentaire et, quand Claude sait le faire, le visuel). Un post raté fait
glisser tout le planning.

Publication par l'API officielle, sur le profil : créer une app sur
linkedin.com/developers (rattachée à une Page LinkedIn), ajouter les produits
« Sign In with LinkedIn using OpenID Connect » et « Share on LinkedIn », déclarer
l'URL de retour `http://localhost:<port>/auth/linkedin/callback`, puis déposer
`credentials/linkedin_client.json` :

```json
{ "client_id": "…", "client_secret": "…" }
```

(`redirect_uri` en plus si l'URL de retour passe par un rebond HTTPS.) `http://localhost`
est accepté par LinkedIn. Le premier commentaire ne passe pas par l'API (il faudrait le
produit Community Management, réservé aux partenaires) : il est copié dans le
presse-papiers après la publication. Le jeton dure
60 jours : la page LinkedIn affiche le compte à rebours et un bouton pour le renouveler.
`linkedin.version` suit les versions de l'API LinkedIn (AAAAMM) : à avancer avant que la
version en cours ne soit retirée, environ un an après sa sortie.

### Les skills

Le dashboard lance ses skills en headless : `devis`, `formation`, `standup`, `linkedin-post`.
Elles ne sont pas dans ce dépôt, parce qu'elles citent des clients, des montants et
des chemins locaux. Elles vivent dans un dépôt privé et sont exposées à Claude Code
par symlink :

```bash
ln -s /chemin/vers/prive/skills/alpes-os/devis ~/.claude/skills/devis
```

Sans elles, l'interface fonctionne, mais les boutons des micro apps échouent.

## Ce qui reste local

`credentials/`, `output/` et les deux fichiers de configuration ne sont pas versionnés.
`output/` contient l'historique des exécutions, les fichiers produits et les décisions
de tri du courrier.

## Structure

```
server.js            API Express, une route par couche
lib/brain.js         indexe le second brain en graphe
lib/gmail.js         lecture Gmail via OAuth
lib/mailfilter.js    tri du courrier sur en-têtes et expéditeur
lib/mailstate.js     décisions de tri persistées
lib/calendar.js      événements à venir
lib/todo.js          lecture et écriture de la todo markdown
lib/projects.js      projets au long cours
lib/runs.js          exécutions headless et leur historique
public/index.html    toute l'interface, sans framework
templates/           gabarit A4 des documents générés
```
