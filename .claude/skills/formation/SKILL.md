---
name: formation
description: Construit ou audite un programme de formation Alpes IA (objectifs, modules, exercices, déroulé horaire) en s'appuyant sur les skills pédagogiques existantes. Déclencheurs - /formation, "programme de formation", "déroulé pédagogique", "auditer un module".
---

# /formation — Programmes de formation Alpes IA

Routeur vers les skills pédagogiques déjà écrites. Lire UNIQUEMENT le fichier utile au job.

| Job | Fichier à lire | Rôle |
|-----|----------------|------|
| Positionnement, angle unique du programme | `~/Code/Claude Skills/custom-skills/core-thesis-extractor.md` | Extraire ce qui rend la formation Alpes IA différente |
| Exercices et grilles de correction | `~/Code/Claude Skills/custom-skills/exercise-factory.md` | 5 à 10 exercices progressifs par module |
| Audit d'un programme existant | `~/Code/Claude Skills/custom-skills/module-auditor.md` | Trous, redondances, modules faibles |
| Export Word | skill `office-docx` (installée) | Livrable client .docx |

Contexte à charger avant tout : `brain/knowledge/formation-ia.md`, `brain/knowledge/christophe.md`
et `brain/knowledge/alpes-ia.md` dans le second brain (`/Users/christophehavard/Code/second-brain`).
Les programmes déjà vendus sont référencés dans `brain/finance/` (ex : DEV-2026-004,
formation Claude 2 jours pour Simatis).

## Action `programme`
1. Lire le brief : sujet, public, durée, niveau, promesse de transformation.
2. Charger le contexte second brain ci-dessus. Appliquer `core-thesis-extractor` pour
   fixer l'angle Alpes IA (IA générative et automatisation pour TPE/PME, pratique, outillé).
3. Écrire le programme en markdown : promesse, prérequis, objectifs pédagogiques
   mesurables, modules (titre, durée, contenu, livrable), déroulé horaire par journée
   (9h00-12h30 / 14h00-17h30), modalités d'évaluation, matériel.
   Mentions obligatoires Qualiopi / NDA : public visé, prérequis, objectifs, durée,
   modalités et délais d'accès, tarif, méthodes mobilisées, modalités d'évaluation,
   accessibilité handicap.
4. Appliquer `exercise-factory` sur chaque module : exercices + grille de correction
   dans un second fichier.
5. Sauver dans `output/formations/` : `Programme_<Sujet>_<Client>.md` et
   `Exercices_<Sujet>_<Client>.md`. Si le brief demande un livrable client, produire
   aussi le `.docx` avec `office-docx`.
6. Terminer par une ligne `OUTPUT: <chemin absolu>` par fichier.

## Action `audit`
1. Lire le programme donné (chemin ou contenu) et la promesse de transformation.
2. Appliquer `module-auditor` intégralement.
3. Sauver `output/formations/Audit_<Sujet>.md`, terminer par `OUTPUT: <chemin>`.

## Garde-fous
- Ne pas inventer de références clients ; les prendre dans le second brain ou les omettre.
- Durées réalistes : 7 h par jour, pauses comprises.
- Français, tutoiement proscrit dans les livrables client.
