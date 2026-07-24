'use strict';

// Messagerie de l'arrière-boutique : boîte de réception + envoi depuis
// contact@lhairafro.com. Les routes /api/admin/* sont protégées (auth.protege) ;
// /api/mail-inbound est publique mais protégée par un jeton partagé.

const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const mailer = require('../services/mailer');

const CHAMPS_LISTE = 'id, direction, de_email, de_nom, a_email, sujet, lu, cree_le';

// Petit extrait de prévisualisation du corps (pour la liste).
function apercu(row) {
  const t = (row.corps_texte || '').replace(/\s+/g, ' ').trim();
  return t.slice(0, 140);
}

// Adresse de filtrage : les administratrices secondaires ne voient QUE leur
// propre courrier (reçu sur leur adresse pro / envoyé depuis celle-ci). La super
// admin (Ludmilla) voit TOUT -> null (aucun filtre).
function emailFiltre(req) {
  return (req.admin && req.admin.role === 'admin') ? String(req.admin.email).toLowerCase() : null;
}

// Un message appartient-il à cette administratrice ? (contrôle d'accès unitaire)
function messageAutorise(req, row) {
  const email = emailFiltre(req);
  if (!email || !row) return true; // super : tout ; row null géré ailleurs
  if (row.direction === 'in') return String(row.a_email || '').toLowerCase() === email;
  return String(row.de_email || '').toLowerCase() === email; // 'out'
}

// ---- Admin : état de la messagerie ----------------------------------------
// GET /api/admin/messagerie/etat -> de quoi afficher le bon état côté front.
function etat(req, res) {
  const email = emailFiltre(req);
  let nonLus, total;
  if (email) {
    nonLus = db.prepare("SELECT COUNT(*) AS n FROM messages WHERE direction='in' AND lu=0 AND lower(a_email)=?").get(email).n;
    total = db.prepare("SELECT COUNT(*) AS n FROM messages WHERE (direction='in' AND lower(a_email)=?) OR (direction='out' AND lower(de_email)=?)").get(email, email).n;
  } else {
    nonLus = db.prepare("SELECT COUNT(*) AS n FROM messages WHERE direction='in' AND lu=0").get().n;
    total = db.prepare('SELECT COUNT(*) AS n FROM messages').get().n;
  }
  res.json({
    envoiActif: mailer.estConfigure(),
    receptionActive: Boolean(config.mail.inboundToken),
    from: (req.admin && req.admin.email) || config.mail.fromEmail,
    nonLus,
    total,
  });
}

// ---- Admin : liste des messages -------------------------------------------
// GET /api/admin/messages?dossier=in|out|tous
function liste(req, res) {
  const dossier = String(req.query.dossier || 'tous');
  const email = emailFiltre(req);
  const cond = [];
  const args = [];
  if (dossier === 'in') {
    cond.push("direction='in'");
    if (email) { cond.push('lower(a_email)=?'); args.push(email); }
  } else if (dossier === 'out') {
    cond.push("direction='out'");
    if (email) { cond.push('lower(de_email)=?'); args.push(email); }
  } else if (email) {
    cond.push("((direction='in' AND lower(a_email)=?) OR (direction='out' AND lower(de_email)=?))");
    args.push(email, email);
  }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT ${CHAMPS_LISTE}, corps_texte FROM messages ${where} ORDER BY id DESC`).all(...args);
  const messages = rows.map((r) => ({
    id: r.id, direction: r.direction, de_email: r.de_email, de_nom: r.de_nom,
    a_email: r.a_email, sujet: r.sujet, lu: r.lu, cree_le: r.cree_le, apercu: apercu(r),
  }));
  const nonLus = email
    ? db.prepare("SELECT COUNT(*) AS n FROM messages WHERE direction='in' AND lu=0 AND lower(a_email)=?").get(email).n
    : db.prepare("SELECT COUNT(*) AS n FROM messages WHERE direction='in' AND lu=0").get().n;
  res.json({ messages, nonLus, envoiActif: mailer.estConfigure() });
}

// ---- Admin : détail d'un message (marque « lu ») --------------------------
// GET /api/admin/messages/:id
function detail(req, res) {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  if (!row || !messageAutorise(req, row)) { const e = new Error('Message introuvable.'); e.status = 404; e.expose = true; throw e; }
  if (row.direction === 'in' && !row.lu) {
    db.prepare('UPDATE messages SET lu = 1 WHERE id = ?').run(id);
    row.lu = 1;
  }
  res.json({ message: row });
}

// ---- Admin : envoyer un e-mail --------------------------------------------
// POST /api/admin/messages/envoyer  { dest, sujet, texte, repondA? }
async function envoyer(req, res, next) {
  try {
    const body = req.body || {};
    const dest = String(body.dest || body.a || '').trim();
    const sujet = String(body.sujet || '').trim();
    const texte = String(body.texte || body.corps || '').trim();
    if (!texte) { const e = new Error('Le message est vide.'); e.status = 400; e.expose = true; throw e; }

    // in_reply_to éventuel : si on répond à un message reçu de la boîte.
    let inReplyTo = '';
    const repondAId = parseInt(body.repondAId, 10);
    if (Number.isInteger(repondAId)) {
      const src = db.prepare('SELECT message_id FROM messages WHERE id = ?').get(repondAId);
      if (src) inReplyTo = src.message_id || '';
    }

    // Expéditeur = l'adresse pro de l'administratrice connectée (super = adresse
    // commune de la boutique). Enregistré tel quel dans « de_email » pour que sa
    // messagerie retrouve ses propres envois.
    const deEmail = (req.admin && req.admin.email) || config.mail.fromEmail;
    const deNom = (req.admin && req.admin.nom) || config.mail.fromName;
    const { messageId } = await mailer.envoyer({ dest, sujet, texte, from: { name: deNom, address: deEmail } });

    db.prepare(
      `INSERT INTO messages (direction, de_email, de_nom, a_email, sujet, corps_texte, message_id, in_reply_to, lu)
       VALUES ('out', ?, ?, ?, ?, ?, ?, ?, 1)`
    ).run(deEmail, deNom, dest, sujet, texte, messageId, inReplyTo);

    res.status(201).json({ ok: true, messageId });
  } catch (e) {
    next(e);
  }
}

// ---- Admin : marquer lu / non lu ------------------------------------------
// PATCH /api/admin/messages/:id/lu  { lu:true|false }
function marquerLu(req, res) {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT id, direction, a_email, de_email FROM messages WHERE id = ?').get(id);
  if (!row || !messageAutorise(req, row)) { const e = new Error('Message introuvable.'); e.status = 404; e.expose = true; throw e; }
  const lu = (req.body && req.body.lu === false) ? 0 : 1;
  db.prepare('UPDATE messages SET lu = ? WHERE id = ?').run(lu, id);
  res.json({ ok: true, lu });
}

// ---- Admin : supprimer un message -----------------------------------------
// DELETE /api/admin/messages/:id
function supprimer(req, res) {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT id, direction, a_email, de_email FROM messages WHERE id = ?').get(id);
  if (!row || !messageAutorise(req, row)) { const e = new Error('Message introuvable.'); e.status = 404; e.expose = true; throw e; }
  db.prepare('DELETE FROM messages WHERE id = ?').run(id);
  res.json({ ok: true });
}

// ---- Public : réception d'un e-mail (Cloudflare Email Worker) --------------
// POST /api/mail-inbound  (protégé par jeton partagé, en en-tête OU dans le corps)
// Corps attendu (posté par le Worker) :
//   { token, from, fromName?, to, subject, text, html?, messageId?, inReplyTo? }
function inbound(req, res) {
  const attendu = config.mail.inboundToken;
  if (!attendu) return res.status(503).json({ erreur: 'Réception non activée.' });

  const body = req.body || {};
  const fourni = req.get('x-inbound-token') || body.token || '';
  // Comparaison à temps constant pour éviter les fuites par timing.
  const ok = fourni.length === attendu.length &&
    crypto.timingSafeEqual(Buffer.from(String(fourni)), Buffer.from(attendu));
  if (!ok) return res.status(401).json({ erreur: 'Jeton invalide.' });

  const de = String(body.from || body.de || '').trim();
  if (!de) return res.status(400).json({ erreur: 'Expéditeur manquant.' });

  db.prepare(
    `INSERT INTO messages (direction, de_email, de_nom, a_email, sujet, corps_texte, corps_html, message_id, in_reply_to, lu)
     VALUES ('in', ?, ?, ?, ?, ?, ?, ?, ?, 0)`
  ).run(
    de,
    String(body.fromName || body.de_nom || '').trim().slice(0, 200),
    String(body.to || body.a || config.mail.fromEmail).trim(),
    String(body.subject || body.sujet || '(sans objet)').slice(0, 250),
    String(body.text || body.texte || '').slice(0, 100000),
    String(body.html || '').slice(0, 200000),
    String(body.messageId || body.message_id || '').slice(0, 400),
    String(body.inReplyTo || body.in_reply_to || '').slice(0, 400)
  );
  res.status(201).json({ ok: true });
}

module.exports = { etat, liste, detail, envoyer, marquerLu, supprimer, inbound };
