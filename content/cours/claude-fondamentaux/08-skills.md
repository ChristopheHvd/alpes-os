---
titre: Les skills
duree: 60
objectif: Utiliser les skills existantes, créer la sienne, et savoir quand lui préférer autre chose
---

## Les skills
type: titre

À quoi ça sert, comment s'en servir,
comment fabriquer la sienne.

::: notes
Module le plus long de la journée. Séquence : le problème, ce que c'est, en utiliser une, en écrire une.

Ne pas commencer par la définition. Commencer par le problème, sinon ça reste abstrait.
:::

---

## Le problème
type: concept

Vous avez fini par écrire **le bon prompt**. Celui qui donne exactement le bon résultat.

Trois semaines plus tard, il est perdu dans un historique. Vous le réécrivez de mémoire, en moins bien.

Et si quelqu'un d'autre doit faire la même tâche, il repart de zéro.

> Une skill, c'est ce prompt-là, rangé, nommé, et qui se déclenche tout seul quand la situation se présente.

::: notes
Faire lever la main : qui a déjà perdu un bon prompt ? C'est unanime, et ça installe le module.
:::

---

## Ce que c'est, concrètement
type: concept

Un **dossier** avec un fichier d'instructions dedans. C'est tout.

- Un **nom**
- Une **description** qui dit quand l'utiliser
- Une **procédure** : les étapes, les règles, ce qu'il faut produire
- Éventuellement des **fichiers joints** : un modèle, un exemple, un gabarit

Pas de code. Du texte, que vous relisez et corrigez comme une note.

::: notes
Le soulagement visible arrive ici : « ah, ce n'est pas du développement ». C'est le moment de le dire explicitement.

Préciser aussi que c'est du texte **versionnable** : on peut le relire, le corriger, revenir en arrière, le partager. C'est ce qui en fait un actif d'entreprise et pas une astuce personnelle.
:::

---

## Skill, Project ou tâche planifiée ?
type: concept

Trois outils qu'on confond, pour trois problèmes différents :

| Vous voulez… | L'outil |
| --- | --- |
| Que le contexte d'un dossier soit toujours là | Un **Project** |
| Qu'une procédure se rejoue à l'identique, sur demande | Une **skill** |
| Que ça parte tout seul, sans vous | Une **tâche planifiée** |

Ils se combinent : une tâche planifiée qui lance une skill, à l'intérieur d'un Project.

::: notes
Confusion la plus fréquente du module. Un Project porte le *contexte*, une skill porte la *procédure*, une tâche planifiée porte le *déclencheur*.

Si le participant hésite, la question qui tranche : « est-ce que ça décrit une situation ou une suite d'étapes ? »
:::

---

## L'anatomie
type: concept

```
nom : relance-commerciale

description : Rédige une relance sur une affaire dormante.
  À utiliser quand une affaire n'a plus bougé depuis
  plus de deux semaines.

AVANT D'ÉCRIRE
Récupérer l'historique dans {{client.crm}} et les
derniers échanges dans {{client.mail}}.

RÉDACTION
Dix lignes maximum. Une seule question à la fin.
Rappeler un élément concret de la dernière discussion.
Le destinataire reçoit beaucoup de sollicitations :
ce qui marche, c'est court et précis.

LIMITES
N'engager que ce qui figure dans l'historique.
Ne jamais inventer de date. Sur le prix, dire que
vous revenez vers lui plutôt que d'avancer un chiffre.
```

::: notes
Faire remarquer que c'est exactement le prompt en quatre blocs du module 4, structuré et rangé — y compris la phrase de *pourquoi* dans la section rédaction.

La section « Limites » est celle qui manque presque toujours. Noter qu'elle est écrite en positif quand c'est possible : « dire que vous revenez vers lui » plutôt que « ne pas parler de prix ».
:::

---

## La description fait tout
type: concept

C'est la seule partie que l'outil lit **avant** de décider d'utiliser la skill.

| Mauvaise | Bonne |
| --- | --- |
| « Aide à la prospection » | « Rédige une relance sur une affaire dormante depuis plus de deux semaines » |
| « Gestion des devis » | « Génère un devis PDF à partir d'un brief : client, prestation, montant » |

Une bonne description dit **quand**, pas **quoi**. Elle contient les mots que vous emploierez le jour où vous en aurez besoin.

::: notes
Erreur la plus fréquente chez les débutants, et la plus frustrante : la skill existe, elle est bonne, elle ne se déclenche jamais.

Test simple : lire la description et se demander « est-ce que je reconnaîtrais ma situation là-dedans ? ». Si la description est écrite dans votre jargon interne mais que vous formulez autrement au quotidien, elle ne se déclenchera pas.
:::

---

## Utiliser ce qui existe déjà
type: demo

Avant d'en écrire une, se servir de celles qui existent :

- Préparation de rendez-vous à partir de {{client.agenda}} et {{client.crm}}
- Revue de pipeline et relances à faire
- Recherche sur un compte avant un premier contact
- Compte rendu d'entretien à partir de notes brutes

::: notes
Tester deux ou trois skills en direct sur les vrais dossiers du participant, pas sur un cas fictif.

Objectif de cette séquence : qu'il voie ce qu'une skill produit avant d'essayer d'en écrire une. Et qu'il repère ce qui ne lui convient pas — c'est le meilleur point de départ pour sa propre version.
:::

---

## Comment on en crée une
type: concept

**Toujours partir d'un prompt qui a déjà marché**, jamais de la page blanche.

1. Faire la tâche à la main, une fois, jusqu'à un résultat satisfaisant.
2. Relire l'échange : qu'est-ce qui a été nécessaire pour y arriver ?
3. Écrire la procédure : les étapes, dans l'ordre.
4. Ajouter les limites, tirées de ce qui a raté au premier essai.
5. Écrire la description en dernier, une fois qu'on sait ce que ça fait.
6. La lancer sur un **autre** cas. Corriger. Recommencer.

::: notes
L'étape 6 est celle qu'on saute. Une skill validée sur un seul cas est une skill qui marche sur un seul cas.

L'étape 5 en dernier est contre-intuitive et importante : on ne sait pas décrire ce qu'on n'a pas encore écrit.

L'étape 2 mérite qu'on s'y arrête : relire l'échange réussi, c'est là qu'on découvre qu'on a donné trois précisions à l'oral sans les noter.
:::

---

## Ce qui distingue une bonne skill
type: concept

- Elle fait **une chose**. Une skill qui fait tout ne se déclenche jamais au bon moment.
- Elle dit **où chercher** l'information, pas seulement quoi produire.
- Elle contient des **limites**, tirées d'échecs réels.
- Elle donne un **format de sortie** précis.
- Elle tient en **une page**. Au-delà, c'est deux skills.

::: notes
Reprendre le parallèle de la délégation : les mêmes critères qu'une consigne donnée à un collaborateur.

Le critère de la page n'est pas cosmétique : au-delà, on n'arrive plus à savoir quelle instruction a causé quel comportement quand ça dérape.
:::

---

## Une skill vieillit
type: piege

Ce qui la périme, dans l'ordre de fréquence :

- **L'offre a changé** et la skill vend encore l'ancienne.
- **L'outil source a changé** — un champ CRM renommé, un dossier déplacé.
- **Le modèle a changé** et la skill est sur-écrite pour l'ancien : des consignes qui bordaient un modèle de 2024 font sur-analyser celui d'aujourd'hui (module 4).

Le réflexe : quand une skill donne un résultat bizarre, relire la skill avant d'accuser le modèle.

::: notes
Le troisième point est nouveau et peu connu. Une skill écrite il y a dix-huit mois porte souvent des instructions défensives devenues contre-productives.

Conseil d'entretien : relire ses skills quand on change de modèle, comme on relit un contrat quand la loi change.
:::

---

## Écrire sa première skill
type: atelier
livrable: Une skill fonctionnelle, testée sur deux cas différents, avec ses limites écrites

Sur la tâche que vous refaites le plus souvent :

1. Faites-la à la main jusqu'à un bon résultat.
2. Relisez l'échange et notez ce que vous avez précisé en cours de route.
3. Écrivez la procédure en suivant l'anatomie.
4. Ajoutez trois limites tirées de ce qui a raté.
5. Écrivez la description : quand, avec vos mots à vous.
6. Testez sur un cas différent du premier. Corrigez ce qui a dérapé.

::: notes
Choisir avec {{client.prenom}} une tâche vraiment récurrente, pas la plus impressionnante. Une skill utilisée chaque semaine vaut mieux qu'une skill spectaculaire jamais rappelée.

Garder du temps pour l'étape 6 : c'est là que la compétence se transmet.
:::

---

## À retenir
type: recap

- Une skill, c'est un bon prompt rangé, nommé, qui se déclenche tout seul.
- Un dossier, du texte, pas de code — et c'est versionnable, donc partageable.
- Project = le contexte, skill = la procédure, tâche planifiée = le déclencheur.
- La description dit **quand**, avec vos mots. C'est elle qui déclenche.
- On part d'un prompt qui a marché, jamais de la page blanche.
- Une bonne skill fait une seule chose, tient en une page, liste ses limites, et a été testée sur deux cas.
- Une skill vieillit : quand le résultat devient bizarre, relire la skill avant d'accuser le modèle.
