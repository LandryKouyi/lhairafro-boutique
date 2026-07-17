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
`);

// STATUTS commande :
//   'a_livrer'          -> commande « paiement à la livraison », à préparer
//   'en_attente'        -> paiement Mobile Money initié, en attente de validation
//   'paye'              -> paiement confirmé (PVit SUCCESS)
//   'echoue'            -> paiement Mobile Money refusé / expiré
//   'a_confirmer'       -> Mobile Money demandé mais rail PVit non configuré (repli WhatsApp)

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
    ['Accessoires', 'Peigne afro & pince',         'Kit coiffage démêlant, tout doux pour vos longueurs.',               2000, '🪮', '#dff2f7'],
    ['Accessoires', 'Bonnet satin de nuit',        'Protège vos cheveux et préserve vos coiffures.',                     3000, '🎀', '#f7d9ec'],
    ['Soins',       'Sérum pousse ricin & menthe', 'Active la circulation et booste la longueur.',                       6000, '🌿', '#def7e6'],
    ['Coffret',     'Coffret découverte routine',  '5 essentiels pour une routine afro complète.',                      15000, '🎁', '#efe0f7'],
  ];
  const ins = db.prepare(
    'INSERT INTO produits (categorie, nom, description, prix, emoji, couleur, ordre) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  seed.forEach((p, i) => ins.run(p[0], p[1], p[2], p[3], p[4], p[5], i + 1));
  console.log(`   🌱 Catalogue amorcé : ${seed.length} produits placeholder.`);
}

module.exports = db;
