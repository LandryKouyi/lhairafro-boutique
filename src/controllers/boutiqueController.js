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
function infosBoutique(req, res) {
  const pvit = require('../services/pvit');
  res.json({
    nom: config.boutique.nom,
    slogan: config.boutique.slogan,
    ville: config.boutique.ville,
    whatsapp: config.boutique.whatsapp,
    telephone: config.boutique.telephone,
    // Indique au front si le paiement Mobile Money en ligne est réellement actif.
    mobileMoneyActif: pvit.estConfigure(),
  });
}

module.exports = { listeProduits, infosBoutique };
