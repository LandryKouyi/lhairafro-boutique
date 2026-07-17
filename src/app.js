'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const config = require('./config');

const boutique = require('./controllers/boutiqueController');
const commande = require('./controllers/commandeController');

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

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
if (config.env !== 'test') app.use(morgan('dev'));

// --- Santé ------------------------------------------------------------------
app.get('/health', (req, res) => res.json({ status: 'ok', service: "lhairafro-boutique", heure: new Date().toISOString() }));

// --- Callbacks PVit (PUBLICS, serveur à serveur — aucune authentification) ---
// Déclarés en premier pour rester joignables tels quels.
app.post('/api/pvit-callback', commande.pvitCallback); // webhook (statut définitif)
app.post('/api/pvit-secret', commande.pvitSecretReception); // réception de la clé secrète

// --- API boutique -----------------------------------------------------------
app.get('/api/boutique', boutique.infosBoutique);
app.get('/api/produits', boutique.listeProduits);
app.post('/api/commandes', commande.creerCommande);
app.get('/api/commandes/:reference/statut', commande.statutCommande);

// --- Front statique ---------------------------------------------------------
app.use(express.static(path.join(config.root, 'public')));

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
