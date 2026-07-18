'use strict';

// Envoi d'e-mails de l'arrière-boutique via l'API transactionnelle Brevo
// (ex-Sendinblue). Choisi car : offre gratuite (300 mails/jour), envoi par API
// HTTPS simple (aucune dépendance native / port SMTP), et authentification du
// domaine par DKIM/SPF en enregistrements TXT — ce qui NE touche PAS aux MX de
// lhairafro.com et préserve donc le renvoi Cloudflare qui achemine l'OTP PVit.
//
// Doc : https://developers.brevo.com/reference/sendtransacemail
//   POST https://api.brevo.com/v3/smtp/email
//   En-têtes : api-key: <clé>, content-type: application/json
//   Corps    : { sender:{name,email}, to:[{email}], subject, htmlContent,
//                textContent, replyTo? }
//
// Dégradation gracieuse : sans BREVO_API_KEY, estConfigure() = false et l'envoi
// est refusé proprement (le module Messagerie s'affiche « en attente »).

const config = require('../config');

const cfg = () => config.mail;
const API_URL = 'https://api.brevo.com/v3/smtp/email';

function estConfigure() {
  const c = cfg();
  return Boolean(c.brevoApiKey && c.fromEmail);
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
    const e = new Error("Messagerie non activée : la clé d'envoi Brevo n'est pas encore configurée sur le serveur.");
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

  const payload = {
    sender: { name: cfg().fromName, email: cfg().fromEmail },
    to: [{ email: adresse }],
    subject: String(sujet || '(sans objet)').slice(0, 250),
    htmlContent: html || texteVersHtml(corpsTexte),
    textContent: corpsTexte || undefined,
  };
  if (replyTo) payload.replyTo = { email: String(replyTo).trim() };

  const r = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'api-key': cfg().brevoApiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = data.message || data.code || `HTTP ${r.status}`;
    const e = new Error(`Échec de l'envoi de l'e-mail (${detail}).`);
    e.status = 502; e.expose = true; throw e;
  }
  return { messageId: String(data.messageId || '') };
}

module.exports = { estConfigure, envoyer, texteVersHtml };
