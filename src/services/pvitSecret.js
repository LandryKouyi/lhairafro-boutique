'use strict';

// Magasin mémoire de la clé secrète PVit.
//
// PVit ne renvoie PAS la clé secrète dans la réponse à renew-secret : il la
// GÉNÈRE puis l'ENVOIE (POST) à l'« URL de réception de clé secrète » configurée
// dans le tableau de bord (Paramétrages → Urls). Notre endpoint POST
// /api/pvit-secret la reçoit et l'enregistre ici ; le service pvit.js la relit
// pour signer les appels (en-tête X-Secret). La clé étant éphémère (~3600 s), on
// la garde en mémoire avec sa date d'expiration et on la renouvelle à la demande.
//
// (Mémoire process : suffisant pour une instance unique. Perdue au redémarrage —
//  sans gravité : le prochain paiement déclenche un renew-secret.)

const store = new Map(); // accountCode -> { secret, expireLe }

function enregistrer(accountCode, secret, ttlSecondes = 3600) {
  if (!accountCode || !secret) return false;
  const ttl = (Number(ttlSecondes) || 3600) * 1000;
  // Marge de 60 s pour ne pas utiliser une clé au bord de l'expiration.
  store.set(accountCode, { secret, expireLe: Date.now() + ttl - 60_000 });
  return true;
}

function lire(accountCode) {
  const e = store.get(accountCode);
  if (e && Date.now() < e.expireLe) return e.secret;
  return null;
}

function invalider(accountCode) {
  store.delete(accountCode);
}

module.exports = { enregistrer, lire, invalider };
