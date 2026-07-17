'use strict';

const app = require('./src/app');
const config = require('./src/config');
require('./src/db'); // crée le schéma + amorce le catalogue au démarrage

const pvit = require('./src/services/pvit');

app.listen(config.port, () => {
  console.log(`\n💄 ${config.boutique.nom} — boutique en ligne`);
  console.log(`   ➜ http://localhost:${config.port}`);
  console.log(`   Environnement : ${config.env}`);
  console.log(`   Paiement Mobile Money (PVit) : ${pvit.estConfigure() ? 'ACTIF' : 'inactif (mode livraison + repli WhatsApp)'}\n`);
});
