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

// --- Rôles & administratrices secondaires -----------------------------------
// La SUPER admin (Ludmilla) s'authentifie via admin_auth / le mot de passe
// maître. Elle peut créer jusqu'à MAX_ADMINS administratrices secondaires
// (rôle 'admin'), chacune avec une adresse pro @emailDomain et son propre code
// d'accès. Identité super par défaut : l'adresse commune de la boutique.
const MAX_ADMINS = 2;
const SUPER_EMAIL = () => String(config.mail && config.mail.fromEmail || 'contact@lhairafro.com').toLowerCase();
const SUPER_NOM = 'Ludmilla';

function err(status, message) {
  const e = new Error(message); e.status = status; e.expose = true; return e;
}

function adminParId(id) {
  return db.prepare('SELECT * FROM admins WHERE id = ?').get(parseInt(id, 10));
}
function listeAdmins() {
  return db.prepare('SELECT id, email, nom, actif, cree_le FROM admins ORDER BY id').all();
}
function nombreAdmins() {
  return db.prepare('SELECT COUNT(*) AS n FROM admins').get().n;
}

function emailValide(email) {
  const dom = config.admin.emailDomain.replace(/\./g, '\\.');
  return new RegExp(`^[a-z0-9](?:[a-z0-9._+-]*[a-z0-9])?@${dom}$`, 'i').test(String(email || ''));
}

// Un code d'accès ne doit ni être trivial, ni entrer en collision avec le mot de
// passe maître (qui donnerait un accès SUPER par erreur).
function verifierCodeAcceptable(code) {
  if (String(code).length < 6) throw err(400, "Le code d'accès doit contenir au moins 6 caractères.");
  if (config.admin.password && String(code) === config.admin.password) {
    throw err(400, 'Ce code est réservé. Choisissez-en un autre.');
  }
}

// Crée une administratrice secondaire. { email, nom, code } -> ligne créée.
function creerAdmin({ email, nom, code }) {
  email = String(email || '').trim().toLowerCase();
  nom = String(nom || '').trim();
  code = String(code || '');
  if (!emailValide(email)) throw err(400, `Adresse invalide : elle doit se terminer par @${config.admin.emailDomain}.`);
  if (email === SUPER_EMAIL()) throw err(400, 'Cette adresse est réservée à la boutique.');
  verifierCodeAcceptable(code);
  if (nombreAdmins() >= MAX_ADMINS) throw err(400, `Limite atteinte : ${MAX_ADMINS} administratrices au maximum.`);
  if (db.prepare('SELECT id FROM admins WHERE email = ?').get(email)) throw err(400, 'Une administratrice utilise déjà cette adresse.');
  const info = db.prepare('INSERT INTO admins (email, nom, password_hash, actif) VALUES (?, ?, ?, 1)')
    .run(email, nom, hacher(code));
  return adminParId(info.lastInsertRowid);
}

// Modifie une admin secondaire : renommer, réinitialiser le code, (dés)activer.
function modifierAdmin(id, { nom, code, actif }) {
  const a = adminParId(id);
  if (!a) throw err(404, 'Administratrice introuvable.');
  if (nom !== undefined) db.prepare('UPDATE admins SET nom = ? WHERE id = ?').run(String(nom).trim(), a.id);
  if (actif !== undefined) db.prepare('UPDATE admins SET actif = ? WHERE id = ?').run(actif ? 1 : 0, a.id);
  if (code !== undefined && String(code) !== '') {
    verifierCodeAcceptable(code);
    db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hacher(String(code)), a.id);
  }
  return adminParId(id);
}

function supprimerAdmin(id) {
  const info = db.prepare('DELETE FROM admins WHERE id = ?').run(parseInt(id, 10));
  if (!info.changes) throw err(404, 'Administratrice introuvable.');
}

// Reconnaît QUI se connecte à partir du seul code d'accès saisi.
// Renvoie { role:'super'|'admin', adminId } ou null.
function identifier(code) {
  const saisi = String(code || '');
  // Super : mot de passe perso de Ludmilla (prioritaire) OU mot de passe maître.
  if (motDePasseValide(saisi)) return { role: 'super', adminId: 0 };
  // Admins secondaires actives.
  const subs = db.prepare('SELECT id, password_hash FROM admins WHERE actif = 1').all();
  for (const s of subs) {
    if (verifierHash(saisi, s.password_hash)) return { role: 'admin', adminId: s.id };
  }
  return null;
}

// Fabrique un jeton de session valable config.admin.sessionHeures heures.
// identity = { role, adminId } (défaut : super). Le rôle et l'id sont EMBARQUÉS
// dans le jeton ; la clé de signature reste dérivée du mot de passe maître.
function creerJeton(identity) {
  const cle = cleSignature();
  if (!cle) return null;
  const role = identity && identity.role === 'admin' ? 'admin' : 'super';
  const a = (identity && identity.adminId) ? identity.adminId : 0;
  const exp = Date.now() + config.admin.sessionHeures * 3600 * 1000;
  const payload = b64url(Buffer.from(JSON.stringify({ r: role, a, exp })));
  const sig = b64url(crypto.createHmac('sha256', cle).update(payload).digest());
  return `${payload}.${sig}`;
}

// Lit un jeton : signature valide + non expiré. Renvoie { r, a } ou null.
function lireJeton(jeton) {
  const cle = cleSignature();
  if (!cle || !jeton || typeof jeton !== 'string') return null;
  const [payload, sig] = jeton.split('.');
  if (!payload || !sig) return null;
  const attendu = crypto.createHmac('sha256', cle).update(payload).digest();
  const recu = fromB64url(sig);
  if (recu.length !== attendu.length || !crypto.timingSafeEqual(recu, attendu)) return null;
  try {
    const d = JSON.parse(fromB64url(payload).toString('utf8'));
    if ((d.r === 'super' || d.r === 'admin') && typeof d.exp === 'number' && d.exp > Date.now()) {
      return { r: d.r, a: d.a || 0 };
    }
    return null;
  } catch {
    return null;
  }
}

function jetonValide(jeton) { return lireJeton(jeton) !== null; }

// Middleware Express : protège les routes /api/admin/*. Lit le jeton dans
// l'en-tête « Authorization: Bearer <jeton> » et attache req.admin
// = { role, adminId, email, nom }.
function protege(req, res, next) {
  if (!estActive()) {
    return res.status(503).json({ erreur: "L'espace de gestion n'est pas encore activé. Le mot de passe admin doit être défini sur le serveur." });
  }
  const h = req.headers.authorization || '';
  const jeton = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  const p = lireJeton(jeton);
  if (!p) {
    return res.status(401).json({ erreur: 'Session expirée ou invalide. Reconnectez-vous.' });
  }
  if (p.r === 'super') {
    req.admin = { role: 'super', adminId: 0, email: SUPER_EMAIL(), nom: SUPER_NOM };
    return next();
  }
  // Admin secondaire : doit toujours exister ET être active (révocation immédiate).
  const a = adminParId(p.a);
  if (!a || !a.actif) {
    return res.status(401).json({ erreur: 'Votre accès a été modifié. Reconnectez-vous.' });
  }
  req.admin = { role: 'admin', adminId: a.id, email: String(a.email).toLowerCase(), nom: a.nom };
  next();
}

// Middleware Express : réserve une route à la super admin.
function superSeul(req, res, next) {
  if (!req.admin || req.admin.role !== 'super') {
    return res.status(403).json({ erreur: 'Action réservée à la super administratrice.' });
  }
  next();
}

module.exports = {
  estActive, motDePasseValide, motDePasseMaitreValide, motDePassePersoDefini,
  creerJeton, jetonValide, lireJeton, protege, superSeul,
  definirMotDePasse, codeRecuperationValide,
  MAX_ADMINS, identifier, listeAdmins, adminParId, nombreAdmins,
  creerAdmin, modifierAdmin, supprimerAdmin,
};
