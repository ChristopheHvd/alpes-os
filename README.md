# Alpes IA — Agentic OS

Command centre local bâti sur le cadre ARMS : Applications, Routines, Memory, Skills.
Une page, une adresse, qui montre le travail sans jamais devenir l'endroit où il est stocké.

![statut](https://img.shields.io/badge/statut-usage%20personnel-orange)

## Ce que la page affiche

| Zone | Contenu |
|------|---------|
| Centre | Le second brain en graphe force-directed : un nœud par note, une arête par lien markdown. Recherche, filtre par domaine, fiche de concept avec son corps rendu |
| Boîte de réception | Les fils Gmail d'un label, triés en trois catégories : une personne, un automate, une liste de diffusion |
| Aujourd'hui | La todo du jour, lue et écrite dans le second brain, plus les événements à venir |
| Projets en cours | Les projets au long cours, avec leur prochaine étape éditable |
| Micro apps | Des boutons qui lancent une skill Claude Code en mode headless et rendent leurs livrables |

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

### Les skills

Le dashboard lance trois skills en headless : `devis`, `formation`, `briefing`.
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
