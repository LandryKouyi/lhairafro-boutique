# L'Hair Afro — Boutique en ligne

Boutique e-commerce de **L'Hair Afro** (« The Afro beauty concept store », Libreville) :
salon de coiffure + vente de produits capillaires/cosmétiques. ~10 produits, deux modes
de paiement : **Mobile Money (Airtel/Moov via PVit)** et **paiement à la livraison**.

Ce projet transforme la maquette statique validée par la cliente (dossier
`Prospection Refonte Web Gabon/landings/public/l-hair-afro/`) en une vraie boutique
avec backend : mêmes look, charte et structure produits, mais commandes enregistrées
en base et paiement Mobile Money branché sur PVit.

## Pile technique

- **Node.js + Express** (aucun framework front — HTML/CSS/JS servis statiquement).
- **`node:sqlite`** (module intégré, dès Node 22.5) — pas de dépendance native
  (contrainte machine : pas de compilateur C++). Base sur disque.
- **PVit / MyPVit** pour le Mobile Money (service porté depuis Klass-app).

## Démarrer en local

```bash
# 1. Dépendances (SSL antivirus : --use-system-ca obligatoire sur cette machine)
NODE_OPTIONS=--use-system-ca npm install

# 2. (facultatif) copier le modèle d'environnement
cp .env.example .env

# 3. Lancer
npm start          # -> http://localhost:3000
```

Sans `PVIT_API_PASSWORD` renseigné, le paiement Mobile Money est **désactivé
proprement** : le mode « à la livraison » fonctionne, et le mode Mobile Money bascule
sur une confirmation WhatsApp. C'est le comportement attendu en local (l'initiation
PVit exige un endpoint HTTPS public — voir `DEPLOIEMENT.md`).

## Structure

```
server.js                 point d'entrée (écoute PORT)
render.yaml               blueprint de déploiement Render
.env.example              modèle de variables d'environnement
src/
  config.js               config centrale (env + défauts PVit L'Hair Afro TEST)
  app.js                  Express : routes API + front statique + erreurs
  db/
    index.js              node:sqlite — schéma + amorçage catalogue (10 placeholders)
    migrate.js            « npm run migrate » / étape de démarrage prod
  services/
    pvit.js               intégration PVit (porté de Klass-app, adapté)
    pvitSecret.js         magasin mémoire de la clé secrète éphémère
  controllers/
    boutiqueController.js /api/produits, /api/boutique
    commandeController.js /api/commandes, statut, webhook + réception clé PVit
public/
  index.html              accueil (présentation boutique)
  boutique.html           catalogue + panier drawer + checkout 2 modes
  assets/beaute.jpg       image du hero (issue de la maquette validée)
```

## API

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/health` | Santé du service |
| GET | `/api/boutique` | Nom, WhatsApp, `mobileMoneyActif` |
| GET | `/api/produits` | Catalogue (produits actifs) |
| POST | `/api/commandes` | Crée une commande (mobile_money ou livraison) |
| GET | `/api/commandes/:reference/statut` | État d'une commande (rafraîchit via PVit) |
| POST | `/api/pvit-callback` | **Webhook PVit** (statut définitif) — PUBLIC |
| POST | `/api/pvit-secret` | **Réception de la clé secrète PVit** — PUBLIC |

Le montant est **toujours recalculé côté serveur** depuis le catalogue (le client ne
peut pas imposer un prix). La référence PVit est dérivée en alphanumérique ≤ 20 car.

## Contenu à compléter par la cliente (Ludmilla)

Les 10 produits, prix et catégories sont des **placeholders réalistes** repris de la
maquette validée. Photos, noms définitifs et prix seront remplacés par les vrais.
La colonne `image` de la table `produits` accepte une URL de photo (sinon un emoji
sert de vignette). Un espace de gestion (dashboard cliente) n'est pas encore inclus
dans cette coquille — à ajouter dans une itération ultérieure.

## Déploiement

Voir **`DEPLOIEMENT.md`** — checklist pas-à-pas (Render payant + domaine
`lhairafro.com` + création des 2 URLs PVit + mot de passe API + 4 transactions test).
