'use strict';

// Couche d'accès SQLite via le module intégré à Node (node:sqlite, dès Node 22.5).
// Aucun compilateur ni dépendance native requis (contrainte machine : pas de
// Build Tools C++). Le schéma est créé de façon idempotente au chargement, et le
// catalogue est amorcé avec 10 produits PLACEHOLDER (issus de la maquette validée
// par la cliente) si la table est vide — Ludmilla les remplacera par ses vrais
// produits, photos et prix depuis l'espace de gestion.

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// --- Schéma -----------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS produits (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    categorie   TEXT    NOT NULL,
    nom         TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    prix        INTEGER NOT NULL,           -- en FCFA (XAF), entier
    emoji       TEXT    NOT NULL DEFAULT '🛍️',
    couleur     TEXT    NOT NULL DEFAULT '#f7d9e8',
    image       TEXT    NOT NULL DEFAULT '',-- URL de la photo (vide = emoji placeholder)
    actif       INTEGER NOT NULL DEFAULT 1,
    ordre       INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS commandes (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    reference         TEXT    NOT NULL UNIQUE,   -- réf interne (ex. LHA-...)
    pvit_ref_alnum    TEXT,                      -- réf alphanumérique ≤20 envoyée à PVit
    client_nom        TEXT    NOT NULL,
    client_tel        TEXT    NOT NULL,
    client_operateur  TEXT,                      -- AIRTEL_MONEY / MOOV_MONEY
    client_adresse    TEXT    NOT NULL DEFAULT '',
    mode_paiement     TEXT    NOT NULL,          -- 'mobile_money' | 'livraison'
    montant           INTEGER NOT NULL,
    items_json        TEXT    NOT NULL,          -- lignes de commande (snapshot)
    statut            TEXT    NOT NULL,          -- voir STATUTS ci-dessous
    pvit_reference_id TEXT,                      -- reference_id renvoyée par PVit
    pvit_merchant_ref TEXT,                      -- merchant_reference_id PVit
    cree_le           TEXT    NOT NULL DEFAULT (datetime('now')),
    maj_le            TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_cmd_ref       ON commandes(reference);
  CREATE INDEX IF NOT EXISTS idx_cmd_pvit_ref  ON commandes(pvit_reference_id);

  -- Réglages éditables depuis l'arrière-boutique (nom, slogan, WhatsApp…).
  -- Une valeur ici SURCHARGE la valeur d'environnement correspondante.
  CREATE TABLE IF NOT EXISTS reglages (
    cle    TEXT PRIMARY KEY,
    valeur TEXT NOT NULL DEFAULT ''
  );

  -- Identifiants propres à Ludmilla (autonomie / confidentialité vis-à-vis de
  -- Landry). Ligne unique id=1. Tant qu'aucune ligne n'existe, la connexion se
  -- fait avec le mot de passe maître ADMIN_PASSWORD (défini par Landry) ; dès
  -- qu'elle définit son mot de passe, password_hash prime. recovery_hash = code
  -- de récupération (haché) qu'elle seule détient pour se déverrouiller seule.
  CREATE TABLE IF NOT EXISTS admin_auth (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    password_hash TEXT,
    recovery_hash TEXT,
    maj_le        TEXT
  );

  -- Administratrices SECONDAIRES, créées par la super admin (Ludmilla), 2 au
  -- maximum. La super admin, elle, s'authentifie via admin_auth ci-dessus (ou le
  -- mot de passe maître ADMIN_PASSWORD). Chaque admin secondaire a une adresse
  -- pro @lhairafro.com (identité d'envoi + filtrage de SA messagerie) et son
  -- propre code d'accès (password_hash). Rôle applicatif 'admin' : elles NE
  -- peuvent NI accéder à l'espace mot de passe / MyPVit, NI créer d'autres admins.
  CREATE TABLE IF NOT EXISTS admins (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT    NOT NULL UNIQUE,      -- ex. nicole@lhairafro.com (minuscules)
    nom           TEXT    NOT NULL DEFAULT '',
    password_hash TEXT    NOT NULL,             -- code d'accès haché (scrypt)
    actif         INTEGER NOT NULL DEFAULT 1,
    cree_le       TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- Messagerie de l'arrière-boutique (boîte de contact@lhairafro.com).
  -- Réception : POST /api/mail-inbound (Cloudflare Email Worker) -> direction 'in'.
  -- Envoi     : via SMTP Gmail (compte relais) depuis l'admin -> direction 'out'.
  CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    direction   TEXT    NOT NULL,            -- 'in' (reçu) | 'out' (envoyé)
    de_email    TEXT    NOT NULL DEFAULT '',
    de_nom      TEXT    NOT NULL DEFAULT '',
    a_email     TEXT    NOT NULL DEFAULT '',
    sujet       TEXT    NOT NULL DEFAULT '',
    corps_texte TEXT    NOT NULL DEFAULT '',
    corps_html  TEXT    NOT NULL DEFAULT '',
    message_id  TEXT    NOT NULL DEFAULT '', -- Message-Id du mail
    in_reply_to TEXT    NOT NULL DEFAULT '', -- Message-Id auquel il répond
    lu          INTEGER NOT NULL DEFAULT 0,  -- 1 = lu (les 'out' sont lus d'office)
    cree_le     TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_msg_cree ON messages(cree_le);
`);

// STATUTS commande :
//   'a_livrer'          -> commande « paiement à la livraison », à préparer
//   'en_attente'        -> paiement Mobile Money initié, en attente de validation
//   'paye'              -> paiement confirmé (PVit SUCCESS)
//   'echoue'            -> paiement Mobile Money refusé / expiré
//   'a_confirmer'       -> Mobile Money demandé mais rail PVit non configuré (repli WhatsApp)
//   'livre'             -> commande remise à la cliente (marquée « livré » depuis l'admin)

// --- Amorçage du catalogue (10 produits placeholder de la maquette validée) --
const nbProduits = db.prepare('SELECT COUNT(*) AS n FROM produits').get().n;
if (nbProduits === 0) {
  const seed = [
    ['Soins',       'Beurre de karité pur',        '100% naturel, nourrit et répare les cheveux crépus.',                3500, '🧴', '#f7d9e8'],
    ['Soins',       'Huile de ricin noire',        'Fortifie la fibre et stimule la pousse.',                            5000, '🫗', '#ead9f7'],
    ['Coiffage',    'Gel coiffant sans alcool',    'Fixation longue durée, définit les boucles sans dessécher.',         4000, '💠', '#d9ecf7'],
    ['Soins',       'Masque hydratant intense',    'Cheveux crépus & défrisés — hydratation en profondeur.',             6500, '🌸', '#f7dfe4'],
    ['Soins',       'Shampoing doux sans sulfate', 'Nettoie en douceur, respecte le cuir chevelu.',                      4500, '🧼', '#e4f7df'],
    ['Coiffage',    'Leave-in définition boucles', 'Sans rinçage, discipline et fait briller.',                          5500, '✨', '#f7f0d9'],
    ['Accessoires', 'Peigne afro & pince',         'Kit coiffage démêlant, tout doux pour vos longueurs.',                500, '🪮', '#dff2f7'],
    ['Accessoires', 'Bonnet satin de nuit',        'Protège vos cheveux et préserve vos coiffures.',                      900, '🎀', '#f7d9ec'],
    ['Soins',       'Sérum pousse ricin & menthe', 'Active la circulation et booste la longueur.',                       6000, '🌿', '#def7e6'],
    ['Coffret',     'Coffret découverte routine',  '5 essentiels pour une routine afro complète.',                      15000, '🎁', '#efe0f7'],
  ];
  const ins = db.prepare(
    'INSERT INTO produits (categorie, nom, description, prix, emoji, couleur, ordre) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  seed.forEach((p, i) => ins.run(p[0], p[1], p[2], p[3], p[4], p[5], i + 1));
  console.log(`   🌱 Catalogue amorcé : ${seed.length} produits placeholder.`);
}

// --- Migration catalogue v2 : vrais produits L'Hair Afro (Afro Kids) ----------
// S'exécute UNE SEULE FOIS (gardée par le réglage 'catalogue_v'). Remplace les
// produits placeholder par la vraie gamme, avec photos (/assets/produits/…) et
// PRIX INDICATIFS — Ludmilla les ajuste ensuite depuis l'arrière-boutique.
// Le drapeau garantit qu'on n'écrase JAMAIS les produits qu'elle aura édités.
const catV = db.prepare("SELECT valeur FROM reglages WHERE cle = 'catalogue_v'").get();
if (!catV || catV.valeur !== '2') {
  const vrais = [
    ['Soins',    'Huile capillaire Afro Kids',       'Huile légère qui nourrit, fait briller et protège les cheveux des enfants.',        3500, '🧴', '#efe3f7', '/assets/produits/huile-capillaire.jpg'],
    ['Soins',    'Après-shampoing sans rinçage',     'Démêle et lisse les frisottis, hydrate sans rincer. 250 ml.',                       4000, '🧴', '#efe3f7', '/assets/produits/apres-shampoing.jpg'],
    ['Soins',    'Shampooing & gel douche 2 en 1',   'Nettoie cheveux et corps en douceur, élimine les impuretés. 250 ml.',               3500, '🧴', '#efe3f7', '/assets/produits/shampooing-2en1.jpg'],
    ['Coiffage', 'Cire à cheveux Afro Kids',         'Discipline, gaine et fait tenir les coiffures des tout-petits.',                    3000, '🧴', '#efe3f7', '/assets/produits/cire-cheveux.jpg'],
    ['Coffret',  'Coffret gamme Afro Kids',          'La routine complète des enfants réunie — idéal découverte ou cadeau.',             15000, '🎁', '#efe3f7', '/assets/gamme.jpg'],
  ];
  db.exec('DELETE FROM produits');
  const insV = db.prepare(
    'INSERT INTO produits (categorie, nom, description, prix, emoji, couleur, image, ordre) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  vrais.forEach((p, i) => insV.run(p[0], p[1], p[2], p[3], p[4], p[5], p[6], i + 1));
  db.prepare("INSERT INTO reglages (cle, valeur) VALUES ('catalogue_v', '2') ON CONFLICT(cle) DO UPDATE SET valeur = '2'").run();
  console.log(`   ✨ Catalogue migré (v2) : ${vrais.length} vrais produits Afro Kids, prix indicatifs.`);
}

module.exports = db;
