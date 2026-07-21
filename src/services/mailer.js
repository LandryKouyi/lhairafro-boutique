'use strict';

// Envoi d'e-mails de l'arrière-boutique via SMTP Gmail (compte relais dédié à
// la boutique). Choisi car : aucun réglage DNS (pas de DKIM/SPF à poser ni à
// attendre — c'est ce qui rendait Brevo « trop protocolaire »), envoi via un
// compte Gmail gratuit (~500 destinataires/jour), et ne touche PAS aux MX de
// lhairafro.com : le renvoi Cloudflare qui achemine l'OTP PVit reste intact.
//
// Le compte Gmail est un simple RELAIS SERVEUR : ses identifiants vivent dans
// les variables d'environnement (Render), personne ne s'y connecte au
// quotidien. Ludmilla n'utilise que le Dashboard ; le serveur ouvre lui-même la
// connexion SMTP pour expédier au nom de contact@lhairafro.com (alias « Envoyer
// en tant que » configuré dans le compte Gmail).
//
//   Hôte SMTP : smtp.gmail.com  —  port 465 (SSL/TLS implicite)
//   Auth      : GMAIL_USER + GMAIL_APP_PASSWORD (mot de passe d'application,
//               2FA requise sur le compte Google)
//
// Dégradation gracieuse : sans identifiants Gmail, estConfigure() = false et
// l'envoi est refusé proprement (le module Messagerie s'affiche « en attente »).

const nodemailer = require('nodemailer');
const config = require('../config');

const cfg = () => config.mail;

// Transporteur SMTP mis en cache (recréé si les identifiants changent).
let _transport = null;
let _transportKey = '';

function transport() {
  const c = cfg();
  const key = `${c.gmailUser}::${c.gmailAppPassword}`;
  if (_transport && _transportKey === key) return _transport;
  _transport = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // TLS implicite
    auth: { user: c.gmailUser, pass: c.gmailAppPassword },
  });
  _transportKey = key;
  return _transport;
}

function estConfigure() {
  const c = cfg();
  return Boolean(c.gmailUser && c.gmailAppPassword && c.fromEmail);
}

// Échappe le strict minimum pour bâtir un corps HTML lisible à partir de texte
// brut (les retours à la ligne deviennent des <br>).
function texteVersHtml(texte) {
  const esc = String(texte || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#12181f;line-height:1.6">${esc.replace(/\n/g, '<br>')}</div>`;
}

// Envoie un e-mail. Renvoie { messageId }.
//   dest    : adresse du destinataire (string) — obligatoire
//   sujet   : objet du mail
//   texte   : corps en texte brut (obligatoire)
//   html    : corps HTML (facultatif ; dérivé du texte sinon)
//   replyTo : adresse de réponse (facultatif)
async function envoyer({ dest, sujet, texte, html, replyTo }) {
  if (!estConfigure()) {
    const e = new Error("Messagerie non activée : le compte Gmail d'envoi n'est pas encore configuré sur le serveur.");
    e.status = 503; e.expose = true; throw e;
  }
  const adresse = String(dest || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adresse)) {
    const e = new Error('Adresse e-mail du destinataire invalide.'); e.status = 400; e.expose = true; throw e;
  }
  const corpsTexte = String(texte || '').trim();
  if (!corpsTexte && !html) {
    const e = new Error('Le message est vide.'); e.status = 400; e.expose = true; throw e;
  }

  // From : l'alias « Envoyer en tant que » (contact@lhairafro.com). Gmail
  // n'autorise cet expéditeur que si l'alias a bien été validé dans le compte.
  const message = {
    from: { name: cfg().fromName, address: cfg().fromEmail },
    to: adresse,
    subject: String(sujet || '(sans objet)').slice(0, 250),
    text: corpsTexte || undefined,
    html: html || texteVersHtml(corpsTexte),
  };
  if (replyTo) message.replyTo = String(replyTo).trim();

  try {
    const info = await transport().sendMail(message);
    return { messageId: String(info.messageId || '') };
  } catch (err) {
    // 534/535 = auth refusée (mot de passe d'app invalide / 2FA absente) ;
    // 553 = expéditeur non autorisé (alias « Envoyer en tant que » non validé).
    const detail = (err && (err.response || err.message)) || 'erreur SMTP';
    const e = new Error(`Échec de l'envoi de l'e-mail (${detail}).`);
    e.status = 502; e.expose = true; throw e;
  }
}

module.exports = { estConfigure, envoyer, texteVersHtml };
