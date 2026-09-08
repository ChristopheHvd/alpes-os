---
name: devis
description: Génère un devis ou une facture Alpes IA en PDF (branding, mentions légales, numérotation) à partir d'un brief. Déclencheurs - /devis, "fais un devis", "facture d'acompte", "facture de solde", "DEV-", "FAC-".
---

# /devis — Devis & factures Alpes IA

Produit un document commercial conforme au format des documents déjà envoyés
(Devis_AlpesIA_Tabouret_DEV-2026-004, Facture_Acompte_AlpesIA_Tabouret_FAC-2026-008).

## Sources à lire, dans l'ordre
1. `config/branding.json` — identité, SIRET, NDA, banque, mentions légales, numérotation.
2. `templates/document.html` — gabarit A4. Ne pas changer le style, remplir les `{{...}}`.
3. Second brain (`/Users/christophehavard/Code/second-brain`) via la logique de la skill
   `second-brain-recall` : `brain/clients/` pour l'identité du client, `brain/finance/`
   pour les devis existants et montants, `brain/projects/` pour le contexte.

## Étapes
1. **Lire le brief** (premier mot = `devis` ou `facture`). Extraire : client, prestation,
   dates, montant HT, acompte éventuel, échéance, devis associé.
2. **Compléter depuis le second brain** ce que le brief ne dit pas (adresse client, SIRET,
   email). Si une info reste inconnue, écrire `à compléter` — jamais inventer.
3. **Numéroter** : prochain numéro = `numbering.<type>.last + 1` dans `branding.json`,
   format `DEV-AAAA-NNN` / `FAC-AAAA-NNN` (3 chiffres). Après génération, incrémenter
   `last` dans `branding.json`.
4. **Remplir le gabarit** dans un HTML temporaire :
   - Devis : `DOC_TYPE=Devis`, META_3 = Validité (30 jours), META_4 = Date de démarrage
     prévue, `TOTAL_LABEL=Total`, section signature conservée, section schedule retirée
     sauf acompte prévu.
   - Facture d'acompte : `DOC_TYPE=Facture d'acompte`, META_3 = Date d'échéance
     (`defaultDueDays` jours), META_4 = Devis associé, schedule rempli (total, acompte,
     solde), signature retirée, `TOTAL_LABEL=Net à payer`.
   - Facture de solde : idem, subtitle "Solde de X % sur ...".
   - Lignes : `<tr><td>Désignation<small>détail</small></td><td class="n">1</td><td class="n">1 800,00 €</td><td class="n">1 800,00 €</td></tr>`.
   - Montants en français : `1 800,00 €`. TVA non applicable (art. 293 B), jamais de TVA.
   - Retirer les `<section data-optional>` inutiles.
5. **Générer le PDF** : `scripts/html2pdf.sh <tmp.html> output/devis/<Nom>.pdf`.
   Nom de fichier : `Devis_AlpesIA_<ClientCourt>_DEV-AAAA-NNN.pdf` ou
   `Facture_Acompte_AlpesIA_<ClientCourt>_FAC-AAAA-NNN.pdf` / `Facture_Solde_...`.
   Garder le HTML à côté du PDF (même nom, `.html`) pour retouche.
6. **Tracer dans le second brain** : ajouter ou mettre à jour la fiche
   `brain/finance/<client>-devis.md` (frontmatter OKF, statut `draft`, référence,
   montant, date) et une ligne datée dans `log.md`. Ne jamais mettre `status: verified`.
7. Terminer par une ligne `OUTPUT: <chemin absolu>` par fichier créé.

## Garde-fous
- Ne jamais envoyer, ne jamais toucher à Gmail ou Drive.
- Ne jamais inventer un montant : s'il manque, s'arrêter et l'écrire dans la sortie.
- Un seul document par run.

## Garde-fous git
- **Ne jamais lancer de commande git** : pas de `git add`, `git commit`, `git checkout`.
  Les fichiers sont laissés modifiés, Christophe committe lui-même sur la bonne branche.
- Écrire dans le second brain sans jamais y toucher aux branches.
