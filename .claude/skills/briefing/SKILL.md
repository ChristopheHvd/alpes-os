---
name: briefing
description: Compose la todo du jour à partir des projets au long cours, du calendrier, des mails à traiter et de ce qui reste en cours. Déclencheurs - /briefing, "compose ma journée", "briefing du jour", "que faire aujourd'hui".
---

# /briefing — Composer la journée

Transforme l'état réel du système en une liste courte de tâches pour aujourd'hui.
Le contexte (projets, événements, mails, todo actuelle) est fourni dans le brief,
en JSON, sous la ligne `CONTEXTE:`. Il fait foi pour les faits.

## Étapes

1. **Lire le contexte** fourni. Puis lire les fiches projet citées dans
   `/Users/christophehavard/Code/second-brain/brain/projects/` pour comprendre où en est
   chaque chantier. Ne pas parcourir tout le second brain, seulement les projets concernés.
2. **Décider**, dans cet ordre de priorité :
   - ce qu'impose le calendrier du jour et de demain (préparer une réunion, envoyer un
     document avant un rendez-vous) ;
   - les mails de personnes qui attendent une réponse ;
   - la `next` de chaque projet `stage: actif`, en n'en retenant qu'une ou deux, celles
     qui sont réellement faisables aujourd'hui ;
   - ce qui reste non coché dans la todo et garde du sens.
3. **Écrire la todo** dans `/Users/christophehavard/Code/second-brain/brain/journal/todo.md`.
   Format strict, une section par jour, la plus récente en haut :

   ```
   # Todo

   ## 2026-09-08

   - [ ] Texte de la tâche — contexte court !!
   - [x] Tâche déjà faite — contexte
   ```

   `!!` = urgent, `!` = important, rien = normal. Le contexte après ` — ` nomme le projet
   ou la source (« PoleBox », « Gmail · Cédric », « RDV 14h »).
   **Conserver telles quelles les tâches déjà cochées du jour** et les sections des autres
   jours. Ne jamais réécrire le fichier entier de mémoire : le lire, le modifier, le réécrire.
4. **Viser 3 à 6 tâches.** Une journée n'en contient pas quinze. Si un projet n'a rien
   d'actionnable aujourd'hui, ne rien inventer pour lui.
5. **Mettre à jour les projets** dont la prochaine étape a visiblement changé : modifier
   `next` et `updated` dans le frontmatter de la fiche concernée. Ne pas toucher `status`.
6. **Écrire le compte rendu** dans `output/briefings/Briefing_AAAA-MM-JJ.md` : ce qui a
   guidé les choix, ce qui a été écarté et pourquoi, les points d'attention.
   Terminer par une ligne `OUTPUT: <chemin absolu>`.

## Garde-fous

- Ne jamais inventer un rendez-vous, un montant ou un interlocuteur absent du contexte.
- Ne jamais supprimer une tâche cochée.
- Ne rien envoyer : pas de mail, pas de message.
- Écrire en français, à l'infinitif (« Relancer Signature », pas « Je dois relancer »).

## Garde-fous git
- **Ne jamais lancer de commande git** : pas de `git add`, `git commit`, `git checkout`.
  Les fichiers sont laissés modifiés, Christophe committe lui-même sur la bonne branche.
