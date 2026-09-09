---
titre: Les skills
duree: 60
objectif: Utiliser les skills existantes et créer la sienne
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
- Une **procédure** : les étapes, les règles, ce qu'il ne faut pas faire
- Éventuellement des **fichiers joints** : un modèle, un exemple, un gabarit

Pas de code. Du texte, que vous relisez et corrigez comme une note.

::: notes
Le soulagement visible arrive ici : « ah, ce n'est pas du développement ». C'est le moment de le dire explicitement.
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

INTERDITS
Ne pas relancer sur le prix. Ne rien promettre qui ne
soit pas dans l'historique. Ne jamais inventer de date.
```

::: notes
Faire remarquer que c'est exactement le prompt en quatre blocs du module 3, structuré et rangé.

La section « Interdits » est celle qui manque presque toujours et qui fait la différence entre un résultat utilisable et un résultat à réécrire.
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

Test simple : lire la description et se demander « est-ce que je reconnaîtrais ma situation là-dedans ? ».
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

Objectif de cette séquence : qu'il voie ce qu'une skill produit avant d'essayer d'en écrire une.
:::

---

## Comment on en crée une
type: concept

**Toujours partir d'un prompt qui a déjà marché**, jamais de la page blanche.

1. Faire la tâche à la main, une fois, jusqu'à un résultat satisfaisant.
2. Relire l'échange : qu'est-ce qui a été nécessaire pour y arriver ?
3. Écrire la procédure : les étapes, dans l'ordre.
4. Ajouter les interdits, tirés de ce qui a raté au premier essai.
5. Écrire la description en dernier, une fois qu'on sait ce que ça fait.
6. La lancer sur un **autre** cas. Corriger. Recommencer.

::: notes
L'étape 6 est celle qu'on saute. Une skill validée sur un seul cas est une skill qui marche sur un seul cas.

L'étape 5 en dernier est contre-intuitive et importante : on ne sait pas décrire ce qu'on n'a pas encore écrit.
:::

---

## Ce qui distingue une bonne skill
type: concept

- Elle fait **une chose**. Une skill qui fait tout ne se déclenche jamais au bon moment.
- Elle dit **où chercher** l'information, pas seulement quoi produire.
- Elle contient des **interdits**, tirés d'échecs réels.
- Elle donne un **format de sortie** précis.
- Elle tient en **une page**. Au-delà, c'est deux skills.

::: notes
Reprendre le parallèle de la délégation : les mêmes critères qu'une consigne donnée à un collaborateur.
:::

---

## Écrire sa première skill
type: atelier
livrable: Une skill fonctionnelle, testée sur deux cas différents

Sur la tâche que vous refaites le plus souvent :

1. Faites-la à la main jusqu'à un bon résultat.
2. Écrivez la procédure en suivant l'anatomie.
3. Ajoutez trois interdits tirés de ce qui a raté.
4. Écrivez la description : quand, avec vos mots à vous.
5. Testez sur un cas différent du premier.
6. Corrigez ce qui a dérapé.

::: notes
Choisir avec {{client.prenom}} une tâche vraiment récurrente, pas la plus impressionnante. Une skill utilisée chaque semaine vaut mieux qu'une skill spectaculaire jamais rappelée.

Garder du temps pour l'étape 6 : c'est là que la compétence se transmet.
:::

---

## À retenir
type: recap

- Une skill, c'est un bon prompt rangé, nommé, qui se déclenche tout seul.
- Un dossier, du texte, pas de code.
- La description dit **quand**, avec vos mots. C'est elle qui déclenche.
- On part d'un prompt qui a marché, jamais de la page blanche.
- Une bonne skill fait une seule chose, tient en une page, liste ses interdits, et a été testée sur deux cas.
