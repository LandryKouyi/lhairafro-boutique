'use strict';

const db = require('../db');
const config = require('../config');
const pvit = require('../services/pvit');
const pvitSecret = require('../services/pvitSecret');

// Génère une référence de commande interne courte et lisible (ex. LHA-1KZ4Q8).
function nouvelleReference() {
  const suffixe = Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 46656).toString(36).toUpperCase().padStart(3, '0');
  return `LHA-${suffixe}`;
}

// Recalcule le montant côté serveur à partir du catalogue (jamais depuis le
// client) et construit le snapshot des lignes de commande.
function construirePanier(items) {
  if (!Array.isArray(items) || items.length === 0) {
    const e = new Error('Votre panier est vide.'); e.status = 400; e.expose = true; throw e;
  }
  let montant = 0;
  const lignes = [];
  for (const it of items) {
    const id = parseInt(it.id, 10);
    const qte = Math.max(1, Math.min(99, parseInt(it.qte ?? it.qty ?? 1, 10) || 1));
    const p = db.prepare('SELECT id, nom, prix FROM produits WHERE id = ? AND actif = 1').get(id);
    if (!p) { const e = new Error(`Produit introuvable (id ${it.id}).`); e.status = 400; e.expose = true; throw e; }
    montant += p.prix * qte;
    lignes.push({ id: p.id, nom: p.nom, prix: p.prix, qte, sous_total: p.prix * qte });
  }
  return { montant, lignes };
}

// POST /api/commandes — crée une commande.
// Corps : { client:{nom, telephone, adresse, operateur?}, mode:'mobile_money'|'livraison', items:[{id, qte}] }
async function creerCommande(req, res, next) {
  try {
    const body = req.body || {};
    const client = body.client || {};
    const nom = String(client.nom || '').trim();
    const tel = String(client.telephone || client.tel || '').trim();
    const adresse = String(client.adresse || client.adr || '').trim();
    const operateur = String(client.operateur || '').trim();
    const mode = String(body.mode || '').trim().toLowerCase();

    if (!nom || !tel) {
      const e = new Error('Merci d\'indiquer votre nom et votre téléphone.'); e.status = 400; e.expose = true; throw e;
    }
    if (mode !== 'mobile_money' && mode !== 'livraison') {
      const e = new Error('Mode de paiement invalide.'); e.status = 400; e.expose = true; throw e;
    }

    const { montant, lignes } = construirePanier(body.items);
    const reference = nouvelleReference();
    const refAlnum = reference.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);

    // --- Mode « paiement à la livraison » : rien à encaisser en ligne. --------
    if (mode === 'livraison') {
      db.prepare(`INSERT INTO commandes
        (reference, pvit_ref_alnum, client_nom, client_tel, client_operateur, client_adresse, mode_paiement, montant, items_json, statut)
        VALUES (?, ?, ?, ?, ?, ?, 'livraison', ?, ?, 'a_livrer')`)
        .run(reference, refAlnum, nom, tel, operateur || null, adresse, montant, JSON.stringify(lignes));
      return res.status(201).json({
        ok: true, reference, statut: 'a_livrer', montant,
        message: 'Commande enregistrée. Vous réglez à la livraison.',
      });
    }

    // --- Mode « Mobile Money » (Airtel / Moov via PVit) -----------------------
    // Si le rail PVit n'est pas encore configuré (mot de passe API / URLs non
    // posés, ou pas encore en prod), on n'échoue pas : on enregistre la commande
    // en 'a_confirmer' et le front bascule sur la confirmation WhatsApp.
    if (!pvit.estConfigure()) {
      db.prepare(`INSERT INTO commandes
        (reference, pvit_ref_alnum, client_nom, client_tel, client_operateur, client_adresse, mode_paiement, montant, items_json, statut)
        VALUES (?, ?, ?, ?, ?, ?, 'mobile_money', ?, ?, 'a_confirmer')`)
        .run(reference, refAlnum, nom, tel, operateur || null, adresse, montant, JSON.stringify(lignes));
      return res.status(201).json({
        ok: true, reference, statut: 'a_confirmer', montant, mobileMoneyActif: false,
        message: 'Paiement Mobile Money bientôt disponible. Confirmez votre commande sur WhatsApp.',
      });
    }

    // Rail actif : on initie le paiement PVit (push USSD vers le téléphone).
    const init = await pvit.initierPaiement({
      transactionId: refAlnum,
      montant,
      description: `Commande ${reference} — ${config.boutique.nom}`,
      client: { telephone: tel, operateur },
    });

    db.prepare(`INSERT INTO commandes
      (reference, pvit_ref_alnum, client_nom, client_tel, client_operateur, client_adresse, mode_paiement, montant, items_json, statut, pvit_reference_id, pvit_merchant_ref)
      VALUES (?, ?, ?, ?, ?, ?, 'mobile_money', ?, ?, 'en_attente', ?, ?)`)
      .run(reference, refAlnum, nom, tel, init.operateur || operateur || null, adresse, montant, JSON.stringify(lignes),
        init.pvit_reference_id, init.pvit_merchant_ref || null);

    return res.status(201).json({
      ok: true, reference, statut: 'en_attente', montant, mobileMoneyActif: true,
      operateur: init.operateur,
      message: 'Demande de paiement envoyée sur votre téléphone. Validez-la avec votre code Mobile Money.',
    });
  } catch (e) {
    next(e);
  }
}

// GET /api/commandes/:reference/statut — état d'une commande (rafraîchit depuis
// PVit via CHECK STATUS si un rail est actif et une référence PVit connue).
async function statutCommande(req, res, next) {
  try {
    const cmd = db.prepare('SELECT * FROM commandes WHERE reference = ?').get(String(req.params.reference));
    if (!cmd) { const e = new Error('Commande introuvable.'); e.status = 404; e.expose = true; throw e; }

    if (cmd.mode_paiement === 'mobile_money' && cmd.statut === 'en_attente' && cmd.pvit_reference_id && pvit.estConfigure()) {
      try {
        const etat = await pvit.verifierPaiement(cmd.pvit_reference_id);
        if (etat.accepte) marquerPayee(cmd, etat.montant || cmd.montant, etat.operateur);
        else if (!etat.enAttente && etat.statut !== 'STATUS_URL_ABSENTE' && etat.statut !== 'INCONNU') {
          db.prepare("UPDATE commandes SET statut = 'echoue', maj_le = datetime('now') WHERE id = ?").run(cmd.id);
          cmd.statut = 'echoue';
        }
      } catch { /* on renvoie le statut connu ; la réconciliation/webhook rattrapera */ }
    }

    const frais = db.prepare('SELECT statut FROM commandes WHERE id = ?').get(cmd.id);
    res.json({ reference: cmd.reference, statut: frais.statut, montant: cmd.montant, mode: cmd.mode_paiement });
  } catch (e) {
    next(e);
  }
}

// Marque une commande comme payée (idempotent).
function marquerPayee(cmd, montant, operateur) {
  const row = typeof cmd === 'object' ? cmd : db.prepare('SELECT * FROM commandes WHERE reference = ?').get(String(cmd));
  if (!row || row.statut === 'paye') return;
  db.prepare("UPDATE commandes SET statut = 'paye', client_operateur = COALESCE(?, client_operateur), maj_le = datetime('now') WHERE id = ?")
    .run(operateur || null, row.id);
}

// POST /api/pvit-callback (PUBLIC — webhook PVit, serveur à serveur).
// PVit impose une réponse JSON { transactionId, responseCode } reprenant les
// valeurs reçues. On confirme d'abord par interrogation active (source de
// vérité) ; en repli, si le webhook annonce un succès, on valide dessus.
async function pvitCallback(req, res) {
  const body = req.body || {};
  const { transactionId, merchantReferenceId, code } = pvit.refDepuisWebhook(body);
  try {
    let cmd = null;
    if (transactionId) cmd = db.prepare('SELECT * FROM commandes WHERE pvit_reference_id = ?').get(transactionId);
    if (!cmd && merchantReferenceId) {
      cmd = db.prepare('SELECT * FROM commandes WHERE pvit_merchant_ref = ? OR pvit_ref_alnum = ?')
        .get(merchantReferenceId, merchantReferenceId);
    }
    if (cmd) {
      let confirme = false;
      if (cmd.pvit_reference_id && pvit.estConfigure() && config.pvit.urlStatus) {
        const etat = await pvit.verifierPaiement(cmd.pvit_reference_id).catch(() => null);
        if (etat && etat.accepte) { marquerPayee(cmd, etat.montant || cmd.montant, etat.operateur); confirme = true; }
      }
      if (!confirme) {
        const etat = pvit.interpreterStatut(body.status, body);
        if (etat.accepte) marquerPayee(cmd, etat.montant || cmd.montant, etat.operateur);
      }
    }
  } catch { /* la réconciliation / le statut actif rattraperont */ }
  // Accusé de réception au format imposé par PVit (valeurs reprises telles quelles).
  res.status(200).json({ transactionId, responseCode: code });
}

// POST /api/pvit-secret (PUBLIC — réception de clé secrète PVit).
// PVit POSTe ici la clé générée par renew-secret ; on l'enregistre en mémoire
// pour signer les appels API. On accuse réception en 200.
function pvitSecretReception(req, res) {
  const body = req.body || {};
  const secret = body.secret || body.secretKey || body.secret_key || body.key || '';
  const account = body.operationAccountCode || body.operation_account_code
    || body.accountOperationCode || config.pvit.operationAccount;
  const ttl = body.expires_in || body.expiresIn || 3600;
  if (secret) pvitSecret.enregistrer(account, secret, ttl);
  res.status(200).json({ status_code: '200', message: secret ? 'Secret received' : 'No secret in payload' });
}

module.exports = { creerCommande, statutCommande, pvitCallback, pvitSecretReception };
