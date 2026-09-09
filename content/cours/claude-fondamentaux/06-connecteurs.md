---
titre: Connecteurs
duree: 30
objectif: Brancher ses outils pour arrêter de faire le copier-coller
---

## Connecteurs
type: titre

Tant que vous copiez-collez vos données dans le chat,
vous êtes l'intégration.

::: notes
Formule à poser telle quelle, elle marque. C'est le module qui fait passer l'outil de « chatbot » à « collègue ».
:::

---

## Ce qu'un connecteur change
type: concept

Sans connecteur, vous cherchez l'information, vous la copiez, vous la collez, vous posez la question.

Avec connecteur, vous posez la question. **Il va chercher.**

- Il lit {{client.mail}} et {{client.agenda}}
- Il interroge {{client.crm}}
- Il ouvre les fichiers du Drive
- Il recoupe les trois et rend un livrable

Résultat : une question que vous ne vous seriez pas donné la peine de creuser à la main devient **posable** en dix secondes.

::: notes
Insister sur la dernière ligne. Personne ne compile trois sources à la main pour une question qu'il se pose en passant, donc la question reste dans un coin de la tête. Le connecteur la rend accessible.
:::

---

## Ce qu'il faut savoir avant de brancher
type: concept

Un connecteur donne un **accès réel** à des données réelles.

- Il agit **avec vos droits** : ce que vous voyez, il le voit.
- L'accès est **révocable** à tout moment, et se révoque en un clic.
- Certains connecteurs peuvent **écrire**, pas seulement lire.

La règle : **brancher en lecture d'abord.** L'écriture, seulement quand le flux est éprouvé.

::: notes
Question qui vient toujours chez un dirigeant : « et mes données ? ». Y répondre franchement et tôt, sinon elle parasite tout le reste de la journée.

Distinguer : donner un accès n'est pas céder la propriété des données. Et ce qui est branché se voit et se coupe.
:::

---

## Par où commencer
type: concept

Un seul connecteur à la fois, maîtrisé avant le suivant.

1. **La messagerie** — le gisement le plus dense, et le plus immédiat
2. **L'agenda** — donne le contexte temporel : qui, quand, à propos de quoi
3. **Les fichiers** — Drive ou dossier partagé, pour les documents de référence
4. **Le métier** — {{client.crm}} en dernier, parce que c'est celui qui demande le plus de cadrage

::: notes
L'ordre n'est pas négociable : brancher le CRM en premier est l'erreur classique, on se noie dans un modèle de données qu'on n'a pas cadré.
:::

---

## Brancher et vérifier
type: demo

En direct, sur le compte du participant :

- Brancher {{client.mail}} et {{client.agenda}}, en lecture
- Poser une question qui **exige** les deux : « qu'est-ce que j'ai promis en réunion et pas encore envoyé ? »
- Vérifier la réponse à la main, sur un cas connu
- Montrer où l'accès se révoque

::: notes
La vérification fait le vrai travail ici : elle installe la confiance, et le réflexe de toujours contrôler la première réponse.

Choisir volontairement une question dont on connaît la réponse.
:::

---

## Une question qui croise deux sources
type: atelier
livrable: Deux connecteurs actifs en lecture, et une question multi-sources vérifiée

1. Branchez deux connecteurs, en lecture seule.
2. Écrivez une question qui est impossible à répondre avec une seule des deux.
3. Posez-la.
4. Vérifiez le résultat à la main.
5. Notez l'écart, s'il y en a un, et ce qui l'explique.

::: notes
L'étape 5 est la plus formatrice. Un écart vient presque toujours d'un contexte manquant (module 4), rarement du connecteur.
:::

---

## À retenir
type: recap

- Sans connecteur, c'est vous l'intégration.
- Le vrai gain : des questions qu'on ne se posait pas deviennent posables.
- Le connecteur agit avec vos droits, et se révoque en un clic.
- Lecture d'abord, écriture quand le flux est éprouvé.
- Un connecteur à la fois : messagerie, agenda, fichiers, puis métier.
