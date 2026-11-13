# Caisse & Crédit 🍺📒

Application de gestion pour buvettes, maquis et boutiques du Burkina Faso. Elle réunit **Ma Buvette** et **Crédit Boutique** :
caisse, stock, production de glace, crédits clients avec rappels WhatsApp/SMS, dépenses et bénéfices.

## Fonctionnalités

- **Premier lancement guidé** : nom du commerce, numéro Orange Money / Moov Money, source d'énergie, fabrication de glace.
- **Caisse** : on touche les produits puis on choisit Espèces, Orange Money, Moov Money ou **Crédit** (le client est choisi ou créé sur place).
- **Stock** : réserve et frigo, en casiers et unités. Approvisionnement, chargement du frigo, inventaire, pertes et usage interne.
- **Produits fabriqués sur place** (glace, jus, eau…) : bouton **Production**. Les frais (eau, sachets) vont dans Dépenses.
- **Crédits clients** : reste à payer, échéance, retards, rappel **WhatsApp / SMS / Copier** pré-rédigé, paiements reçus par mode,
  crédits hors caisse (anciennes dettes, marchandises).
- **Dépenses adaptées à l'énergie** : solaire (entretien, batteries/panneaux/onduleur), SONABEL, groupe électrogène, ou mixte.
- **Solaire** : part du prix de l'installation comptée chaque mois dans le bénéfice (facultatif) et estimation de la facture SONABEL évitée.
- **Bilan** par période : ventes, coût des produits, dépenses, pertes, part solaire, **bénéfice net** ; argent encaissé par mode
  (ventes + crédits remboursés) ; crédits accordés et remboursés ; caisse entrées − sorties ; produits les plus vendus ; envoi sur WhatsApp.
- Journal de toutes les opérations (annulables), export Excel (CSV), sauvegarde / restauration, hors connexion, installable.

## Activités séparées

- 🍺 **Bar** : boissons (réserve + frigo) et glace fabriquée.
- 🍳 **Cuisine** : omelettes, Nescafé, Lipton… préparés à la demande, sans stock ; ingrédients dans Dépenses → Cuisine.
- 📶 **Wi-Fi** : forfaits 2 h (100 F), 12 h (200 F), 24 h (300 F), 1 semaine (1 000 F), 1 mois (3 000 F).
  Les tickets imprimés depuis le MikroTik sont enregistrés comme un stock ; « Compter les tickets » repère les tickets
  sortis sans être payés (comptés à leur prix de vente dans le bilan).
- 🔌 **Services** : recharge de téléphones, sans stock.

La caisse a un rayon par activité, les dépenses sont rangées par activité (ou en charges communes : énergie, loyer,
salaires, taxes) et le bilan donne le **bénéfice de chaque activité** puis le bénéfice net.

## Récupération des anciennes données

Sur le même site, les données de `buvette/` et `credit-boutique/` sont reprises automatiquement au premier lancement.

## Calculs

- Bénéfice sur les ventes = (prix de vente − prix d'achat) × quantités vendues (produits fabriqués : coût 0, frais dans Dépenses).
- Bénéfice net = bénéfice sur les ventes − dépenses − pertes − manquants d'inventaire − part de l'installation solaire.
- Une vente à crédit compte dans le chiffre d'affaires le jour de la vente ; l'argent compte dans « encaissé » le jour où le client paie.
