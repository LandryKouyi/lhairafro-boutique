// Cloudflare Email Worker — réception des e-mails de contact@lhairafro.com.
//
// Actions à chaque e-mail entrant :
//   1) On le RENVOIE vers la destination principale (Gmail de Ludmilla).
//   1 bis) Si c'est un e-mail PVit (expéditeur *@mypvit.pro : OTP, clé secrète,
//      notifications du compte marchand), on le renvoie AUSSI à Landry, pour qu'il
//      garde la main sur l'administration PVit sans voir le reste du courrier.
//   2) On le PARSE et on le POSTe au webhook de la boutique (/api/mail-inbound)
//      pour qu'il s'affiche dans la messagerie du Dashboard de Ludmilla.
//
// Les renvois et le webhook sont indépendants et best-effort : si l'un échoue,
// les autres se font quand même.
//
// Variables (Settings → Variables du Worker) :
//   FORWARD_TO     = lhairafro26@gmail.com   (destination principale, doit être une
//                    destination VÉRIFIÉE dans Cloudflare Email Routing ;
//                    remplace chrysoslandry@gmail.com depuis le 2026-07-24)
//   OTP_FORWARD_TO = chrysoslandry@gmail.com  (copie des SEULS e-mails PVit ;
//                    doit aussi être une destination VÉRIFIÉE ; vide = désactivé)
//   INBOUND_URL    = https://lhairafro.com/api/mail-inbound
//   INBOUND_TOKEN  = <même valeur que MAIL_INBOUND_TOKEN sur Render>  (secret)

import PostalMime from 'postal-mime';

export default {
  async email(message, env, ctx) {
    // 1) Renvoi vers la destination principale (best-effort, sans parsing).
    if (env.FORWARD_TO) {
      try { await message.forward(env.FORWARD_TO); } catch (e) { /* ignore */ }
    }

    // 2) Parse (nécessaire pour le webhook ET pour filtrer les e-mails PVit).
    let mail = null;
    try {
      const buf = await new Response(message.raw).arrayBuffer();
      mail = await PostalMime.parse(buf);
    } catch (e) {
      console.log('parse e-mail échec :', e && e.message);
    }

    // 2 bis) Copie des e-mails PVit vers Landry (best-effort). On teste à la fois
    // l'expéditeur d'enveloppe et l'en-tête From, au cas où PVit passe par un
    // relais tiers dont l'enveloppe porte un autre domaine.
    if (env.OTP_FORWARD_TO) {
      const envFrom = (message.from || '').toLowerCase();
      const hdrFrom = ((mail && mail.from && mail.from.address) || '').toLowerCase();
      if (envFrom.includes('mypvit.pro') || hdrFrom.includes('mypvit.pro')) {
        try { await message.forward(env.OTP_FORWARD_TO); } catch (e) { /* ignore */ }
      }
    }

    // 3) POST vers la boutique (best-effort) — seulement si le parsing a réussi.
    if (mail) {
      try {
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
    }
  },
};
