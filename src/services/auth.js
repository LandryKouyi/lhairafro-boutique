'use strict';

// Authentification de l'arrière-boutique (espace de gestion de Ludmilla).
//
// Jeton de session « maison » signé avec HMAC-SHA256 via node:crypto — aucun
// module natif ni dépendance externe (contrainte machine : pas de compilateur
// C++, cf. memory env_npm_windows_antivirus). Format proche d'un JWT simplifié :
//   base64url(payload).base64url(hmac)
// Le payload contient uniquement { r:'admin', exp:<timestamp> } — pas de donnée
// sensible. La clé de signature se dérive du mot de passe admin (+ un secret de
// session optionnel), donc changer ADMIN_PASSWORD invalide tous les jetons.

const crypto = require('crypto');
const config = require('../config');

// Clé de signature : dérivée du mot de passe admin. Si le mot de passe n'est pas
// posé, la clé est vide et estActive() = false -> aucune connexion possible.
function cleSignature() {
  const mdp = config.admin.password || '';
  if (!mdp) return null;
  return crypto
    .createHash('sha256')
    .update(`lhairafro|${config.admin.sessionSecret || ''}|${mdp}`)
    .digest();
}

// L'espace admin est-il activable ? (mot de passe posé)
function estActive() {
  return Boolean(config.admin.password);
}

// Comparaison à temps constant du mot de passe saisi.
function motDePasseValide(saisi) {
  const attendu = config.admin.password || '';
  if (!attendu) return false;
  const a = Buffer.from(String(saisi || ''));
  const b = Buffer.from(attendu);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// Fabrique un jeton de session valable config.admin.sessionHeures heures.
function creerJeton() {
  const cle = cleSignature();
  if (!cle) return null;
  const exp = Date.now() + config.admin.sessionHeures * 3600 * 1000;
  const payload = b64url(Buffer.from(JSON.stringify({ r: 'admin', exp })));
  const sig = b64url(crypto.createHmac('sha256', cle).update(payload).digest());
  return `${payload}.${sig}`;
}

// Vérifie un jeton : signature valide + non expiré. Renvoie true/false.
function jetonValide(jeton) {
  const cle = cleSignature();
  if (!cle || !jeton || typeof jeton !== 'string') return false;
  const [payload, sig] = jeton.split('.');
  if (!payload || !sig) return false;
  const attendu = crypto.createHmac('sha256', cle).update(payload).digest();
  const recu = fromB64url(sig);
  if (recu.length !== attendu.length || !crypto.timingSafeEqual(recu, attendu)) return false;
  try {
    const data = JSON.parse(fromB64url(payload).toString('utf8'));
    return data.r === 'admin' && typeof data.exp === 'number' && data.exp > Date.now();
  } catch {
    return false;
  }
}

// Middleware Express : protège les routes /api/admin/*. Lit le jeton dans
// l'en-tête « Authorization: Bearer <jeton> ».
function protege(req, res, next) {
  if (!estActive()) {
    return res.status(503).json({ erreur: "L'espace de gestion n'est pas encore activé. Le mot de passe admin doit être défini sur le serveur." });
  }
  const h = req.headers.authorization || '';
  const jeton = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!jetonValide(jeton)) {
    return res.status(401).json({ erreur: 'Session expirée ou invalide. Reconnectez-vous.' });
  }
  next();
}

module.exports = { estActive, motDePasseValide, creerJeton, jetonValide, protege };
