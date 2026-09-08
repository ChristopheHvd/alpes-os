---
titre: Claude Code, la posture d'opérateur
duree: 45
objectif: Comprendre pourquoi le terminal change la façon de travailler, même sans être développeur
---

## La posture d'opérateur
type: titre

Claude Code, Codex : des outils de développeur
que des non-développeurs ont tout intérêt à ouvrir.

::: notes
Module qui décoiffe. Le poser d'emblée comme facultatif dans l'usage, obligatoire dans la compréhension : c'est là que se voit la différence entre utiliser l'IA et opérer un système.

Ne pas chercher à rendre le participant autonome sur le terminal en 45 minutes. L'objectif est qu'il sache ce que ça débloque.
:::

---

## Ce que le chat ne peut pas faire
type: concept

Dans une conversation, l'outil **répond**. Vous exécutez.

Dans un terminal, l'outil **agit** : il ouvre des fichiers, les modifie, lance des commandes, lit le résultat, corrige, recommence.

> La différence n'est pas la puissance du modèle. C'est qu'il a les mains.

::: notes
L'image des mains fonctionne bien. Le même modèle, le même prompt : dans un cas il décrit la solution, dans l'autre il l'applique et vérifie qu'elle marche.
:::

---

## Pourquoi ça concerne un non-développeur
type: concept

Ce qui vit dans des fichiers, il sait le traiter — et vos données vivent dans des fichiers.

- Traiter **un fichier de 40 000 lignes** que le chat ne peut pas avaler
- **Renommer, trier, fusionner** des centaines de documents
- Croiser **plusieurs exports** et produire un fichier propre
- Refaire le tout le mois suivant, à l'identique

Un export CRM, un fichier de prospection, un dossier de PDF : c'est du travail de fichiers, pas du développement.

::: notes
Cas concret à citer : {{client.fichier}}. Dédoublonner et enrichir ça dans un chat est pénible ; dans un terminal c'est une consigne et une vérification.
:::

---

## Le vrai apport : la boucle
type: concept

Dans un chat, la boucle passe par vous :

**demande → réponse → vous vérifiez → vous relancez**

Dans un terminal, la boucle se ferme toute seule :

**demande → action → il lit le résultat → il corrige → il recommence**

Vous n'intervenez qu'aux points de décision. C'est ça, opérer plutôt qu'exécuter.

::: notes
Point central du module. Si le participant ne retient qu'une chose, c'est celle-là.

Le montrer plutôt que le dire : lancer une tâche qui échoue au premier essai et laisser voir la correction automatique.
:::

---

## Ce que ça demande en échange
type: concept

- Un **dossier de travail** : les fichiers doivent être quelque part, pas en pièces jointes éparpillées
- Des **instructions permanentes** : le fichier de contexte du module 5, à la racine du projet
- Une **habitude de validation** : relire ce qui a été fait avant de garder
- Une **sauvegarde** : travailler sur une copie tant qu'on n'est pas à l'aise

Le quatrième point n'est pas négociable au début.

::: notes
Insister sur la copie de travail. La première fois qu'on laisse un outil modifier des fichiers en masse, on veut pouvoir revenir en arrière.
:::

---

## Une vraie tâche de fichiers
type: demo

Sur une copie de {{client.fichier}} :

- Décrire l'état voulu, pas les étapes : « un fichier par contact unique, doublons fusionnés, colonnes normalisées »
- Le laisser proposer sa méthode avant d'exécuter
- Le laisser tourner, lire le compte rendu
- Vérifier trois lignes au hasard contre la source

::: notes
La consigne « décrire l'état voulu, pas les étapes » est le pendant terminal du prompt en quatre blocs. C'est le bon niveau d'abstraction.

Vérifier trois lignes au hasard : le geste de contrôle qui doit devenir un réflexe.
:::

---

## Où ça s'arrête
type: concept

Ce n'est pas l'outil de tout le monde, et ce n'est pas grave.

- Si votre travail est surtout **relationnel**, restez sur l'application et les tâches planifiées.
- Si votre travail touche **des volumes de fichiers**, ouvrir le terminal change l'échelle.
- Dans tous les cas, **savoir que ça existe** évite de croire qu'un plafond est celui du modèle alors que c'est celui du chat.

::: notes
Terminer honnêtement. Vendre le terminal à quelqu'un qui n'en a pas besoin décrédibilise tout le reste de la journée.
:::

---

## À retenir
type: recap

- Dans un chat il répond, dans un terminal il agit : il a les mains.
- L'apport n'est pas la puissance, c'est la boucle qui se ferme sans vous.
- Ça concerne quiconque manipule des volumes de fichiers, développeur ou non.
- En échange : un dossier de travail, des instructions permanentes, une copie de sauvegarde.
- Décrire l'état voulu, pas les étapes. Puis vérifier au hasard.
