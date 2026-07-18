# Messagerie L'Hair Afro — mise en service

La messagerie du Dashboard (`lhairafro.com/admin` → onglet **Messagerie**) permet à
Ludmilla de **recevoir et envoyer** des e-mails depuis `contact@lhairafro.com`.

- **Envoi** : via l'API **Brevo** (offre gratuite 300 mails/jour).
- **Réception** : via un **Cloudflare Email Worker** qui parse l'e-mail entrant,
  le **renvoie** vers le Gmail de secours (⚠️ préserve l'OTP PVit) **et** le POSTe
  au webhook `/api/mail-inbound` de la boutique.

Le code de l'app est **déjà déployé** et se dégrade proprement : tant que les 4
étapes ci-dessous ne sont pas faites, l'onglet Messagerie affiche « en attente
d'activation » sans rien casser.

> ⚠️ **Ne changez PAS les enregistrements MX** de `lhairafro.com`. Ils servent
> à Cloudflare Email Routing (OTP PVit). Tout ce qui suit n'ajoute que des **TXT**
> (DKIM/SPF) et un Worker — les MX restent intacts.

---

## Étape 1 — Brevo (envoi)

1. Créer un compte sur **brevo.com** (gratuit).
2. **Senders, Domains & Dedicated IPs → Domains → Authenticate a domain** :
   saisir `lhairafro.com`.
3. Brevo affiche **2-3 enregistrements DKIM/SPF (type TXT)** à ajouter dans le DNS.
   Les créer sur **Cloudflare → lhairafro.com → DNS** (type **TXT**, tels quels).
   *(Uniquement des TXT — on ne touche pas aux MX.)*
4. Revenir sur Brevo → **Verify / Authenticate** jusqu'à ce que le domaine soit
   ✅ authentifié.
5. **SMTP & API → API Keys → Generate a new API key** → copier la clé
   (commence par `xkeysib-…`).

## Étape 2 — Variables sur Render (boutique)

Dashboard Render → service **lhairafro-boutique** → **Environment** :

| Variable            | Valeur                                             |
|---------------------|----------------------------------------------------|
| `BREVO_API_KEY`     | la clé `xkeysib-…` de l'étape 1                     |
| `MAIL_FROM_EMAIL`   | `contact@lhairafro.com` (déjà par défaut)          |
| `MAIL_INBOUND_TOKEN`| un jeton aléatoire, ex. `openssl rand -hex 24`     |

Enregistrer → Render redéploie. À ce stade, l'**envoi** fonctionne déjà
(la boîte affiche « ✅ Messagerie active »).

## Étape 3 — Déployer le Cloudflare Email Worker (réception)

Depuis ce dossier (`messagerie-cloudflare/`) :

```bash
npm install
npx wrangler login
npx wrangler deploy
# puis poser les 3 variables (secrets) :
npx wrangler secret put FORWARD_TO      # -> chrysoslandry@gmail.com
npx wrangler secret put INBOUND_URL     # -> https://lhairafro.com/api/mail-inbound
npx wrangler secret put INBOUND_TOKEN   # -> LA MÊME valeur que MAIL_INBOUND_TOKEN
```

*(Alternative sans terminal : créer le Worker dans le dashboard Cloudflare, coller
`src/email-worker.js`, ajouter la dépendance `postal-mime`, et poser les 3
variables dans Settings → Variables.)*

## Étape 4 — Brancher Email Routing sur le Worker

Cloudflare → `lhairafro.com` → **Email → Email Routing → Routing rules** :

- Régler l'adresse `contact@lhairafro.com` sur l'action **« Send to a Worker »**
  → choisir le worker **lhairafro-email**.

Comme le Worker renvoie lui-même vers Gmail (`FORWARD_TO`), l'OTP continue
d'arriver dans la boîte de Landry **et** les messages s'affichent dans le Dashboard.

---

## Vérifier

1. Envoyer un e-mail de test à `contact@lhairafro.com` → il doit apparaître dans
   **Dashboard → Messagerie → Reçus** (et toujours dans le Gmail de secours).
2. Depuis la messagerie, **répondre** → le client reçoit la réponse, expédiée
   depuis `contact@lhairafro.com`.

## À la remise à Ludmilla

- Rebasculer `FORWARD_TO` (variable du Worker) vers l'e-mail personnel de Ludmilla.
- Lui laisser le Dashboard : elle gère tout depuis l'onglet **Messagerie**.
