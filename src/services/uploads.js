'use strict';

// Sauvegarde des photos produits téléversées par Ludmilla.
//
// L'admin envoie l'image en Data URL (base64) dans le corps JSON — l'image est
// redimensionnée côté navigateur (max ~900 px, JPEG) AVANT l'envoi, donc les
// charges utiles restent petites. Ici on décode, on valide le type, et on écrit
// le fichier dans config.uploadsDir (sur le disque persistant en production).
// Aucune dépendance : pas de multer ni de traitement multipart.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

fs.mkdirSync(config.uploadsDir, { recursive: true });

const EXT_PAR_MIME = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

// Décode une Data URL (data:image/...;base64,....) et enregistre le fichier.
// Renvoie le chemin public (ex. /uploads/prod-12-a1b2c3.jpg) ou lève une erreur.
function enregistrerDataUrl(dataUrl, prefixe = 'img') {
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(String(dataUrl || ''));
  if (!m) {
    const e = new Error('Image invalide. Choisissez un fichier image (JPG, PNG ou WebP).');
    e.status = 400; e.expose = true; throw e;
  }
  const mime = m[1].toLowerCase();
  const ext = EXT_PAR_MIME[mime];
  if (!ext) {
    const e = new Error('Format d\'image non pris en charge. Utilisez JPG, PNG ou WebP.');
    e.status = 400; e.expose = true; throw e;
  }
  const buf = Buffer.from(m[2], 'base64');
  // Garde-fou : 6 Mo max après décodage (le redimensionnement navigateur donne
  // en pratique < 300 Ko).
  if (buf.length > 6 * 1024 * 1024) {
    const e = new Error('Image trop lourde. Réessayez avec une photo plus légère.');
    e.status = 413; e.expose = true; throw e;
  }
  const nom = `${prefixe}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(config.uploadsDir, nom), buf);
  return `/uploads/${nom}`;
}

// Supprime un fichier précédemment servi sous /uploads (best-effort, jamais bloquant).
function supprimerParCheminPublic(cheminPublic) {
  if (!cheminPublic || !String(cheminPublic).startsWith('/uploads/')) return;
  const nom = path.basename(cheminPublic); // évite toute traversée de répertoire
  const abs = path.join(config.uploadsDir, nom);
  fs.rm(abs, { force: true }, () => {});
}

module.exports = { enregistrerDataUrl, supprimerParCheminPublic, dir: config.uploadsDir };
