'use strict';

const db = require('../db');
const config = require('../config');

// GET /api/produits — catalogue public (produits actifs, dans l'ordre d'affichage).
function listeProduits(req, res) {
  const rows = db
    .prepare('SELECT id, categorie, nom, description, prix, emoji, couleur, image FROM produits WHERE actif = 1 ORDER BY ordre, id')
    .all();
  res.json({ produits: rows });
}

// GET /api/boutique — métadonnées de la boutique (nom, WhatsApp, rail paiement).
// Les réglages éditables depuis l'arrière-boutique (table reglages) SURCHARGENT
// les valeurs d'environnement, pour que les changements de Ludmilla soient
// répercutés en direct sur la boutique publique.
function infosBoutique(req, res) {
  const pvit = require('../services/pvit');
  const reglages = {};
  try {
    for (const r of db.prepare('SELECT cle, valeur FROM reglages').all()) reglages[r.cle] = r.valeur;
  } catch { /* table absente au tout premier démarrage : on retombe sur l'environnement */ }
  res.json({
    nom: reglages.nom || config.boutique.nom,
    slogan: reglages.slogan || config.boutique.slogan,
    ville: config.boutique.ville,
    whatsapp: reglages.whatsapp || config.boutique.whatsapp,
    telephone: config.boutique.telephone,
    // Indique au front si le paiement Mobile Money en ligne est réellement actif.
    mobileMoneyActif: pvit.estConfigure(),
  });
}

module.exports = { listeProduits, infosBoutique };
