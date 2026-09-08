---
titre: Prompting
duree: 45
objectif: Écrire une demande qui donne le bon résultat du premier coup
---

## Prompting
type: titre

Un prompt vague donne une réponse vague.
Ce n'est pas le modèle qui est décevant, c'est la commande.

::: notes
Faire ouvrir à {{client.prenom}} son historique et lire à voix haute un prompt raté. On le réécrira à la fin du module — c'est le fil rouge.
:::

---

## Le problème n'est pas où on croit
type: concept

« Fais-moi un mail de relance pour ce client. »

Le modèle doit deviner : quel ton, quelle longueur, quel historique, quelle relance (la première ? la troisième ?), quelle action attendue, quelle signature.

Il devine six fois. Il se trompe au moins une fois. Vous réécrivez.

**Le temps que vous croyez gagner en écrivant vite, vous le perdez en réécrivant.**

::: notes
Ne pas enchaîner tout de suite sur la solution. Laisser le constat s'installer, éventuellement en montrant le résultat générique que ça produit.
:::

---

## Les quatre blocs
type: concept

### Contexte
Qui vous êtes, la situation, ce que le modèle doit savoir pour ne pas inventer.

### Tâche
Ce que vous voulez, en un verbe. Une seule tâche par demande.

### Format
La forme attendue : longueur, structure, support. « Trois puces », « un tableau », « un mail de dix lignes ».

### Contraintes
Ce qu'il ne doit pas faire. Le ton à éviter, les mots interdits, ce qu'on ne promet pas.

::: notes
Le bloc le plus oublié est Contraintes, et c'est celui qui rend le résultat publiable sans réécriture.

Le bloc le plus mal fait est Tâche : les gens en mettent trois dans une phrase.
:::

---

## Le même besoin, écrit correctement
type: concept

```
CONTEXTE
Je suis {{client.metier}}. Le client X est en discussion depuis
deux mois, on s'est vus au salon, il a demandé un devis puis n'a
plus répondu depuis trois semaines. Historique en pièce jointe.

TÂCHE
Rédiger une relance par mail.

FORMAT
Dix lignes maximum, objet compris. Une seule question à la fin.

CONTRAINTES
Ne pas relancer sur le prix. Pas de « je me permets de revenir
vers vous ». Ne rien promettre qui ne soit pas dans l'historique.
```

::: notes
Faire remarquer que ça prend trente secondes à écrire et que ça évite trois allers-retours.

Enchaîner immédiatement sur le fait qu'on ne réécrit pas ça à chaque fois : c'est un modèle qu'on enregistre.
:::

---

## Une seule tâche à la fois
type: concept

Ce qui casse le plus souvent un prompt : **l'empilement.**

> « Analyse ce fichier, sors-moi les doublons, écris un mail à chacun et mets à jour {{client.crm}}. »

Quatre tâches. Le modèle en fait deux bien, une mal, oublie la dernière — et vous ne savez pas laquelle a échoué.

Découpez. Une demande, un résultat, une vérification.

::: notes
C'est le même principe qu'en délégation humaine. Analogie utile avec un dirigeant : personne ne confie quatre missions dans une phrase à un nouveau collaborateur.

Cette règle redevient centrale au module 8, quand on automatise.
:::

---

## Le modèle réutilisable
type: demo

Ce qu'on met en place, en direct :

- Un **prompt maître** enregistré une fois, avec les quatre blocs pré-remplis
- Déclenché par un raccourci système (`/prompt`) depuis n'importe quelle application
- Le bloc Contexte déjà rempli avec votre métier et votre entreprise
- Il ne reste qu'à compléter Tâche et Format

::: notes
Montrer la création du raccourci sur la machine du participant, pas sur la mienne. Le geste doit être refait seul.

Sur macOS : Réglages > Clavier > Saisie de texte > Remplacement. Sur Windows : n'importe quel gestionnaire de presse-papiers.
:::

---

## Corriger plutôt que recommencer
type: concept

Quand le résultat est à côté, ne relancez pas de zéro. **Dites ce qui ne va pas.**

- « Trop long, moitié moins. »
- « Le ton est trop commercial, plus factuel. »
- « Tu as inventé le chiffre du deuxième paragraphe, retire-le. »

La deuxième version est presque toujours la bonne. La troisième est rarement meilleure que la deuxième — à ce stade, le problème est dans le prompt de départ.

::: notes
Règle pratique : deux corrections maximum. Au-delà, on reprend le prompt initial, on ne bricole pas la réponse.
:::

---

## Réécrire son propre prompt raté
type: atelier
livrable: Un prompt maître enregistré et un prompt raté réécrit en quatre blocs

1. Reprenez le prompt raté de tout à l'heure.
2. Réécrivez-le avec les quatre blocs.
3. Lancez les deux versions côte à côte.
4. Enregistrez le squelette comme prompt maître.

::: notes
Faire constater l'écart au participant plutôt que le commenter. S'il n'y a pas d'écart visible, c'est que le prompt de départ était déjà bon — prendre un cas plus difficile, typiquement {{client.cas}}.
:::

---

## À retenir
type: recap

- Un prompt vague donne une réponse vague : le modèle devine, et devine mal.
- Quatre blocs : contexte, tâche, format, contraintes.
- Une seule tâche par demande.
- Corriger en deux passes maximum, sinon reprendre le prompt.
- Le squelette s'enregistre une fois et se réutilise toujours.
