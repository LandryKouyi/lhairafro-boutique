# Arrière-boutique L'Hair Afro — espace de gestion de Ludmilla

L'arrière-boutique est l'**espace de gestion autonome** promis dans la convention
KLASS Studio : la gérante Ludmilla y gère elle-même son catalogue, ses photos et
ses commandes, sans passer par nous.

- **Page** : `https://lhairafro.com/admin` (aussi `/admin.html`)
- **Accès** : mot de passe unique (voir §3). Page en `noindex` (non référencée).
- **Charte** : identique à la boutique (rose `#d63384`, violet `#8e2de2`, fond `#f6f8fa`).

---

## 1) Ce que Ludmilla peut faire

### Onglet « Produits »
- **Voir tous ses produits** sous forme de cartes (celles-là mêmes que voient les
  clientes en boutique — l'aperçu est fidèle « tel que vu en boutique »).
- **Ajouter un produit** : bouton « + Nouveau produit » → renseigner catégorie,
  nom, prix (en FCFA), description, emoji/couleur, puis **Enregistrer**. Le produit
  apparaît aussitôt sur `lhairafro.com`.
- **Modifier** : bouton « Modifier » sur une carte → changer n'importe quel champ.
- **Ajouter une photo** : dans la fiche produit, « 📷 Choisir une photo » →
  sélectionner une image (elle est automatiquement redimensionnée et remplace
  l'emoji). « Retirer la photo » revient à l'emoji.
- **Masquer / Afficher** : bouton « Masquer » retire le produit de la boutique
  sans le supprimer (badge « Masqué »). « Afficher » le remet en ligne.
- **Supprimer** : dans la fiche produit, bouton « Supprimer » (définitif, avec
  confirmation).

### Onglet « Commandes »
- **Liste de toutes les commandes**, filtrable par statut : Toutes / Payées /
  À livrer / En attente / À confirmer / Livrées / Échouées (avec compteurs).
- **Détail d'une commande** (clic) : produits commandés, montant, mode de
  paiement, nom + téléphone + adresse de la cliente.
- **« Écrire à la cliente »** : ouvre WhatsApp pré-rempli vers son numéro.
- **« Marquer livré »** : note la commande comme remise. ⚠️ **Lecture seule sur
  les paiements** : l'admin ne réencaisse jamais, il ne fait que suivre.

### Onglet « Réglages »
- Nom de la boutique, slogan, numéro WhatsApp — appliqués **aussitôt** à la
  boutique en ligne. (Laisser un champ vide = on retombe sur la valeur par défaut
  du serveur.)
- **Mon mot de passe** : Ludmilla définit / change **son propre** mot de passe
  (que Landry ne connaît pas). À chaque changement, un **code de récupération**
  s'affiche **une seule fois** — à noter et garder en lieu sûr.

### Écran de connexion — « Mot de passe oublié ? »
Si Ludmilla oublie son mot de passe, elle clique « Mot de passe oublié ? », saisit
son **code de récupération** + un nouveau mot de passe, et se reconnecte
**seule**, sans Landry. Un nouveau code de récupération lui est alors donné (l'ancien
est consommé).

---

## 2) Persistance — À FAIRE PAR LANDRY (action de facturation)

⚠️ Aujourd'hui, sans disque, la base SQLite et les photos sont **éphémères** :
elles sont **effacées à chaque déploiement**. Il faut donc attacher le **disque
persistant Render** pour que le travail de Ludmilla soit conservé.

**Le code est déjà prêt** (option A retenue : disque Render + node:sqlite, pour
rester sans module natif) :
- `render.yaml` déclare le disque `data` monté sur **`/var/data`** (1 Go) ;
- `DATABASE_PATH=/var/data/lhairafro.db` (base) ;
- `UPLOADS_DIR=/var/data/uploads` (photos), créé automatiquement au démarrage et
  servi sous `/uploads`.

**Consigne exacte pour Landry, sur le dashboard Render** (service
`lhairafro-boutique`) :

1. **Settings → Disks → Add Disk**
   - Name : `data`
   - Mount Path : `/var/data`
   - Size : `1 GB`
   (C'est l'unique action facturable ; le disque Starter est inclus/peu coûteux.)
2. **Vérifier les variables d'environnement** (Environment) — normalement posées
   par le blueprint `render.yaml`, sinon les ajouter à la main :
   - `DATABASE_PATH = /var/data/lhairafro.db`
   - `UPLOADS_DIR = /var/data/uploads`
3. **Poser le mot de passe admin** (voir §3).
4. **Manual Deploy → Deploy latest commit** pour repartir sur le disque persistant.

> Amorçage : les 10 produits placeholder ne sont insérés **que si la table est
> vide**. Une fois que Ludmilla a saisi ses vrais produits, ils ne seront jamais
> écrasés par l'amorçage.

---

## 3) Mots de passe — autonomie de Ludmilla (3 niveaux)

Objectif : que Ludmilla soit **autonome** et sécurise son activité avec un mot de
passe **qu'elle seule connaît**, tout en gardant une porte de secours si elle
l'oublie. Trois niveaux :

1. **Son mot de passe personnel** — elle le définit dans Réglages ; Landry ne le
   connaît pas. C'est sa clé du quotidien. Stocké **haché** (scrypt), jamais en clair.
2. **Son code de récupération** — généré et affiché une seule fois à chaque
   changement de mot de passe. C'est **son** filet : oublié son mot de passe →
   « Mot de passe oublié ? » sur `/admin`, elle saisit ce code + un nouveau mot de
   passe, et se déverrouille **seule**. Stocké haché, elle seule le détient.
3. **Le mot de passe maître `ADMIN_PASSWORD`** (Landry) — « bris de glace »
   ultime, utilisé seulement si elle perd à la fois son mot de passe ET son code.
   C'est un recours d'urgence incontournable (l'hébergeur peut toujours réinitialiser),
   pas la clé du quotidien. C'est aussi la **racine de signature** des sessions,
   donc il doit rester posé en permanence.

### À POSER PAR LANDRY (secret)
Sur Render → service `lhairafro-boutique` → **Environment → Add Environment
Variable** :
- Key : `ADMIN_PASSWORD`
- Value : *(un mot de passe robuste ; il sert de 1re connexion pour Ludmilla ET de
  clé de secours)*

Puis **Save, rebuild**. Donner ce mot de passe à Ludmilla pour sa **première**
connexion sur `lhairafro.com/admin`, en lui demandant d'aller aussitôt dans
**Réglages → Mon mot de passe** pour définir le sien (et **noter le code de
récupération** affiché). À partir de là, Landry n'a plus besoin de connaître son
mot de passe.

Variables optionnelles : `ADMIN_SESSION_SECRET` (sel de signature),
`ADMIN_SESSION_HEURES` (durée d'une session, défaut 12 h).

---

## 4) Détails techniques (pour nous)

- **Auth** : jeton signé HMAC-SHA256 (`node:crypto`, aucun module natif),
  stocké côté navigateur (localStorage), envoyé en `Authorization: Bearer`.
  Clé de signature dérivée du mot de passe **maître** `ADMIN_PASSWORD` (racine
  stable : changer le mot de passe *perso* n'invalide pas les sessions). Mots de
  passe perso + code de récupération **hachés en scrypt** dans la table
  `admin_auth` (ligne unique). Fichier : `src/services/auth.js`.
- **Routes** (toutes sous `/api/admin/*`, protégées sauf `/login` et
  `/reinitialiser` qui sont publics) :
  `POST /login`, `POST /reinitialiser` (reset par code de récupération),
  `GET /session`, `POST /changer-motdepasse`, `GET|POST /produits`,
  `PUT|DELETE /produits/:id`, `PATCH /produits/:id/actif`,
  `POST|DELETE /produits/:id/image`, `GET /commandes`,
  `GET /commandes/:reference`, `PATCH /commandes/:reference/livree`,
  `GET|PUT /reglages`. Contrôleur : `src/controllers/adminController.js`.
- **Photos** : envoyées en Data URL (base64) après redimensionnement navigateur
  (max 900 px, JPEG q.82) → décodées et écrites dans `UPLOADS_DIR`. Pas de
  multipart, pas de multer. Fichier : `src/services/uploads.js`.
- **Réglages** : table `reglages` (clé/valeur) ; surcharge l'environnement dans
  `GET /api/boutique` (donc reflet direct sur la boutique publique).
- **Front** : `public/admin.html` (une seule page, sans dépendance externe).

### Tests réalisés en local (tous OK)
Connexion (bon/mauvais mot de passe + 401 sans jeton), liste/création/modification
/activation/suppression de produit, reflet immédiat sur `/api/produits`,
téléversement d'une photo servie en `/uploads/...`, création d'une commande côté
cliente puis liste/détail/« marquer livré » côté admin, réglages répercutés sur
`/api/boutique`.

---

## 5) Ce qui reste

- [ ] **Landry** : attacher le disque `/var/data` (§2) et poser `ADMIN_PASSWORD` (§3),
      puis redéployer. *(Coordonné avec la session principale : le disque est
      attaché côté infra.)*
- [ ] Communiquer l'URL `lhairafro.com/admin` + le mot de passe à Ludmilla.
- [ ] (Facultatif) former Ludmilla en 5 min : ajouter un produit, mettre une photo,
      suivre une commande.
