---
titre: Context engineering
duree: 40
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
:::

---

## Trois gestes qui changent tout
type: concept

### Ouvrir une nouvelle conversation
Une conversation qui a dérivé pollue tout ce qui suit. Nouveau sujet, nouveau fil.

### Joindre plutôt que coller
Un fichier joint est relu proprement. Un tableau collé dans le chat perd sa structure et occupe la place.

### Nommer les sources
« D'après le fichier joint » et « d'après ce que tu sais » ne donnent pas la même réponse. Dites laquelle fait foi.

::: notes
Le premier geste est celui qu'on applique le moins et qui coûte le plus cher. Symptôme typique : « il était bon ce matin, il est devenu bête ». Non — le fil est saturé.
:::

---

## Croiser plusieurs sources
type: concept

Le vrai travail commence quand la réponse exige **plusieurs sources à la fois** : {{client.mail}}, {{client.agenda}}, {{client.crm}}, un fichier.

Dans ce cas, le prompt doit dire trois choses :

1. **Où chercher quoi** — « les échanges dans {{client.mail}}, les montants dans {{client.crm}} »
2. **Qui gagne en cas de contradiction** — « {{client.crm}} fait foi sur le statut »
3. **Quoi faire si une source manque** — « signale-le, n'invente pas »

Sans le point 3, il comblera le trou.

::: notes
Le point 2 est celui qui surprend le plus les participants, et c'est celui qui évite les rapports faux.

Exemple sur {{client.cas}} : si {{client.crm}} dit « signé » et le mail dit « en attente », lequel écrit-on dans le bilan ?
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
livrable: La liste des sources de {{client.cas}}, avec l'ordre de priorité et la règle en cas de contradiction

Sur {{client.cas}} :

1. Listez toutes les sources nécessaires.
2. Dites pour chacune ce qu'elle apporte, et elle seule.
3. Fixez l'ordre de priorité en cas de contradiction.
4. Écrivez la phrase « si une source manque, alors… ».

::: notes
Garder cette liste : elle devient le cœur du prompt de la tâche planifiée au module 8. C'est le même travail, fait une fois.
:::

---

## À retenir
type: recap

- Tout ce qui est dans la fenêtre pèse sur la réponse, y compris le bruit.
- Nouvelle conversation à chaque changement de sujet.
- Joindre les fichiers, ne pas les coller.
- Multi-sources : dire où chercher, qui fait foi, quoi faire si ça manque.
- Le contexte stable vit dans un fichier chargé automatiquement, plus besoin de le retaper.
