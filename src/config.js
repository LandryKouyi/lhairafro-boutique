'use strict';

// Configuration centrale de la boutique L'Hair Afro.
// Toute valeur sensible (mot de passe API PVit) vient de l'environnement (.env)
// et n'est JAMAIS écrite en dur. Les identifiants NON secrets du compte marchand
// L'Hair Afro en mode TEST servent de valeurs par défaut (surchargées par .env)
// pour que la boutique soit préconfigurée ; ils restent inoffensifs seuls (sans
// le mot de passe API, aucun paiement ne peut être initié).

require('dotenv').config();

const path = require('path');
const root = path.resolve(__dirname, '..');

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3000,
  root,

  dbPath: path.resolve(root, process.env.DATABASE_PATH || './data/lhairafro.db'),

  // URL publique du site (Render la fournit via RENDER_EXTERNAL_URL) — sert à
  // construire d'éventuels liens absolus.
  publicUrl: (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, ''),

  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .concat(process.env.RENDER_EXTERNAL_URL ? [process.env.RENDER_EXTERNAL_URL] : []),

  boutique: {
    nom: process.env.BOUTIQUE_NOM || "L'Hair Afro",
    slogan: process.env.BOUTIQUE_SLOGAN || 'The Afro beauty concept store',
    ville: process.env.BOUTIQUE_VILLE || 'Libreville, Gabon',
    // Numéro WhatsApp de la boutique (format international sans +), pour la
    // confirmation de commande. Celui de Ludmilla : 074598750 -> 24174598750.
    whatsapp: process.env.BOUTIQUE_WHATSAPP || '24174598750',
    telephone: process.env.BOUTIQUE_TELEPHONE || '+241 74 59 87 50',
  },

  // Paiement Mobile Money — rail PVit / MyPVit (BakoAI, Gabon). Airtel + Moov.
  // Tant que apiPassword est vide, estConfigure() = false : le mode « Mobile
  // Money » se désactive proprement (le mode « À la livraison » reste dispo) et
  // rien ne plante. Les codes d'endpoint proviennent du tableau de bord PVit
  // (Paramétrages → APIs) ; les 2 codes d'URL (callback + réception de clé) se
  // créent au déploiement, une fois le domaine lié — donc vides par défaut.
  pvit: {
    slug: process.env.PVIT_SLUG || 'MR_1784284130',
    baseUrl: process.env.PVIT_BASE_URL || 'https://api.mypvit.pro',
    // Compte d'opération TEST L'Hair Afro (5 000 FCFA fictifs).
    operationAccount: process.env.PVIT_OPERATION_ACCOUNT || 'ACC_6A5A03E304ADF',
    // SECRET — laissé vide : posé par Landry lui-même (dashboard Render / .env).
    apiPassword: process.env.PVIT_API_PASSWORD || '',
    // Chemins d'endpoint (relatifs à baseUrl), copiés de la page APIs L'Hair Afro.
    urlRenew: process.env.PVIT_URL_RENEW || '/FMVCNVSMXCXS5RGQ/renew-secret',
    urlRest: process.env.PVIT_URL_REST || '/v2/KPZTKPA5GQT1ZFNS/rest',
    // CHECK STATUS : le code d'endpoint L'Hair Afro n'est pas encore relevé —
    // à copier depuis la page APIs (Paramétrages → APIs). Vide = check status
    // désactivé (la confirmation passe alors par le webhook).
    urlStatus: process.env.PVIT_URL_STATUS || '',
    // Codes d'URL à créer dans PVit (Paramétrages → Urls) pointant vers le
    // domaine déployé : callback -> /api/pvit-callback, réception clé -> /api/pvit-secret.
    callbackUrlCode: process.env.PVIT_CALLBACK_URL_CODE || '',
    receptionUrlCode: process.env.PVIT_RECEPTION_URL_CODE || '',
    // Métadonnées facultatives.
    agent: process.env.PVIT_AGENT || 'LHAIR-AFRO',
    product: process.env.PVIT_PRODUCT || 'BOUTIQUE',
    ownerCharge: process.env.PVIT_OWNER_CHARGE || 'CUSTOMER',
    ownerChargeOperator: process.env.PVIT_OWNER_CHARGE_OPERATOR || 'CUSTOMER',
  },

  timezone: 'Africa/Libreville',
};

module.exports = config;
