'use strict';

// Arrière-boutique L'Hair Afro — logique de l'espace de gestion de Ludmilla.
// Toutes les routes (sauf /login) sont protégées par auth.protege (voir app.js).

const db = require('../db');
const config = require('../config');
const auth = require('../services/auth');
const uploads = require('../services/uploads');

// ---- Connexion -------------------------------------------------------------

// POST /api/admin/login  { motdepasse }
function login(req, res) {
  if (!auth.estActive()) {
    return res.status(503).json({ erreur: "L'espace de gestion n'est pas encore activé sur le serveur." });
  }
  const saisi = (req.body && (req.body.motdepasse || req.body.password)) || '';
  if (!auth.motDePasseValide(saisi)) {
    return res.status(401).json({ erreur: 'Mot de passe incorrect.' });
  }
  return res.json({ ok: true, jeton: auth.creerJeton(), expireHeures: config.admin.sessionHeures });
}

// GET /api/admin/session — vérifie qu'un jeton est encore valide (appelée au chargement).
function session(req, res) {
  res.json({ ok: true, motDePassePerso: auth.motDePassePersoDefini() });
}

// POST /api/admin/changer-motdepasse  { actuel, nouveau } — Ludmilla définit / change
// SON mot de passe (que Landry ne connaît pas). Renvoie un NOUVEAU code de
// récupération à conserver (affiché une seule fois).
function changerMotDePasse(req, res) {
  const actuel = (req.body && (req.body.actuel || req.body.actuelMotDePasse)) || '';
  const nouveau = (req.body && (req.body.nouveau || req.body.nouveauMotDePasse)) || '';
  if (!auth.motDePasseValide(actuel)) {
    const e = new Error('Mot de passe actuel incorrect.'); e.status = 401; e.expose = true; throw e;
  }
  if (String(nouveau).length < 6) {
    const e = new Error('Le nouveau mot de passe doit contenir au moins 6 caractères.'); e.status = 400; e.expose = true; throw e;
  }
  const code = auth.definirMotDePasse(String(nouveau));
  res.json({ ok: true, codeRecuperation: code });
}

// POST /api/admin/reinitialiser  { code, nouveau } — PUBLIC (écran de connexion).
// Ludmilla se déverrouille SEULE avec son code de récupération, sans Landry.
// Renvoie un jeton (connexion immédiate) + un nouveau code de récupération.
function reinitialiser(req, res) {
  if (!auth.estActive()) {
    return res.status(503).json({ erreur: "L'espace de gestion n'est pas encore activé sur le serveur." });
  }
  const code = (req.body && req.body.code) || '';
  const nouveau = (req.body && (req.body.nouveau || req.body.nouveauMotDePasse)) || '';
  if (!auth.codeRecuperationValide(code)) {
    return res.status(401).json({ erreur: 'Code de récupération invalide. Vérifiez la saisie ou contactez le support.' });
  }
  if (String(nouveau).length < 6) {
    return res.status(400).json({ erreur: 'Le nouveau mot de passe doit contenir au moins 6 caractères.' });
  }
  const nouveauCode = auth.definirMotDePasse(String(nouveau));
  res.json({ ok: true, jeton: auth.creerJeton(), codeRecuperation: nouveauCode });
}

// ---- Produits (CRUD complet) ----------------------------------------------

const CHAMPS_PRODUIT = 'id, categorie, nom, description, prix, emoji, couleur, image, actif, ordre';

// GET /api/admin/produits — TOUS les produits (actifs et désactivés).
function listeProduits(req, res) {
  const rows = db.prepare(`SELECT ${CHAMPS_PRODUIT} FROM produits ORDER BY ordre, id`).all();
  res.json({ produits: rows });
}

// Nettoie et valide le corps d'un produit. `partiel` autorise l'absence de champs (PUT complet attendu sinon).
function lireProduit(body) {
  const nom = String(body.nom || '').trim();
  const categorie = String(body.categorie || '').trim();
  const prix = parseInt(body.prix, 10);
  if (!nom) { const e = new Error('Le nom du produit est obligatoire.'); e.status = 400; e.expose = true; throw e; }
  if (!categorie) { const e = new Error('La catégorie est obligatoire (ex. Soins, Coiffage, Accessoires).'); e.status = 400; e.expose = true; throw e; }
  if (!Number.isInteger(prix) || prix < 0) { const e = new Error('Le prix doit être un nombre entier de FCFA (0 ou plus).'); e.status = 400; e.expose = true; throw e; }
  return {
    categorie,
    nom,
    description: String(body.description || '').trim(),
    prix,
    emoji: String(body.emoji || '').trim() || '🛍️',
    couleur: /^#[0-9a-fA-F]{3,8}$/.test(String(body.couleur || '').trim()) ? String(body.couleur).trim() : '#f7d9e8',
    image: String(body.image || '').trim(),
    actif: body.actif === undefined ? 1 : (body.actif ? 1 : 0),
    ordre: Number.isInteger(parseInt(body.ordre, 10)) ? parseInt(body.ordre, 10) : 0,
  };
}

// POST /api/admin/produits — création.
function creerProduit(req, res) {
  const p = lireProduit(req.body || {});
  // Ordre par défaut : à la fin du catalogue si non fourni.
  if (!req.body || req.body.ordre === undefined || req.body.ordre === '') {
    const max = db.prepare('SELECT COALESCE(MAX(ordre), 0) AS m FROM produits').get().m;
    p.ordre = max + 1;
  }
  const info = db.prepare(
    `INSERT INTO produits (categorie, nom, description, prix, emoji, couleur, image, actif, ordre)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(p.categorie, p.nom, p.description, p.prix, p.emoji, p.couleur, p.image, p.actif, p.ordre);
  const row = db.prepare(`SELECT ${CHAMPS_PRODUIT} FROM produits WHERE id = ?`).get(info.lastInsertRowid);
  res.status(201).json({ ok: true, produit: row });
}

// PUT /api/admin/produits/:id — modification complète.
function modifierProduit(req, res) {
  const id = parseInt(req.params.id, 10);
  const existant = db.prepare('SELECT id FROM produits WHERE id = ?').get(id);
  if (!existant) { const e = new Error('Produit introuvable.'); e.status = 404; e.expose = true; throw e; }
  const p = lireProduit(req.body || {});
  db.prepare(
    `UPDATE produits SET categorie=?, nom=?, description=?, prix=?, emoji=?, couleur=?, image=?, actif=?, ordre=? WHERE id=?`
  ).run(p.categorie, p.nom, p.description, p.prix, p.emoji, p.couleur, p.image, p.actif, p.ordre, id);
  const row = db.prepare(`SELECT ${CHAMPS_PRODUIT} FROM produits WHERE id = ?`).get(id);
  res.json({ ok: true, produit: row });
}

// PATCH /api/admin/produits/:id/actif  { actif:true|false } — activer / désactiver.
function basculerActif(req, res) {
  const id = parseInt(req.params.id, 10);
  const existant = db.prepare('SELECT id FROM produits WHERE id = ?').get(id);
  if (!existant) { const e = new Error('Produit introuvable.'); e.status = 404; e.expose = true; throw e; }
  const actif = (req.body && req.body.actif) ? 1 : 0;
  db.prepare('UPDATE produits SET actif = ? WHERE id = ?').run(actif, id);
  const row = db.prepare(`SELECT ${CHAMPS_PRODUIT} FROM produits WHERE id = ?`).get(id);
  res.json({ ok: true, produit: row });
}

// DELETE /api/admin/produits/:id — retrait définitif.
function supprimerProduit(req, res) {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT image FROM produits WHERE id = ?').get(id);
  if (!row) { const e = new Error('Produit introuvable.'); e.status = 404; e.expose = true; throw e; }
  db.prepare('DELETE FROM produits WHERE id = ?').run(id);
  if (row.image) uploads.supprimerParCheminPublic(row.image); // ménage best-effort
  res.json({ ok: true });
}

// POST /api/admin/produits/:id/image  { dataUrl } — téléversement d'une photo.
function televerserImage(req, res) {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT id, image FROM produits WHERE id = ?').get(id);
  if (!row) { const e = new Error('Produit introuvable.'); e.status = 404; e.expose = true; throw e; }
  const chemin = uploads.enregistrerDataUrl(req.body && req.body.dataUrl, `prod-${id}`);
  db.prepare('UPDATE produits SET image = ? WHERE id = ?').run(chemin, id);
  if (row.image) uploads.supprimerParCheminPublic(row.image); // remplace l'ancienne photo
  res.json({ ok: true, image: chemin });
}

// DELETE /api/admin/produits/:id/image — retire la photo (revient à l'emoji).
function retirerImage(req, res) {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT image FROM produits WHERE id = ?').get(id);
  if (!row) { const e = new Error('Produit introuvable.'); e.status = 404; e.expose = true; throw e; }
  db.prepare("UPDATE produits SET image = '' WHERE id = ?").run(id);
  if (row.image) uploads.supprimerParCheminPublic(row.image);
  res.json({ ok: true });
}

// ---- Commandes -------------------------------------------------------------

const LIBELLE_STATUT = {
  paye: 'Payé', a_livrer: 'À livrer', en_attente: 'En attente de paiement',
  a_confirmer: 'À confirmer (WhatsApp)', echoue: 'Échoué', livre: 'Livré',
};

// GET /api/admin/commandes?statut=... — liste (filtre facultatif) + compteurs.
function listeCommandes(req, res) {
  const filtre = String(req.query.statut || '').trim();
  const base = `SELECT id, reference, client_nom, client_tel, client_operateur, client_adresse,
                mode_paiement, montant, statut, cree_le, maj_le FROM commandes`;
  const rows = filtre
    ? db.prepare(`${base} WHERE statut = ? ORDER BY id DESC`).all(filtre)
    : db.prepare(`${base} ORDER BY id DESC`).all();

  // Compteurs par statut pour les onglets de filtre.
  const compteurs = { tous: 0 };
  for (const r of db.prepare('SELECT statut, COUNT(*) AS n FROM commandes GROUP BY statut').all()) {
    compteurs[r.statut] = r.n; compteurs.tous += r.n;
  }
  res.json({ commandes: rows.map((r) => ({ ...r, statut_libelle: LIBELLE_STATUT[r.statut] || r.statut })), compteurs });
}

// GET /api/admin/commandes/:reference — détail complet (avec lignes).
function detailCommande(req, res) {
  const cmd = db.prepare('SELECT * FROM commandes WHERE reference = ?').get(String(req.params.reference));
  if (!cmd) { const e = new Error('Commande introuvable.'); e.status = 404; e.expose = true; throw e; }
  let lignes = [];
  try { lignes = JSON.parse(cmd.items_json || '[]'); } catch { lignes = []; }
  res.json({
    commande: {
      reference: cmd.reference, client_nom: cmd.client_nom, client_tel: cmd.client_tel,
      client_operateur: cmd.client_operateur, client_adresse: cmd.client_adresse,
      mode_paiement: cmd.mode_paiement, montant: cmd.montant, statut: cmd.statut,
      statut_libelle: LIBELLE_STATUT[cmd.statut] || cmd.statut,
      cree_le: cmd.cree_le, maj_le: cmd.maj_le, lignes,
    },
  });
}

// PATCH /api/admin/commandes/:reference/livree — marque « livré ».
// Lecture seule sur les paiements PVit : on ne réencaisse rien, on note juste
// que la commande a été remise à la cliente.
function marquerLivree(req, res) {
  const cmd = db.prepare('SELECT id, statut FROM commandes WHERE reference = ?').get(String(req.params.reference));
  if (!cmd) { const e = new Error('Commande introuvable.'); e.status = 404; e.expose = true; throw e; }
  db.prepare("UPDATE commandes SET statut = 'livre', maj_le = datetime('now') WHERE id = ?").run(cmd.id);
  res.json({ ok: true, statut: 'livre' });
}

// DELETE /api/admin/commandes/:reference — retrait définitif d'une commande.
// Utile pour nettoyer les commandes de test avant la première vraie vente.
function supprimerCommande(req, res) {
  const info = db.prepare('DELETE FROM commandes WHERE reference = ?').run(String(req.params.reference));
  if (!info.changes) { const e = new Error('Commande introuvable.'); e.status = 404; e.expose = true; throw e; }
  res.json({ ok: true });
}

// ---- Réglages (bonus) ------------------------------------------------------

const CLES_REGLAGES = ['nom', 'slogan', 'whatsapp'];

// GET /api/admin/reglages — valeurs effectives (surcharge DB > environnement).
function lireReglages(req, res) {
  const stored = {};
  for (const r of db.prepare('SELECT cle, valeur FROM reglages').all()) stored[r.cle] = r.valeur;
  res.json({
    reglages: {
      nom: stored.nom ?? config.boutique.nom,
      slogan: stored.slogan ?? config.boutique.slogan,
      whatsapp: stored.whatsapp ?? config.boutique.whatsapp,
    },
  });
}

// PUT /api/admin/reglages — enregistre les surcharges éditables.
function ecrireReglages(req, res) {
  const body = req.body || {};
  const up = db.prepare('INSERT INTO reglages (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur');
  for (const cle of CLES_REGLAGES) {
    if (body[cle] === undefined) continue;
    let valeur = String(body[cle]).trim();
    if (cle === 'whatsapp') valeur = valeur.replace(/[^0-9]/g, ''); // format international sans +
    up.run(cle, valeur);
  }
  lireReglages(req, res);
}

module.exports = {
  login, session, changerMotDePasse, reinitialiser,
  listeProduits, creerProduit, modifierProduit, basculerActif, supprimerProduit,
  televerserImage, retirerImage,
  listeCommandes, detailCommande, marquerLivree, supprimerCommande,
  lireReglages, ecrireReglages,
};
