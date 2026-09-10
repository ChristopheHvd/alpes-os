---
titre: Context engineering
duree: 45
objectif: Composer ce que le modèle a sous les yeux quand il répond
---

## Context engineering
type: titre

Le prompting, c'est comment vous demandez.
Le context engineering, c'est **ce qu'il a sous les yeux** au moment de répondre.

::: notes
Vrai changement de posture ici : on passe de « bien écrire une phrase » à « préparer le poste de travail du modèle ». C'est le module qui fait basculer vers la posture d'opérateur.
:::

---

## La fenêtre de contexte
type: concept

À chaque réponse, le modèle relit **tout** ce qui est dans la fenêtre : vos instructions, l'historique de la conversation, les fichiers joints, ce que les connecteurs ont ramené.

Cette fenêtre est large, mais finie. Et surtout :

> Tout ce qui y est présent **pèse** sur la réponse — y compris ce qui n'a rien à y faire.

```svg
<svg viewBox="0 0 700 96" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
  <g font-family="inherit" font-size="13" fill="currentColor">
    <rect x="0" y="14" width="150" height="34" rx="4" fill="currentColor" opacity="0.16"/>
    <rect x="154" y="14" width="120" height="34" rx="4" fill="currentColor" opacity="0.16"/>
    <rect x="278" y="14" width="210" height="34" rx="4" fill="currentColor" opacity="0.16"/>
    <rect x="492" y="14" width="130" height="34" rx="4" fill="currentColor" opacity="0.16"/>
    <rect x="626" y="14" width="74" height="34" rx="4" fill="none" stroke="currentColor" stroke-dasharray="4 4" opacity="0.5"/>
    <text x="75" y="36" text-anchor="middle">Instructions</text>
    <text x="214" y="36" text-anchor="middle">Mémoire</text>
    <text x="383" y="36" text-anchor="middle">Historique de la conversation</text>
    <text x="557" y="36" text-anchor="middle">Fichiers</text>
    <text x="663" y="36" text-anchor="middle" opacity="0.6">Marge</text>
    <text x="0" y="74" opacity="0.65">Ce que vous contrôlez</text>
    <text x="700" y="74" text-anchor="end" opacity="0.65">Ce qui s'accumule tout seul</text>
  </g>
</svg>
```

::: notes
Le bloc qui grossit sans qu'on le voie, c'est l'historique. D'où la règle de la slide suivante.

Précision si on la demande : la fenêtre se compte en dizaines ou centaines de pages selon le modèle. Le problème pratique n'est presque jamais de la remplir — c'est ce qu'on y laisse traîner.
:::

---

## Pourquoi un long fil se dégrade
type: concept

« Il était bon ce matin, il est devenu bête. » Personne n'a changé de modèle. Le fil s'est encrassé.

Trois mécanismes, cumulatifs :

- **La dilution** — votre consigne du départ pèse de moins en moins face à quarante échanges.
- **Les instructions contradictoires** — « fais plus court », puis « développe ce point », puis « reprends comme avant ». Il les a toutes sous les yeux.
- **Les pistes abandonnées** — les trois versions que vous avez rejetées sont toujours là et continuent d'influencer la suivante.

**Rien de tout ça ne se répare en insistant.** Ça se répare en ouvrant un nouveau fil.

::: notes
Symptôme à faire reconnaître : quand on en est à répéter une consigne pour la troisième fois, c'est le signal. On repart d'un fil neuf en recollant seulement ce qui compte.

C'est le geste le moins appliqué et le plus rentable de tout le module.
:::

---

## Trois gestes qui changent tout
type: concept

### Ouvrir une nouvelle conversation
Une conversation qui a dérivé pollue tout ce qui suit. Nouveau sujet, nouveau fil.

### Joindre plutôt que coller
Un fichier joint est relu proprement, avec sa structure. Un tableau collé dans le chat perd ses colonnes et occupe la place.

### Nommer les sources
« D'après le fichier joint » et « d'après ce que tu sais » ne donnent pas la même réponse. Dites laquelle fait foi.

::: notes
Le premier geste est celui qu'on applique le moins et qui coûte le plus cher.

Le deuxième a une raison technique : un fichier joint conserve sa structure de données, un copier-coller l'aplatit en texte. Sur un tableau de trente colonnes, la différence est massive.
:::

---

## L'ordre compte
type: concept

Sur un document long, la position de votre question dans le prompt change le résultat.

- **Le document en premier**, en haut.
- **Votre question en dernier**, tout en bas.

Anthropic mesure jusqu'à **30 % de qualité en plus** avec la question à la fin, surtout quand plusieurs documents sont en jeu.

Et quand il y en a plusieurs, dites lequel est lequel : le nom du fichier, sa date, son statut. Un document sans étiquette est un document que le modèle confondra avec le voisin.

::: notes
Contre-intuitif : la plupart des gens écrivent leur question, puis collent le document dessous. C'est l'inverse qu'il faut faire.

Chiffre à citer, il crédibilise : c'est un écart mesuré en test, pas une préférence de style.
:::

---

## Faire citer avant de faire conclure
type: concept

Sur un document long, une demande en deux temps bat une demande directe :

1. « Relève d'abord les passages qui concernent ma question, et cite-les. »
2. « Ensuite, réponds en t'appuyant uniquement sur ces passages. »

Deux effets :

- Il se concentre sur la partie utile et ignore le reste du document.
- **Vous pouvez vérifier.** Les citations sont vraies ou fausses, contrairement à une synthèse.

::: notes
Technique recommandée par Anthropic pour les documents longs, et c'est aussi le meilleur garde-fou anti-hallucination disponible sans outil.

Le second effet est l'argument à retenir : une synthèse ne se vérifie pas, une citation se vérifie en dix secondes avec Ctrl+F.
:::

---

## Croiser plusieurs sources
type: concept

Le vrai travail commence quand la réponse exige **plusieurs sources à la fois** : {{client.mail}}, {{client.agenda}}, {{client.crm}}, un fichier.

Dans ce cas, le prompt doit dire trois choses :

1. **Où chercher quoi** — « les échanges dans {{client.mail}}, les montants dans {{client.crm}} »
2. **Qui gagne en cas de contradiction** — « {{client.crm}} fait foi sur le statut »
3. **Quoi faire si une source manque** — « signale-le, n'invente pas »

Sans le point 3, il comblera le trou. C'est le mécanisme du module 1 qui reprend la main.

::: notes
Le point 2 surprend le plus les participants, et c'est celui qui évite les rapports faux.

Exemple sur {{client.cas}} : si {{client.crm}} dit « signé » et le mail dit « en attente », lequel écrit-on dans le bilan ? Il n'y a pas de bonne réponse générale — il y a votre réponse, et il faut l'écrire une fois.
:::

---

## Le contexte qui ne se retape pas
type: concept

Une partie du contexte est **la même à chaque fois** : qui vous êtes, votre offre, vos clients, votre façon d'écrire.

Le retaper à chaque conversation, c'est le symptôme du niveau 1.

Ce contexte-là doit vivre **dans un fichier**, chargé automatiquement. C'est l'objet du module suivant.

::: notes
Transition vers la mémoire. Poser la question qui fait mal : « combien de fois par semaine réexpliquez-vous votre métier à l'outil ? »
:::

---

## Composer le contexte d'un livrable réel
type: atelier
livrable: La liste des sources de {{client.cas}}, avec l'ordre de priorité, la règle en cas de contradiction et la consigne de citation

Sur {{client.cas}} :

1. Listez toutes les sources nécessaires.
2. Dites pour chacune ce qu'elle apporte, et elle seule.
3. Fixez l'ordre de priorité en cas de contradiction.
4. Écrivez la phrase « si une source manque, alors… ».
5. Ajoutez la consigne de citation : qu'il relève les passages avant de conclure.
6. Lancez-le et vérifiez deux citations au hasard contre la source.

::: notes
Garder cette liste : elle devient le cœur du prompt de la tâche planifiée au module 10. C'est le même travail, fait une fois.

L'étape 6 installe le réflexe de contrôle par échantillon, qu'on retrouvera aux modules 7 et 10.
:::

---

## À retenir
type: recap

- Tout ce qui est dans la fenêtre pèse sur la réponse, y compris le bruit.
- Un long fil se dégrade par dilution, contradictions et pistes abandonnées. On repart d'un fil neuf.
- Joindre les fichiers, ne pas les coller.
- Document en haut, question en bas : jusqu'à 30 % de qualité en plus.
- Faire citer avant de faire conclure — c'est vérifiable, une synthèse ne l'est pas.
- Multi-sources : dire où chercher, qui fait foi, quoi faire si ça manque.
- Le contexte stable vit dans un fichier chargé automatiquement, plus besoin de le retaper.
