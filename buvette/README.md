# Ma Buvette 🍺

Application de gestion de buvette (Burkina Faso) : stock, ventes, encaissements et bénéfices.

## Fonctionnalités

- **Stock à deux endroits** : réserve (casiers) et frigo, en casiers + bouteilles.
- **Approvisionnement** : achat de casiers (prix du casier, payé en espèces / Orange Money / Moov Money).
- **Chargement du frigo** : plusieurs boissons d'un coup, la réserve diminue et le frigo augmente.
- **Caisse rapide** : on touche les boissons, on choisit Espèces / Orange Money / Moov Money, on encaisse.
  Si le frigo ne suffit pas, le reste est pris dans la réserve.
- **Dépenses** : glace, électricité, loyer, salaire, transport…
- **Casse / pertes** et **inventaire** (comptage réel ; les manquants apparaissent dans le bilan).
- **Bilan** par jour, 7 jours, mois ou dates choisies : chiffre d'affaires, coût des boissons, bénéfice brut,
  dépenses, pertes, **bénéfice net**, encaissements par mode, caisse entrées − sorties, boissons les plus vendues.
- **Envoi du bilan sur WhatsApp**, journal de toutes les opérations (annulables), export Excel (CSV).
- Sauvegarde / restauration, fonctionne hors connexion, installable sur l'écran d'accueil.

## Calcul du bénéfice

Bénéfice sur les boissons = prix de vente − prix d'achat (du dernier approvisionnement) × bouteilles vendues.
Bénéfice net = bénéfice sur les boissons − dépenses − casse − manquants d'inventaire.

## Démarrage

Les boissons courantes sont déjà dans la liste (Brakina, So.b.bra, Castel, Flag, Guinness, Beaufort, sucreries, eau).
Pour chacune : onglet **Stock** → toucher la boisson → **Modifier / prix** pour mettre le prix d'achat du casier,
le prix de vente et le nombre de bouteilles par casier. Ajoutez ou supprimez des boissons selon votre buvette.
