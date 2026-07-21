# Messagerie L'Hair Afro — mise en service

La messagerie du Dashboard (`lhairafro.com/admin` → onglet **Messagerie**) permet à
Ludmilla de **recevoir et envoyer** des e-mails depuis `contact@lhairafro.com`.

- **Envoi** : via **SMTP Gmail** — un compte Gmail relais dédié à la boutique
  (gratuit, ~500 destinataires/jour, aucun réglage DNS).
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

## Étape 1 — Compte Gmail relais (envoi)

1. Créer un **compte Gmail dédié** à la boutique, ex. `contact.lhairafro@gmail.com`
   (nécessite un numéro de téléphone pour la vérification SMS — étape humaine).
2. Dans ce compte : **Compte Google → Sécurité → Validation en 2 étapes** →
   l'activer.
3. Toujours dans **Sécurité → Mots de passe des applications** → en générer un
   (nom : « L'Hair Afro ») → copier les **16 caractères**.
4. Gmail → ⚙️ **Paramètres → Comptes et importation → Envoyer des e-mails en
   tant que → Ajouter une autre adresse** → saisir `contact@lhairafro.com`.
   Gmail envoie un code de confirmation à cette adresse ; grâce au renvoi
   Cloudflare (étapes 3-4), le code **arrive dans cette même boîte** → le coller.
   *(Aucun réglage DNS : ni DKIM, ni SPF, ni MX touchés.)*

## Étape 2 — Variables sur Render (boutique)

Dashboard Render → service **lhairafro-boutique** → **Environment** :

| Variable             | Valeur                                             |
|----------------------|----------------------------------------------------|
| `GMAIL_USER`         | le compte Gmail relais, ex. `contact.lhairafro@gmail.com` |
| `GMAIL_APP_PASSWORD` | les 16 caractères de l'étape 1 (les espaces sont ignorés) |
| `MAIL_FROM_EMAIL`    | `contact@lhairafro.com` (déjà par défaut)          |
| `MAIL_INBOUND_TOKEN` | un jeton aléatoire, ex. `openssl rand -hex 24`     |

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
