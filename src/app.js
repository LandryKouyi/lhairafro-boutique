'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const config = require('./config');

const boutique = require('./controllers/boutiqueController');
const commande = require('./controllers/commandeController');
const admin = require('./controllers/adminController');
const mail = require('./controllers/mailController');
const auth = require('./services/auth');

const app = express();

// Derrière le proxy HTTPS de Render : req.protocol = https, IP réelle, etc.
app.set('trust proxy', 1);

// Sécurité. CSP assouplie pour autoriser les polices Google et les images
// (photos produits hébergées ailleurs plus tard). Le beaute.jpg du hero est servi
// en local, mais on autorise data: et https: pour les futures photos de Ludmilla.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        // Autorise les gestionnaires d'événements inline (onclick=…) utilisés par
        // la boutique et l'admin. Sans ça, helmet impose script-src-attr 'none'
        // et TOUS les boutons inline (panier, etc.) deviennent inertes.
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

app.use(
  cors({
    origin(origin, cb) {
      if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
      cb(new Error('Origine non autorisée par CORS.'));
    },
    credentials: true,
  })
);

// Limite relevée à 8 Mo : l'admin peut envoyer une photo produit en Data URL
// (base64). Les images sont redimensionnées côté navigateur, donc en pratique
// bien en dessous, mais on garde de la marge.
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true }));
if (config.env !== 'test') app.use(morgan('dev'));

// --- Santé ------------------------------------------------------------------
app.get('/health', (req, res) => res.json({ status: 'ok', service: "lhairafro-boutique", heure: new Date().toISOString() }));

// --- Callbacks PVit (PUBLICS, serveur à serveur — aucune authentification) ---
// Déclarés en premier pour rester joignables tels quels.
app.post('/api/pvit-callback', commande.pvitCallback); // webhook (statut définitif)
app.post('/api/pvit-secret', commande.pvitSecretReception); // réception de la clé secrète
app.post('/api/mail-inbound', mail.inbound); // réception d'e-mails (Cloudflare Email Worker)

// --- API boutique -----------------------------------------------------------
app.get('/api/boutique', boutique.infosBoutique);
app.get('/api/produits', boutique.listeProduits);
app.post('/api/commandes', commande.creerCommande);
app.get('/api/commandes/:reference/statut', commande.statutCommande);

// --- API arrière-boutique (espace de gestion de Ludmilla) -------------------
// La connexion est publique ; tout le reste est protégé par auth.protege.
app.post('/api/admin/login', admin.login);
app.post('/api/admin/reinitialiser', admin.reinitialiser); // PUBLIC : reset par code de récupération
app.get('/api/admin/session', auth.protege, admin.session);
app.post('/api/admin/changer-motdepasse', auth.protege, admin.changerMotDePasse);

app.get('/api/admin/produits', auth.protege, admin.listeProduits);
app.post('/api/admin/produits', auth.protege, admin.creerProduit);
app.put('/api/admin/produits/:id', auth.protege, admin.modifierProduit);
app.patch('/api/admin/produits/:id/actif', auth.protege, admin.basculerActif);
app.delete('/api/admin/produits/:id', auth.protege, admin.supprimerProduit);
app.post('/api/admin/produits/:id/image', auth.protege, admin.televerserImage);
app.delete('/api/admin/produits/:id/image', auth.protege, admin.retirerImage);

app.get('/api/admin/commandes', auth.protege, admin.listeCommandes);
app.get('/api/admin/commandes/:reference', auth.protege, admin.detailCommande);
app.patch('/api/admin/commandes/:reference/livree', auth.protege, admin.marquerLivree);
app.delete('/api/admin/commandes/:reference', auth.protege, admin.supprimerCommande);

app.get('/api/admin/reglages', auth.protege, admin.lireReglages);
app.put('/api/admin/reglages', auth.protege, admin.ecrireReglages);

// --- Messagerie (boîte contact@lhairafro.com) -------------------------------
app.get('/api/admin/messagerie/etat', auth.protege, mail.etat);
app.get('/api/admin/messages', auth.protege, mail.liste);
app.post('/api/admin/messages/envoyer', auth.protege, mail.envoyer);
app.get('/api/admin/messages/:id', auth.protege, mail.detail);
app.patch('/api/admin/messages/:id/lu', auth.protege, mail.marquerLu);
app.delete('/api/admin/messages/:id', auth.protege, mail.supprimer);

// --- Photos produits téléversées (disque persistant en production) ----------
app.use('/uploads', express.static(config.uploadsDir, { maxAge: '7d', fallthrough: true }));

// --- Front statique ---------------------------------------------------------
app.use(express.static(path.join(config.root, 'public')));

// Raccourci : /admin -> page de l'arrière-boutique.
app.get('/admin', (req, res) => res.sendFile(path.join(config.root, 'public', 'admin.html')));

// 404 pour l'API ; sinon on renvoie l'accueil.
app.use('/api', (req, res) => res.status(404).json({ erreur: 'Route introuvable.' }));
app.get('*', (req, res) => res.sendFile(path.join(config.root, 'public', 'index.html')));

// Gestion d'erreurs centralisée.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  const message = err.expose ? err.message : 'Une erreur est survenue. Réessayez.';
  if (status >= 500) console.error('Erreur :', err);
  res.status(status).json({ erreur: message });
});

module.exports = app;
