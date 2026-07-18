// Cloudflare Email Worker — réception des e-mails de contact@lhairafro.com.
//
// Deux actions à chaque e-mail entrant :
//   1) On le RENVOIE vers l'adresse de secours (Gmail de Landry) — cela préserve
//      la réception des OTP PVit et ne change rien à l'existant.
//   2) On le PARSE et on le POSTe au webhook de la boutique (/api/mail-inbound)
//      pour qu'il s'affiche dans la messagerie du Dashboard de Ludmilla.
//
// Le renvoi et le webhook sont indépendants : si le webhook échoue, l'e-mail est
// quand même renvoyé (et inversement).
//
// Variables (Settings → Variables du Worker) :
//   FORWARD_TO    = chrysoslandry@gmail.com   (adresse de secours, doit être une
//                   destination VÉRIFIÉE dans Cloudflare Email Routing)
//   INBOUND_URL   = https://lhairafro.com/api/mail-inbound
//   INBOUND_TOKEN = <même valeur que MAIL_INBOUND_TOKEN sur Render>  (secret)

import PostalMime from 'postal-mime';

export default {
  async email(message, env, ctx) {
    // 1) Renvoi vers l'adresse de secours (best-effort).
    if (env.FORWARD_TO) {
      try { await message.forward(env.FORWARD_TO); } catch (e) { /* ignore */ }
    }

    // 2) Parse + POST vers la boutique (best-effort).
    try {
      const buf = await new Response(message.raw).arrayBuffer();
      const mail = await PostalMime.parse(buf);
      const payload = {
        token: env.INBOUND_TOKEN,
        from: message.from,
        fromName: (mail.from && mail.from.name) || '',
        to: message.to,
        subject: mail.subject || '(sans objet)',
        text: mail.text || '',
        html: mail.html || '',
        messageId: mail.messageId || '',
        inReplyTo: mail.inReplyTo || '',
      };
      await fetch(env.INBOUND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-inbound-token': env.INBOUND_TOKEN },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      // On ne rejette pas l'e-mail à cause d'un souci de webhook.
      console.log('webhook mail-inbound échec :', e && e.message);
    }
  },
};
