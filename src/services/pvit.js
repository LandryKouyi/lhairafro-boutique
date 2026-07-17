'use strict';

// Intégration PVit / MyPVit (BakoAI) — Mobile Money Gabon (Airtel Money,
// Moov Money) + cartes GIMAC. Passerelle de paiement gabonaise.
// Doc : https://docs.mypvit.pro
//
// PORTÉ tel quel depuis Klass-app (gestion-scolaire), adapté à la boutique
// L'Hair Afro (agent/produit/libellés). Le flux et les pièges restent identiques.
//
// Flux (cf. memory project_pvit_paiement) :
//   1) POST {BASE}{RENEW}  -> génère une clé secrète éphémère (~3600 s).
//                             Corps x-www-form-urlencoded, champs camelCase :
//                             operationAccountCode + password + receptionUrlCode.
//                             ⚠️ La clé n'est PAS dans la réponse : PVit la POSTe
//                             à notre URL de réception (/api/pvit-secret).
//   2) POST {BASE}{REST}   -> initie le paiement. En-tête « X-Secret: <clé> ».
//                             Réponse immédiate = statut PENDING (non définitif).
//   3) Webhook (POST /api/pvit-callback) -> statut DÉFINITIF (SUCCESS / FAILED).
//                             Notre serveur DOIT répondre { transactionId, responseCode }.
//   4) GET  {BASE}{STATUS} -> CHECK STATUS, source de vérité / filet de secours.
//
// PRINCIPE ANTI-BUG : on ne valide JAMAIS un paiement sur la seule notification.
// On CONFIRME via CHECK STATUS quand l'endpoint est disponible. La clé secrète
// étant éphémère, on la met en cache (pvitSecret) et on la renouvelle à la demande.

const config = require('../config');
const pvitSecret = require('./pvitSecret');

const cfg = () => config.pvit;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const baseUrl = () => (cfg().baseUrl || '').replace(/\/+$/, '');
const joinPath = (p) => `${baseUrl()}/${String(p || '').replace(/^\/+/, '')}`;

function estConfigure() {
  const c = cfg();
  return Boolean(c.operationAccount && c.apiPassword && c.urlRenew && c.urlRest && c.receptionUrlCode);
}

// Noms d'opérateurs attendus par PVit (operator_code).
const OPERATEURS = {
  airtel: 'AIRTEL_MONEY', airtelmoney: 'AIRTEL_MONEY', airtel_money: 'AIRTEL_MONEY',
  moov: 'MOOV_MONEY', moovmoney: 'MOOV_MONEY', moov_money: 'MOOV_MONEY', moovmoney4: 'MOOV_MONEY',
};

// Normalise un numéro Gabon au format local attendu par PVit : 0XXXXXXXX.
function normaliserMsisdn(tel) {
  let d = String(tel || '').replace(/\D/g, '');
  if (d.startsWith('241')) d = d.slice(3);
  if (d.length === 8) d = '0' + d; // rétablit le 0 initial si absent
  return d;
}

// Devine l'opérateur d'après le préfixe Gabon : 07x = Airtel, 06x = Moov.
function operateurDepuisMsisdn(tel) {
  const d = normaliserMsisdn(tel);
  if (/^07/.test(d)) return 'AIRTEL_MONEY';
  if (/^06/.test(d)) return 'MOOV_MONEY';
  return '';
}

function normaliserOperateur(op, msisdn) {
  return OPERATEURS[String(op || '').toLowerCase()] || operateurDepuisMsisdn(msisdn);
}

// --- Clé secrète éphémère ---------------------------------------------------
// PVit ne renvoie PAS la clé dans la réponse à renew-secret : il la POSTe à
// l'URL de réception (/api/pvit-secret, qui l'enregistre dans pvitSecret). On
// déclenche donc la génération puis on attend l'arrivée de la clé dans le magasin.

async function declencherRenew() {
  const r = await fetch(joinPath(cfg().urlRenew), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      operationAccountCode: cfg().operationAccount,
      password: cfg().apiPassword,
      receptionUrlCode: cfg().receptionUrlCode,
    }).toString(),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(`PVit : génération de la clé secrète refusée (HTTP ${r.status})${data.message ? ' — ' + data.message : ''}.`);
    e.status = 502; e.expose = true; throw e;
  }
  // Cas rare : certaines versions renvoient directement la clé.
  const secretDirect = data.secret || data.secretKey || data.secret_key;
  if (secretDirect) {
    pvitSecret.enregistrer(cfg().operationAccount, secretDirect, data.expires_in || data.expiresIn || 3600);
    return secretDirect;
  }
  return null; // Cas standard : livraison asynchrone sur l'URL de réception.
}

async function obtenirSecret(forcer = false) {
  if (!forcer) {
    const s = pvitSecret.lire(cfg().operationAccount);
    if (s) return s;
  }
  const direct = await declencherRenew();
  if (direct) return direct;
  // On attend que POST /api/pvit-secret enregistre la clé livrée par PVit.
  for (let i = 0; i < 30; i++) { // ~15 s max
    const s = pvitSecret.lire(cfg().operationAccount);
    if (s) return s;
    await pause(500);
  }
  const e = new Error("PVit : clé secrète non reçue sur l'URL de réception (vérifiez PVIT_RECEPTION_URL_CODE et que /api/pvit-secret est joignable publiquement).");
  e.status = 504; e.expose = true; throw e;
}

// Appel authentifié générique (ajoute l'en-tête X-Secret, renouvelle la clé une
// fois si le serveur répond 401/403 = clé expirée).
async function appelSecret(path, corps, methode = 'POST') {
  let secret = await obtenirSecret();
  const faire = (s) => fetch(joinPath(path), {
    method: methode,
    headers: { 'X-Secret': s, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: methode === 'GET' ? undefined : JSON.stringify(corps || {}),
  });
  let r = await faire(secret);
  if (r.status === 401 || r.status === 403) {
    secret = await obtenirSecret(true); // clé probablement expirée : on régénère
    r = await faire(secret);
  }
  return r;
}

// Initie un paiement Mobile Money : PVit pousse la demande vers le téléphone du
// client (il valide avec son code). Renvoie la référence PVit à suivre.
async function initierPaiement({ transactionId, montant, description, client = {} }) {
  if (!estConfigure()) {
    const e = new Error('PVit non configuré (PVIT_OPERATION_ACCOUNT / PVIT_API_PASSWORD / URLs dans .env).');
    e.status = 503; e.expose = true; throw e;
  }
  const msisdn = normaliserMsisdn(client.telephone);
  const operateur = normaliserOperateur(client.operateur, msisdn);
  // PVit impose une « reference » ALPHANUMÉRIQUE de 20 caractères max. Notre
  // référence interne (ex. « LHA-1718... ») contient des tirets et peut dépasser
  // 20 car. : on en dérive une version PVit-safe (le suivi réel se fait via le
  // reference_id renvoyé par PVit).
  const refPvit = String(transactionId).replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);

  const corps = {
    agent: cfg().agent || 'LHAIR-AFRO',
    amount: Math.round(montant),
    callback_url_code: cfg().callbackUrlCode || '',
    customer_account_number: msisdn,
    merchant_operation_account_code: cfg().operationAccount,
    transaction_type: 'PAYMENT',
    owner_charge: cfg().ownerCharge || 'CUSTOMER',
    owner_charge_operator: cfg().ownerChargeOperator || 'CUSTOMER',
    free_info: (description || 'Commande').slice(0, 15), // PVit : max 15 caractères
    product: cfg().product || 'BOUTIQUE',
    operator_code: operateur || undefined,
    reference: refPvit,
    service: 'RESTFUL',
  };

  const r = await appelSecret(cfg().urlRest, corps);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = data.message || data.error || `initiation refusée (HTTP ${r.status})`;
    const e = new Error(`PVit : ${detail} [${JSON.stringify(data).slice(0, 400)}]`);
    e.status = 502; e.expose = true; throw e;
  }
  const refId = data.reference_id || data.transactionId || '';
  if (!refId) {
    const e = new Error("PVit : réponse sans reference_id à l'initiation.");
    e.status = 502; e.expose = true; throw e;
  }
  return {
    pvit_reference_id: String(refId),
    pvit_merchant_ref: String(data.merchant_reference_id || data.merchantReferenceId || ''),
    reference_envoyee: refPvit,
    statut: String(data.status || 'PENDING'),
    operateur,
    montant: Math.round(montant),
  };
}

// Interprète un libellé de statut PVit -> { accepte, enAttente }.
const STATUTS_SUCCES = new Set(['SUCCESS', 'SUCCESSFUL', 'PAID', 'COMPLETED']);
const STATUTS_ATTENTE = new Set(['PENDING', 'IN_PROGRESS', 'PROCESSING', 'INITIATED', 'CREATED']);

function interpreterStatut(statutBrut, data = {}) {
  const s = String(statutBrut || '').toUpperCase();
  const montant = Number(data.amountCredited || data.amount || 0) || 0;
  return {
    accepte: STATUTS_SUCCES.has(s),
    enAttente: STATUTS_ATTENTE.has(s),
    statut: s || 'INCONNU',
    montant,
    operateur: data.operator || '',
    brut: data,
  };
}

// Vérifie l'état réel d'une transaction PVit (source de vérité). On interroge
// par la référence PVit (reference_id renvoyée à l'initiation).
async function verifierPaiement(pvitReferenceId) {
  if (!estConfigure()) { const e = new Error('PVit non configuré.'); e.status = 503; e.expose = true; throw e; }
  if (!pvitReferenceId) return { accepte: false, enAttente: true, statut: 'SANS_REFERENCE' };
  if (!cfg().urlStatus) return { accepte: false, enAttente: true, statut: 'STATUS_URL_ABSENTE' };

  // CHECK STATUS (v1) est un GET (POST -> HTTP_METHOD_NOT_SUPPORTED), la
  // référence PVit passe en paramètre d'URL « transactionId ».
  const secret = await obtenirSecret();
  const params = new URLSearchParams({
    transactionId: String(pvitReferenceId),
    accountOperationCode: cfg().operationAccount,
    transactionOperation: 'PAYMENT',
  });
  const url = `${joinPath(cfg().urlStatus)}?${params.toString()}`;
  const faire = (s) => fetch(url, { method: 'GET', headers: { 'X-Secret': s, Accept: 'application/json' } });
  let r = await faire(secret);
  if (r.status === 401 || r.status === 403) r = await faire(await obtenirSecret(true));
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(`PVit : statut indisponible (HTTP ${r.status}) [${JSON.stringify(data).slice(0, 300)}]`);
    e.status = 502; e.expose = true; throw e;
  }
  return interpreterStatut(data.status || data.state, data);
}

// Extrait de façon robuste la référence PVit d'un payload de webhook (les
// exemples de la doc alternent transactionId / merchantReferenceId).
function refDepuisWebhook(body = {}) {
  return {
    transactionId: String(body.transactionId || body.reference_id || body.transaction_id || ''),
    merchantReferenceId: String(body.merchantReferenceId || body.merchant_reference_id || body.reference || ''),
    code: Number(body.code || body.status_code || 200) || 200,
  };
}

module.exports = {
  estConfigure, initierPaiement, verifierPaiement, obtenirSecret,
  interpreterStatut, refDepuisWebhook,
  normaliserMsisdn, operateurDepuisMsisdn, normaliserOperateur,
};
