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
const db = require('../db');

// Clé de signature : dérivée du mot de passe MAÎTRE (ADMIN_PASSWORD, racine
// stable côté serveur). Elle ne change pas quand Ludmilla change SON mot de
// passe, donc ses sessions restent valides. Si ADMIN_PASSWORD n'est pas posé,
// la clé est vide et estActive() = false -> aucune connexion possible.
function cleSignature() {
  const mdp = config.admin.password || '';
  if (!mdp) return null;
  return crypto
    .createHash('sha256')
    .update(`lhairafro|${config.admin.sessionSecret || ''}|${mdp}`)
    .digest();
}

// L'espace admin est-il activable ? (mot de passe maître posé par Landry)
function estActive() {
  return Boolean(config.admin.password);
}

// --- Hachage scrypt (node:crypto, aucun module natif) ----------------------
// Format stocké : scrypt$<selHex>$<hashHex>
function hacher(secret) {
  const sel = crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(secret), sel, 64);
  return `scrypt$${sel.toString('hex')}$${dk.toString('hex')}`;
}
function verifierHash(secret, stocke) {
  if (!stocke) return false;
  const [algo, selHex, hashHex] = String(stocke).split('$');
  if (algo !== 'scrypt' || !selHex || !hashHex) return false;
  const dk = crypto.scryptSync(String(secret), Buffer.from(selHex, 'hex'), 64);
  const a = Buffer.from(hashHex, 'hex');
  return a.length === dk.length && crypto.timingSafeEqual(a, dk);
}

function ligneAuth() {
  try { return db.prepare('SELECT * FROM admin_auth WHERE id = 1').get(); }
  catch { return null; }
}

// Ludmilla a-t-elle déjà défini son propre mot de passe ?
function motDePassePersoDefini() {
  const r = ligneAuth();
  return Boolean(r && r.password_hash);
}

// Comparaison à temps constant avec le mot de passe MAÎTRE (bris de glace Landry).
function motDePasseMaitreValide(saisi) {
  const attendu = config.admin.password || '';
  if (!attendu) return false;
  const a = Buffer.from(String(saisi || ''));
  const b = Buffer.from(attendu);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Connexion : accepte le mot de passe PERSO de Ludmilla (prioritaire) OU le mot
// de passe maître de Landry (recours ultime, toujours accepté tant qu'il est posé).
function motDePasseValide(saisi) {
  const r = ligneAuth();
  if (r && r.password_hash && verifierHash(saisi, r.password_hash)) return true;
  return motDePasseMaitreValide(saisi);
}

// --- Code de récupération (le filet de Ludmilla, elle seule le détient) -----
// 12 caractères non ambigus (sans I,O,0,1), affichés en 3 groupes : XXXX-XXXX-XXXX.
function genererCode() {
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 12; i++) {
    if (i > 0 && i % 4 === 0) s += '-';
    s += alpha[crypto.randomInt(alpha.length)];
  }
  return s;
}
const normCode = (c) => String(c || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

// Définit le mot de passe perso de Ludmilla ET (re)génère son code de
// récupération. Renvoie le code EN CLAIR une seule fois (à afficher/copier).
function definirMotDePasse(nouveau) {
  const code = genererCode();
  const ph = hacher(String(nouveau));
  const rh = hacher(normCode(code));
  db.prepare(`INSERT INTO admin_auth (id, password_hash, recovery_hash, maj_le)
    VALUES (1, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash,
      recovery_hash = excluded.recovery_hash, maj_le = excluded.maj_le`).run(ph, rh);
  return code;
}

// Vérifie un code de récupération saisi.
function codeRecuperationValide(code) {
  const r = ligneAuth();
  if (!r || !r.recovery_hash) return false;
  return verifierHash(normCode(code), r.recovery_hash);
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

module.exports = {
  estActive, motDePasseValide, motDePasseMaitreValide, motDePassePersoDefini,
  creerJeton, jetonValide, protege,
  definirMotDePasse, codeRecuperationValide,
};
