---
titre: Connecteurs
duree: 40
objectif: Brancher ses outils, comprendre ce que ça engage, et vérifier ce qui en sort
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

Exemples de questions qui n'existaient pas avant : « qui n'a pas répondu depuis trois semaines et avait un devis en cours ? », « qu'est-ce que j'ai promis en réunion la semaine dernière et pas encore envoyé ? »
:::

---

## Ce qu'un connecteur est vraiment
type: concept

Techniquement, une autorisation d'accès délivrée par l'outil source — pas une copie de vos données.

Trois propriétés qui en découlent :

- **Il agit avec vos droits.** Ce que vous voyez, il le voit. Ce que vous ne voyez pas reste invisible.
- **Il lit à la demande.** Rien n'est aspiré à l'avance : il interroge quand la question l'exige.
- **L'accès se coupe en un clic**, dans les réglages de l'outil source, sans rien désinstaller.

::: notes
Ces trois points sont la réponse à l'objection qui vient toujours chez un dirigeant : « et mes données ? ». Y répondre franchement et tôt, sinon la question parasite tout le reste de la journée.

Distinguer explicitement : donner un accès n'est pas céder la propriété des données. Et ce qui est branché se voit et se coupe.

Si l'entreprise a une politique de sécurité, c'est le moment de la nommer — pas de la contourner.
:::

---

## Lire ou écrire : deux engagements différents
type: concept

| | Ce qui peut mal tourner | Réversible ? |
| --- | --- | --- |
| **Lecture** | Il lit une information hors périmètre, ou périmée | Oui, rien n'a bougé |
| **Écriture** | Il crée, modifie ou envoie quelque chose de faux | Parfois. Un mail parti ne revient pas |

La règle : **brancher en lecture d'abord.** L'écriture, seulement quand le flux est éprouvé — et jamais vers l'extérieur sans validation humaine.

::: notes
Cette règle est la première apparition de la règle d'architecture du module 10. L'annoncer comme telle, ça prépare le terrain.

Cas réel à raconter si besoin : la première automatisation d'un commercial est presque toujours « envoyer des relances tout seul ». C'est exactement celle qu'il ne faut pas faire en premier.
:::

---

## Par où commencer
type: concept

Un seul connecteur à la fois, maîtrisé avant le suivant.

1. **La messagerie** — le gisement le plus dense, et le plus immédiat
2. **L'agenda** — donne le contexte temporel : qui, quand, à propos de quoi
3. **Les fichiers** — Drive ou dossier partagé, pour les documents de référence
4. **Le métier** — {{client.crm}} en dernier, parce qu'il demande le plus de cadrage

::: notes
L'ordre n'est pas décoratif. Brancher le CRM en premier est l'erreur classique : on se noie dans un modèle de données qu'on n'a pas cadré, avec des champs personnalisés, des statuts maison et trois façons de nommer la même chose.

La messagerie et l'agenda, eux, ont une structure universelle. On apprend le mécanisme dessus, puis on attaque le métier.
:::

---

## Ce qui casse en pratique
type: piege

Quatre pannes courantes, et ce qu'elles veulent dire :

| Symptôme | Cause |
| --- | --- |
| « Je ne trouve rien » sur une donnée qui existe | Le périmètre autorisé est plus étroit que vous ne croyez |
| Des données visiblement anciennes | Un cache, ou une synchro côté outil source |
| Il ne voit qu'une partie du CRM | Des champs personnalisés non exposés par le connecteur |
| Ça marche chez vous, pas chez un collègue | Ses droits ne sont pas les vôtres |

Aucune de ces pannes ne se corrige côté prompt. Elles se corrigent côté accès.

::: notes
Table utile après la formation. Le réflexe à installer : quand une réponse semble incomplète, vérifier l'accès avant de réécrire le prompt.

La dernière ligne est celle qui pose problème en équipe : une automatisation construite avec vos droits ne produira pas le même résultat lancée par quelqu'un d'autre.
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

Choisir volontairement une question dont on connaît la réponse — sinon on ne peut rien conclure du résultat.
:::

---

## Une question qui croise deux sources
type: atelier
livrable: Deux connecteurs actifs en lecture, une question multi-sources vérifiée, et l'écart expliqué

1. Branchez deux connecteurs, en lecture seule.
2. Écrivez une question impossible à répondre avec une seule des deux.
3. Posez-la.
4. Vérifiez le résultat à la main.
5. Notez l'écart, s'il y en a un, et classez-le : accès, contexte, ou prompt.

::: notes
L'étape 5 est la plus formatrice, et le classement en trois causes est ce qu'il faut retenir. Un écart vient presque toujours d'un accès trop étroit ou d'un contexte manquant (module 6), rarement du prompt.

Si le participant conclut « l'outil est mauvais », c'est qu'on a sauté cette étape.
:::

---

## À retenir
type: recap

- Sans connecteur, c'est vous l'intégration.
- Le vrai gain : des questions qu'on ne se posait pas deviennent posables.
- Un connecteur est une autorisation, pas une copie. Il agit avec vos droits et se coupe en un clic.
- Lecture d'abord ; l'écriture quand le flux est éprouvé, jamais vers l'extérieur sans validation.
- Un connecteur à la fois : messagerie, agenda, fichiers, puis métier.
- Réponse incomplète ? Vérifier l'accès avant de réécrire le prompt.
