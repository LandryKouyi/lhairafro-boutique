'use strict';

// Le simple fait de charger src/db/index.js crée le schéma (idempotent) et amorce
// le catalogue si besoin. Ce script sert de commande explicite « npm run migrate »
// et d'étape de démarrage sur Render (npm run start:prod).

require('./index');
console.log('✅ Base L\'Hair Afro prête (schéma + catalogue).');
