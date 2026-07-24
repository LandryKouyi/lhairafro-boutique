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

  // Dossier des photos produits téléversées par Ludmilla. Sur Render, on le place
  // sur le disque persistant (à côté de la base) pour qu'il survive aux déploiements.
  // Par défaut : dossier « uploads » à côté de la base SQLite.
  uploadsDir: process.env.UPLOADS_DIR
    ? path.resolve(root, process.env.UPLOADS_DIR)
    : path.join(path.dirname(path.resolve(root, process.env.DATABASE_PATH || './data/lhairafro.db')), 'uploads'),

  // Espace de gestion (arrière-boutique). Le mot de passe est SECRET : il vient
  // de l'environnement (ADMIN_PASSWORD) et n'est JAMAIS écrit en dur. Vide =
  // l'accès admin est verrouillé (aucune connexion possible) tant que Landry ne
  // l'a pas posé sur Render. Le secret de signature des jetons se dérive du mot
  // de passe (+ ADMIN_SESSION_SECRET optionnel) : changer le mot de passe
  // invalide donc les sessions ouvertes.
  admin: {
    password: process.env.ADMIN_PASSWORD || '',
    sessionSecret: process.env.ADMIN_SESSION_SECRET || '',
    // Durée de validité d'une session admin (heures).
    sessionHeures: parseInt(process.env.ADMIN_SESSION_HEURES, 10) || 12,
    // Domaine des adresses pro des administratrices secondaires créées par la
    // super admin (ex. nicole@lhairafro.com). Sert à valider les adresses saisies.
    emailDomain: (process.env.ADMIN_EMAIL_DOMAIN || 'lhairafro.com').toLowerCase(),
  },

  // URL publique du site (Render la fournit via RENDER_EXTERNAL_URL) — sert à
  // construire d'éventuels liens absolus.
  publicUrl: (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, ''),

  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .concat(process.env.RENDER_EXTERNAL_URL ? [process.env.RENDER_EXTERNAL_URL] : [])
    // Domaine public de la boutique (custom domain Render). Servi sur la même
    // origine que l'API, donc le navigateur envoie Origin: https://lhairafro.com
    // sur les POST (commandes, connexion admin) : il DOIT être autorisé, sinon
    // le middleware CORS rejette la requête (« Origine non autorisée par CORS »)
    // et le client voit une erreur générique. On l'ajoute toujours, en dur.
    .concat(['https://lhairafro.com', 'https://www.lhairafro.com']),

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
    // CHECK STATUS (v1) : source de vérité du statut d'un paiement. Code
    // d'endpoint relevé sur la page APIs L'Hair Afro (Paramétrages → APIs).
    urlStatus: process.env.PVIT_URL_STATUS || '/FYS1XHAGYCF4X1YX/status',
    // KYC (v2) : vérification d'identité du client avant paiement. GET
    // /v2/{codeUrl}/kyc. Code relevé sur la page APIs. Vide = KYC désactivé
    // (best-effort, non bloquant).
    urlKyc: process.env.PVIT_URL_KYC || '/v2/4ZGW50N5YLCFKTEY/kyc',
    // Codes d'URL créés dans PVit (Paramétrages → Urls), pointant vers le domaine
    // déployé : callback -> https://lhairafro.com/api/pvit-callback (code MKTAO),
    // réception de clé -> https://lhairafro.com/api/pvit-secret (code 7UMSP).
    // Valeurs par défaut = codes du mode TEST L'Hair Afro (surchargées par .env
    // en production si les URLs sont recréées).
    callbackUrlCode: process.env.PVIT_CALLBACK_URL_CODE || 'MKTAO',
    receptionUrlCode: process.env.PVIT_RECEPTION_URL_CODE || '7UMSP',
    // Métadonnées facultatives.
    agent: process.env.PVIT_AGENT || 'LHAIR-AFRO',
    product: process.env.PVIT_PRODUCT || 'BOUTIQUE',
    ownerCharge: process.env.PVIT_OWNER_CHARGE || 'CUSTOMER',
    ownerChargeOperator: process.env.PVIT_OWNER_CHARGE_OPERATOR || 'CUSTOMER',
  },

  // Messagerie de l'arrière-boutique — envoi via SMTP Gmail (compte relais dédié
  // à la boutique), réception via un Cloudflare Email Worker qui POSTe sur
  // /api/mail-inbound. Tant que gmailUser/gmailAppPassword sont vides, l'envoi
  // est désactivé proprement (le module Messagerie s'affiche « en attente
  // d'activation », rien ne plante). Ces identifiants sont SECRETS : ils
  // viennent de l'environnement, jamais écrits en dur.
  //
  // Choix Gmail SMTP : aucun réglage DNS (pas de DKIM/SPF à poser ni à attendre),
  // ne touche pas aux MX de lhairafro.com — le renvoi Cloudflare qui achemine
  // l'OTP PVit reste intact. Le compte Gmail est un simple relais serveur :
  // personne ne s'y connecte au quotidien, Ludmilla ne voit que le Dashboard.
  mail: {
    // Compte Gmail relais (ex. contact.lhairafro@gmail.com) + mot de passe
    // d'application (16 caractères, généré dans le compte Google, 2FA requise).
    gmailUser: process.env.GMAIL_USER || '',
    gmailAppPassword: (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, ''),
    // Expéditeur affiché : l'alias « Envoyer en tant que » configuré dans le
    // compte Gmail relais. Ne touche pas aux MX/OTP.
    fromEmail: process.env.MAIL_FROM_EMAIL || 'contact@lhairafro.com',
    fromName: process.env.MAIL_FROM_NAME || "L'Hair Afro",
    // Jeton partagé protégeant le webhook de réception (Worker Cloudflare -> app).
    // Vide = réception désactivée (le webhook refuse tout). SECRET.
    inboundToken: process.env.MAIL_INBOUND_TOKEN || '',
  },

  timezone: 'Africa/Libreville',
};

module.exports = config;
