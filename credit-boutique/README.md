# Crédit Boutique 🇧🇫

Application de gestion des crédits clients pour les boutiques et commerces du Burkina Faso.

## Fonctionnalités

- **Clients** : nom, téléphone, quartier, note. Recherche par nom ou numéro.
- **Crédits** : le client prend des articles à crédit (montant, articles, date, échéance).
- **Encaissements** : le client rembourse (espèces, Orange Money, Moov Money…).
- **Reliquat** calculé automatiquement pour chaque client (total pris − total payé).
- **Retards** : les clients dont l'échéance est dépassée sont signalés.
- **Rappels WhatsApp et SMS** en un clic, avec un message pré-rédigé (modifiable dans Réglages).
- **Reçu WhatsApp** (🧾) pour chaque opération.
- **Tableau de bord** : total à encaisser, clients débiteurs, retards, encaissé du mois.
- **Sauvegarde / restauration** (fichier JSON) et **export Excel** (CSV).
- Fonctionne **hors connexion** et s'installe sur l'écran d'accueil du téléphone.
- Montants en FCFA, numéros burkinabè (+226) reconnus automatiquement (`70 12 34 56`).

## Utilisation

Ouvrir `index.html` dans un navigateur, ou mieux, héberger le dossier (par ex. GitHub Pages)
puis ouvrir le lien sur le téléphone et choisir « Ajouter à l'écran d'accueil ».

Pour tester en local :

```bash
cd credit-boutique
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

## Message de rappel

Mots-clés remplacés automatiquement : `{client}`, `{montant}`, `{boutique}`, `{echeance}`,
`{telephone}`, `{gerant}`.

## Données

Les données sont enregistrées **uniquement sur l'appareil** (stockage du navigateur).
Pensez à faire une sauvegarde régulière depuis *Réglages → Télécharger une sauvegarde*.
