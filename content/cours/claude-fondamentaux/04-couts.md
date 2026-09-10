---
titre: Ce que ça coûte
duree: 35
objectif: Répondre à « combien ça coûte » et « laquelle est la moins chère », chiffres à l'appui
---

## Ce que ça coûte
type: titre

« Combien ça coûte ? »
La question arrive toujours. La réponse tient en deux factures.

::: notes
Question à poser au participant : « aujourd'hui, vous payez combien pour l'IA, et pour quoi ? »

La plupart paient un abonnement à 20 € et ignorent qu'il existe une deuxième façon de payer, à l'usage. Les deux slides suivantes séparent les deux.
:::

---

## Deux factures, à ne pas confondre
type: concept

**L'abonnement** — un forfait mensuel. Vous, dans l'application, toute la journée. C'est ce que paient la quasi-totalité des utilisateurs.

**Les jetons** — un paiement à la consommation, par tranche de texte traité. Il apparaît dès qu'une automatisation tourne **en dehors** de l'application : un workflow n8n, un script, une intégration maison.

{{client.prenom}} a besoin de connaître les deux : l'abonnement pour son usage quotidien, les jetons le jour où une routine sort de l'app.

::: notes
Le point à installer : tant qu'on reste dans l'app Claude, même les tâches planifiées sont couvertes par l'abonnement. Dès qu'on branche l'IA ailleurs (n8n, API), on passe au compteur à jetons.

Ces deux mondes ont des ordres de grandeur différents et ne se comparent pas directement.
:::

---

## L'abonnement : le prix est le même partout
type: concept

| | Gratuit | Petit palier | Usage sérieux | Intensif |
| --- | --- | --- | --- | --- |
| **Claude** | 0 € | — | Pro ~20 €/mois | Max dès 100 €/mois |
| **ChatGPT** | 0 € | Go 8 €/mois | Plus 20 €/mois | Pro 100 à 200 €/mois |
| **Gemini** | 0 € | AI Plus 5 €/mois | AI Pro 20 €/mois | AI Ultra 100 à 200 €/mois |

Pour un usage professionnel individuel, on est à **~20 €/mois chez les trois**. Le choix ne se joue pas sur ce chiffre.

::: notes
Prix de septembre 2026, ils bougent tous les six mois. Ce qui ne bouge pas : les trois sont alignés à ~20 € pour le palier « je m'en sers pour travailler ».

Le palier gratuit sert à essayer, pas à travailler : connecteurs limités, pas de tâches planifiées, plafonds bas.
:::

---

## Ce que « l'usage » veut dire
type: concept

Les plafonds ne se comptent pas en nombre de messages, mais en **fenêtres** : une réserve qui se recharge toutes les quelques heures.

- Le palier à 20 € suffit pour une journée de bureau normale.
- Le palier intensif donne 5 à 20 fois plus, pour ceux qui pilotent l'outil toute la journée.
- Une tâche planifiée dans l'app **puise dans la même réserve** que vos conversations, et une tâche pèse bien plus lourd qu'un échange.

Quand monter de palier : quand vous butez sur le plafond plusieurs fois par semaine.

::: notes
Prépare le module sur les tâches planifiées : deux ou trois tâches Cowork lourdes dans la journée peuvent vider un plan Pro avant le soir.

À ce moment-là, trois options : attendre la recharge, acheter un complément à l'usage, passer au palier au-dessus.
:::

---

## L'autre facture : le jeton
type: concept

Quand l'IA travaille via l'API, on paie au **jeton** — un petit morceau de texte, environ trois quarts d'un mot.

Trois repères suffisent :

- Une page de texte ≈ 500 mots ≈ **700 jetons**
- Un document de 40 pages ≈ **30 000 jetons**
- Ce que le modèle **écrit** coûte 4 à 5 fois plus cher que ce qu'il **lit**

Les prix s'affichent par **million de jetons**, en dollars.

::: notes
L'ordre de grandeur à ancrer : un million de jetons ≈ 1 400 pages. On raisonne toujours en « combien de pages je fais lire, combien j'en fais écrire ».

L'asymétrie lecture/écriture est la clé des slides suivantes : c'est la sortie qu'on surveille.
:::

---

## Les prix au jeton, à trois niveaux
type: concept

Par million de jetons, lecture / écriture :

| Niveau | Claude | ChatGPT | Gemini |
| --- | --- | --- | --- |
| **Haut de gamme** | Opus 5 — 5 / 25 | GPT-6 — 10 / 50 | 3.1 Pro — 2 / 12 |
| **Cheval de trait** | Sonnet 5 — 2 / 10 | Sol — 4 / 20 | Flash — 0,75 / 3,75 |
| **Économique** | Haiku 4.5 — 1 / 5 | Luna — 0,20 / 1,20 | Flash-Lite — 0,25 / 1,50 |

Sur le milieu et le haut de gamme, **Gemini est le moins cher au jeton**. Tout en bas, GPT Luna et Gemini Flash-Lite se tiennent.

::: notes
Ne pas apprendre les nombres, ils changent tous les trimestres. Retenir la forme : trois niveaux, et Google casse les prix sur le milieu et le haut.

La phrase de fin est le pivot du module — enchaîner directement.
:::

---

## Ce qui fait vraiment le coût d'une tâche
type: concept

Rappel du module 3 : un modèle récent réglé bas fait souvent le travail d'un ancien réglé haut, pour moins de jetons.

Le coût réel d'une tâche dépend de trois choses, dans cet ordre :

1. **Le nombre de fois où on la relance** — un résultat raté corrigé trois fois coûte plus qu'un bon résultat du premier coup sur un modèle « cher ».
2. **La quantité de contexte rechargée** à chaque tour.
3. **Le prix au jeton**, en dernier.

Le bon compteur : le coût **par tâche terminée**, pas par requête.

::: notes
L'erreur classique en entreprise : monter une usine à gaz à deux modèles pour économiser sur le jeton, alors qu'un seul bon modèle réglé correctement fait le travail du premier coup, sans la complexité.

Le temps humain passé à rattraper un mauvais résultat dépasse toujours l'écart de prix entre les trois fournisseurs.
:::

---

## Un cas chiffré
type: demo

Le bilan mensuel de {{client.cas}}, via une automatisation externe :

- Entrée : les trois sources ≈ 20 000 jetons
- Sortie : le bilan ≈ 2 000 jetons
- Sur un cheval de trait (Sonnet 5) : **0,06 $** l'exécution
- Douze fois par an : **moins d'un euro**

Le nettoyage du fichier de prospection, plus lourd : ≈ 200 000 jetons, soit **~0,50 $** l'opération.

Pour une TPE ou une PME, la facture au jeton d'une automatisation bien réglée se compte en euros par an.

::: notes
Refaire le calcul devant le participant sur son cas réel : 20 000 × 2 $/M pour la lecture, 2 000 × 10 $/M pour l'écriture. La peur du coût est presque toujours surdimensionnée.

Nuance à redire : ces montants supposent une automatisation externe. Dans l'app, c'est déjà compris dans l'abonnement.
:::

---

## Où la facture dérape vraiment
type: piege

Quatre façons de multiplier la note par dix ou plus :

- **La boucle qui relit tout** — un agent qui recharge tout l'historique à chaque étape.
- **L'effort au maximum par défaut** — sur des tâches qui n'en demandent pas.
- **Le gros contexte, cent fois** — une tâche planifiée qui recharge un dossier de 50 pages à chaque passage.
- **Le haut de gamme pour du tri** — sortir Opus ou GPT-6 pour classer des mails.

Chacune se corrige en une ligne. Encore faut-il la repérer.

::: notes
Table de dépannage. Le point commun des quatre : on paie pour du travail qui ne sert à rien.

Renvoyer au module 3 (l'effort) et au module 10 (le contexte rechargé par une tâche planifiée).
:::

---

## « Laquelle est la moins chère ? »
type: concept

La vraie réponse, en trois temps :

- **Abonnement** — égalité. ~20 €/mois chez les trois pour l'usage sérieux. Prenez celui dont l'écosystème colle à vos outils.
- **Au jeton** — Gemini sur le milieu et le haut de gamme. L'écart se réduit dès qu'on ajuste l'effort.
- **Coût total** — dominé par le temps humain de correction et de supervision, très au-dessus de l'écart de prix entre fournisseurs.

Choisir sur le seul prix affiché, c'est optimiser la plus petite ligne de la facture.

::: notes
Si le participant veut un chiffre unique : au niveau abonnement, l'écosystème tranche (Google si vous vivez dans Workspace, etc.). Au niveau API, Gemini est le moins cher, mais testez d'abord le modèle récent à effort bas avant de bâtir une architecture pour économiser trois centimes.
:::

---

## Estimer le coût de ses automatisations
type: atelier
livrable: Le coût annuel estimé de vos trois automatisations prévues, et la décision « abonnement ou API » pour chacune

Pour chacune des trois automatisations que vous voulez mettre en place :

1. Comptez les pages en entrée (les sources) et en sortie (le livrable).
2. Convertissez en jetons : une page ≈ 700.
3. Choisissez le niveau de modèle, multipliez par le prix au jeton.
4. Multipliez par la fréquence annuelle.
5. Tranchez : ça tourne dans l'app (abonnement) ou dehors (API) ?

::: notes
Pour {{client.prenom}} : le reporting mensuel, le nettoyage de prospection, la veille. Les trois tiennent probablement sous 20 € par an en jetons — le montrer noir sur blanc lève le dernier frein au passage à l'action.
:::

---

## À retenir
type: recap

- Deux factures : l'abonnement (dans l'app) et le jeton (automatisation externe).
- Abonnement : ~20 €/mois chez Claude, ChatGPT et Gemini pour l'usage sérieux. Le prix ne les départage pas.
- Une tâche planifiée dans l'app puise dans la réserve de l'abonnement, et elle pèse lourd.
- Au jeton, Gemini est le moins cher sur le milieu et le haut de gamme. Ce prix ne fait pas le coût d'une tâche.
- Le coût d'une tâche : d'abord le nombre de relances, puis le contexte rechargé, le prix au jeton en dernier.
- Pour une TPE ou une PME, une automatisation bien réglée coûte quelques euros par an en jetons.
- Le vrai coût, c'est le temps humain de correction. C'est lui qu'on optimise.

::: notes
Enchaîner sur le prompting : « le meilleur levier sur la facture, c'est un prompt qui donne le bon résultat du premier coup. »
:::
