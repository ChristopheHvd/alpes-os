---
titre: Claude Code, la posture d'opérateur
duree: 50
objectif: Comprendre ce que le terminal débloque, même sans être développeur
---

## La posture d'opérateur
type: titre

Claude Code, Codex : des outils de développeur
que des non-développeurs ont tout intérêt à ouvrir.

::: notes
Module qui décoiffe. Le poser d'emblée comme facultatif dans l'usage, obligatoire dans la compréhension : c'est là que se voit la différence entre utiliser l'IA et opérer un système.

Ne pas chercher à rendre le participant autonome sur le terminal en 50 minutes. L'objectif est qu'il sache ce que ça débloque.
:::

---

## De répondre à agir
type: concept

Dans une conversation, l'outil **répond**. Vous exécutez.

Dans un terminal, l'outil **agit** : il ouvre des fichiers, les modifie, lance des commandes, lit le résultat, corrige, recommence.

> Même modèle, même intelligence. La seule chose qui change : dans un terminal, il a les mains.

::: notes
L'image des mains fonctionne bien. Le même modèle, le même prompt : dans un cas il décrit la solution, dans l'autre il l'applique et vérifie qu'elle marche.
:::

---

## Le vrai déblocage : l'outil jetable
type: concept

Pour un non-développeur, l'intérêt n'est pas qu'il « sache coder ». C'est qu'il **fabrique un outil pour votre problème, s'en serve, et le jette.**

Vous demandez : « dédoublonne ce fichier de 40 000 lignes en considérant que deux contacts sont identiques si le mail correspond, ou si le nom et la société correspondent. »

Il écrit un petit programme qui fait exactement ça, sur vos règles à vous, le lance, et vous rend le fichier.

Aucun logiciel du marché ne fait exactement ça. Le vôtre, si — pour dix minutes de travail.

::: notes
C'est le point du module. Le sortir tôt, avant toute démonstration technique, sinon les gens décrochent sur le terminal.

Analogie : la différence entre acheter un meuble en kit et avoir un menuisier qui fabrique la pièce à la bonne dimension.

Rappel du module 1 : un modèle de langage ne sait pas compter. En écrivant un programme qui compte, il contourne sa propre faiblesse — c'est pour ça que le terminal est fiable sur les volumes là où le chat ne l'est pas.
:::

---

## Pourquoi ça concerne un non-développeur
type: concept

Ce qui vit dans des fichiers, il sait le traiter — et vos données vivent dans des fichiers.

- Traiter **un fichier de 40 000 lignes** que le chat ne peut pas avaler
- **Renommer, trier, fusionner** des centaines de documents
- Croiser **plusieurs exports** et produire un fichier propre
- Refaire le tout le mois suivant, à l'identique

Un export CRM, un fichier de prospection, un dossier de PDF : ça se manipule sans écrire une ligne de code.

::: notes
Cas concret à citer : {{client.fichier}}. Dédoublonner et enrichir ça dans un chat est pénible et peu fiable ; dans un terminal c'est une consigne et une vérification.

Le dernier point est celui qu'on sous-estime : le travail devient reproductible. Le mois suivant, c'est une commande, pas trois heures.
:::

---

## La boucle qui se ferme seule
type: concept

Dans un chat, la boucle passe par vous :

**demande → réponse → vous vérifiez → vous relancez**

Dans un terminal, la boucle se ferme toute seule :

**demande → action → il lit le résultat → il corrige → il recommence**

Vous n'intervenez qu'aux points de décision. C'est ça, opérer plutôt qu'exécuter.

::: notes
Point central du module. Si le participant ne retient qu'une chose, c'est celle-là.

Le montrer plutôt que le dire : lancer une tâche qui échoue au premier essai et laisser voir la correction automatique. L'échec visible suivi de la reprise vaut mieux qu'une démo qui marche du premier coup.
:::

---

## Ce que ça demande en échange
type: concept

- Un **dossier de travail** : les fichiers doivent être quelque part, pas en pièces jointes éparpillées
- Des **instructions permanentes** : le fichier de contexte du module 6, à la racine du projet
- Une **habitude de validation** : relire ce qui a été fait avant de garder
- Une **copie de sauvegarde** : travailler sur un double tant qu'on n'est pas à l'aise

Le quatrième point est le seul vraiment obligatoire au début.

::: notes
Insister sur la copie de travail. La première fois qu'on laisse un outil modifier des fichiers en masse, on veut pouvoir revenir en arrière.

Si le participant est à l'aise, mentionner le versionnage (git) comme la version industrielle de la copie de sauvegarde. Sinon, ne pas l'évoquer : ça ajoute une marche.
:::

---

## Une vraie tâche de fichiers
type: demo

Sur une copie de {{client.fichier}} :

- Décrire l'état voulu, pas les étapes : « un contact unique par ligne, doublons fusionnés, colonnes normalisées »
- Donner vos règles métier : ce qui fait qu'un doublon est un doublon, chez vous
- Le laisser proposer sa méthode avant d'exécuter
- Le laisser tourner, lire le compte rendu chiffré
- Vérifier trois lignes au hasard contre la source

::: notes
« Décrire l'état voulu, pas les étapes » est le pendant terminal du prompt en quatre blocs. C'est le bon niveau d'abstraction : vous connaissez le résultat voulu, il connaît le chemin.

La deuxième ligne est celle qu'on oublie : « doublon » n'a pas la même définition chez tout le monde, et c'est exactement là que se joue la qualité du résultat.

Vérifier trois lignes au hasard : le geste de contrôle qui doit devenir un réflexe.
:::

---

## Où ça s'arrête
type: concept

Tout le monde n'a pas besoin du terminal, et c'est très bien comme ça.

- Si votre travail est surtout **relationnel**, restez sur l'application et les tâches planifiées.
- Si votre travail touche **des volumes de fichiers**, ouvrir le terminal change l'échelle.
- Dans tous les cas, **savoir que ça existe** évite de croire qu'un plafond est celui du modèle alors que c'est celui du chat.

::: notes
Terminer honnêtement. Vendre le terminal à quelqu'un qui n'en a pas besoin décrédibilise tout le reste de la journée.

La troisième ligne est le vrai livrable de ce module pour un profil commercial : il saura reconnaître, dans six mois, un problème qui relève du terminal — et à qui le confier.
:::

---

## À retenir
type: recap

- Dans un chat il répond, dans un terminal il agit : il a les mains.
- Le déblocage pour un non-développeur : il fabrique un outil sur mesure, s'en sert, et le jette.
- En écrivant un programme qui compte, il contourne sa propre incapacité à compter.
- L'apport principal : la boucle essai-erreur se ferme sans vous.
- En échange : un dossier de travail, des instructions permanentes, une copie de sauvegarde.
- Décrire l'état voulu et vos règles métier, pas les étapes. Puis vérifier au hasard.
