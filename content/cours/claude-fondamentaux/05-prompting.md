---
titre: Prompting
duree: 60
objectif: Écrire une demande qui donne le bon résultat du premier coup, sur les modèles d'aujourd'hui
---

## Prompting
type: titre

Un prompt vague donne une réponse vague.
Mais un prompt trop bavard donne aussi une mauvaise réponse — et ça, c'est nouveau.

::: notes
Faire ouvrir à {{client.prenom}} son historique et lire à voix haute un prompt raté. On le réécrira à la fin du module, c'est le fil rouge.

Prévenir tout de suite : une partie de ce qu'on lisait sur le prompting il y a deux ans est aujourd'hui contre-productive. C'est le sujet de la première slide.
:::

---

## Ce qui a changé en 2026
type: concept

Les conseils de prompting qui circulent datent des modèles de 2023-2024, qui comprenaient mal et qu'il fallait border. Les trois grands fournisseurs disent maintenant l'inverse.

- **Anthropic** — « Retirez le sur-prompting. Les outils qui se déclenchaient trop peu avant se déclenchent maintenant correctement. Une instruction comme *en cas de doute, utilise X* va provoquer un sur-déclenchement. »
- **Google** — « Gemini 3 est un modèle de raisonnement, ça change la façon de prompter. Soyez concis. Il peut **sur-analyser** les techniques de prompt engineering verbeuses utilisées pour les anciens modèles. »
- **OpenAI** — les modèles récents suivent mieux les instructions littérales, et posent une question quand une précision changerait le résultat.

::: notes
Slide fondatrice du module. Si le participant a suivi une formation IA il y a deux ans, une partie de ce qu'il a appris le dessert aujourd'hui.

L'exemple qui parle : les longues litanies de « tu es un expert de 20 ans d'expérience, tu dois absolument, ne fais surtout pas… » — ça marchait, ça nuit maintenant.
:::

---

## Tout ce que le modèle doit deviner
type: concept

« Fais-moi un mail de relance pour ce client. »

Il doit deviner : quel ton, quelle longueur, quel historique, quelle relance (la première ? la troisième ?), quelle action attendue, quelle signature.

Six devinettes. Il se trompe au moins une fois. Vous réécrivez.

**Trois minutes gagnées à l'écriture, dix perdues à réécrire.**

::: notes
Ne pas enchaîner tout de suite sur la solution. Laisser le constat s'installer, en montrant si possible le résultat générique que ça produit.

Compter les devinettes à voix haute avec le participant sur *son* prompt raté : c'est plus efficace que sur l'exemple.
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

### Cadrage
Le ton visé, ce qui compte, ce sur quoi on ne s'engage pas — **formulé en positif**. C'est l'objet des deux slides qui suivent.

::: notes
Le squelette n'a pas changé. Ce qui a changé, c'est le quatrième bloc : on l'appelait « Contraintes » et on y mettait une liste d'interdits. Aujourd'hui la formulation positive marche mieux.

Le bloc le plus mal fait reste Tâche : les gens en mettent trois dans une phrase.
:::

---

## Dire ce qu'il faut faire, pas ce qu'il faut éviter
type: concept

Une interdiction oblige le modèle à se représenter la chose interdite. Une consigne positive lui donne directement la cible.

| Au lieu de | Écrivez |
| --- | --- |
| « N'utilise pas de listes à puces » | « Rédige en paragraphes qui s'enchaînent » |
| « Ne sois pas trop commercial » | « Reste factuel, décris ce qui a été fait » |
| « Ne fais pas trop long » | « Dix lignes maximum, objet compris » |

C'est la recommandation explicite d'Anthropic, et elle vaut chez les trois.

::: notes
Faire l'exercice à l'oral sur deux interdits que le participant utilise couramment. La conversion est facile et l'effet est immédiat.

Nuance à donner si quelqu'un objecte : les interdits absolus et non négociables restent utiles (« ne jamais inventer de date »). Ce qu'on retire, ce sont les interdits de style, qui se formulent mieux en positif.
:::

---

## Donner le pourquoi
type: concept

Une règle seule s'applique bêtement. Une règle **avec sa raison** se généralise aux cas que vous n'avez pas prévus.

L'exemple d'Anthropic :

> « N'utilise jamais de points de suspension. »

> « Ta réponse sera lue par une synthèse vocale, qui ne sait pas les prononcer. N'utilise donc jamais de points de suspension. »

Avec la seconde version, le modèle évite aussi les emojis, les tableaux et les abréviations — que personne n'avait pensé à interdire.

::: notes
C'est la technique au meilleur rapport effort/résultat de tout le module. Une phrase de contexte en plus, et le modèle couvre des cas que vous n'aviez pas anticipés.

Application directe pour {{client.prenom}} : « ce mail part à un dirigeant qui reçoit cent sollicitations par semaine » en dit plus que trois consignes de ton.
:::

---

## L'exemple vaut mieux que la consigne
type: concept

Décrire un ton en trois adjectifs marche mal. **Montrer** deux mails que vous trouvez bons marche très bien.

- **Trois à cinq exemples**, pas un seul : avec un seul, le modèle copie les détails accidentels.
- **Variés** : couvrez les cas limites, pas trois fois la même situation.
- **Délimités** : encadrez-les (`<exemple>…</exemple>`) pour qu'il ne les confonde pas avec la consigne.

::: notes
La règle des 3 à 5 vient de la documentation Anthropic. Avec un exemple unique, le modèle reproduit la longueur, la structure de phrase et jusqu'aux formules de politesse du cas fourni.

Astuce à donner : le participant peut demander au modèle d'évaluer ses propres exemples (« sont-ils assez variés ? ») avant de s'en servir.
:::

---

## Le même besoin, écrit correctement
type: concept

```
CONTEXTE
Je suis {{client.metier}}. Le client X est en discussion depuis
deux mois, on s'est vus au salon, il a demandé un devis puis n'a
plus répondu depuis trois semaines. Historique en pièce jointe.
Il reçoit beaucoup de sollicitations : ce qui marche avec lui,
c'est court et concret.

TÂCHE
Rédiger une relance par mail.

FORMAT
Dix lignes maximum, objet compris. Une seule question à la fin.

CADRAGE
Reste factuel et rappelle un élément précis de notre dernière
discussion. N'engage que ce qui figure dans l'historique.
```

::: notes
Faire remarquer les deux ajouts par rapport à la version « ancienne école » : la phrase de contexte qui explique *pourquoi* il faut faire court, et le cadrage en positif.

Ça prend trente secondes à écrire et ça évite trois allers-retours. Enchaîner immédiatement : on ne réécrit pas ça à chaque fois, c'est un modèle qu'on enregistre.
:::

---

## Une seule tâche à la fois
type: concept

Ce qui casse le plus souvent un prompt : **l'empilement.**

> « Analyse ce fichier, sors-moi les doublons, écris un mail à chacun et mets à jour {{client.crm}}. »

Quatre tâches. Le modèle en fait deux bien, une mal, oublie la dernière — et vous ne savez pas laquelle a échoué.

Découpez. Une demande, un résultat, une vérification.

::: notes
Même principe qu'en délégation humaine. Analogie utile avec un dirigeant : personne ne confie quatre missions dans une phrase à un nouveau collaborateur.

Cette règle redevient centrale au module 10, quand on automatise : une tâche planifiée qui empile quatre étapes est indébogable.
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
Montrer la création du raccourci sur la machine du participant, pas sur la mienne. Le geste doit pouvoir être refait seul.

Sur macOS : Réglages > Clavier > Saisie de texte > Remplacement. Sur Windows : n'importe quel gestionnaire de presse-papiers.
:::

---

## Quand le résultat est à côté
type: concept

Ne relancez pas de zéro. Dites ce qui ne va pas, et diagnostiquez :

| Ce que vous voyez | Ce qui manque presque toujours |
| --- | --- |
| Réponse générique, plate | Le contexte : il ne sait rien de votre situation |
| Chiffres ou faits inventés | La source : vous ne lui avez rien donné à lire |
| Trop long, trop prudent | Le format, ou un cran de raisonnement trop haut |
| Il oublie la moitié | Trop de tâches dans une seule demande |
| Le ton sonne faux | Des exemples : décrire ne suffit pas |

Deux corrections maximum. Au-delà, le problème est dans le prompt de départ : reprenez-le.

::: notes
Table à photographier. Elle sert de grille de dépannage après la formation.

La ligne « trop long, trop prudent » fait le lien avec le module 3 : c'est souvent un problème de cran, pas de prompt.
:::

---

## Ce qui diffère d'un fournisseur à l'autre
type: concept

Le squelette est le même partout. Trois particularités à connaître :

- **Claude Opus 5** répond plus long que les autres par défaut, et monter ou baisser le cran de raisonnement n'y change pas grand-chose. Demandez explicitement la concision.
- **Gemini 3** est déjà peu bavard et **sur-analyse les prompts verbeux**. Un long préambule de cadrage y nuit plus qu'ailleurs.
- **Les modèles OpenAI récents** suivent les instructions très littéralement et posent une question quand une précision changerait le résultat — laissez-leur cette latitude au lieu de tout verrouiller.

::: notes
Ne pas transformer ça en tableau comparatif exhaustif, ça sera périmé dans six mois. Ce qui compte, c'est que le participant sache qu'un prompt calibré sur un modèle demande un ajustement sur un autre.

Le point Gemini surprend toujours : la même consigne détaillée qui aide chez l'un dégrade chez l'autre.
:::

---

## Réécrire son propre prompt raté
type: atelier
livrable: Un prompt maître enregistré, et un prompt raté réécrit avec le pourquoi et le cadrage positif

1. Reprenez le prompt raté de tout à l'heure.
2. Comptez les devinettes qu'il impose au modèle.
3. Réécrivez-le avec les quatre blocs.
4. Ajoutez **une phrase de pourquoi** dans le contexte.
5. Convertissez chaque interdit en consigne positive.
6. Lancez les deux versions côte à côte, puis enregistrez le squelette.

::: notes
Faire constater l'écart au participant plutôt que le commenter. S'il n'y a pas d'écart visible, c'est que le prompt de départ était déjà bon : prendre un cas plus difficile, typiquement {{client.cas}}.

Les étapes 4 et 5 sont les nouvelles. Vérifier qu'elles sont vraiment faites, c'est là que se joue le gain.
:::

---

## À retenir
type: recap

- Le sur-prompting nuit aujourd'hui : les modèles récents n'ont plus besoin d'être bordés.
- Quatre blocs : contexte, tâche, format, cadrage.
- Dire ce qu'il faut faire plutôt que ce qu'il faut éviter.
- Donner le pourquoi d'une règle : le modèle généralise aux cas non prévus.
- Trois à cinq exemples valent mieux qu'une description de ton.
- Une seule tâche par demande, deux corrections maximum.
- Un prompt calibré sur un modèle se réajuste en changeant de fournisseur.
