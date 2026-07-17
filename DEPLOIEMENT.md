# Déploiement L'Hair Afro — checklist pas-à-pas (pour Landry)

Cette coquille tourne et est prête. Il reste les **gestes irréversibles / facturables /
avec OTP** que seul Landry peut faire. Ordre recommandé ci-dessous.

> Rappel machine : commandes `curl` HTTPS -> ajouter `--ssl-no-revoke` ; `npm install`
> -> préfixer `NODE_OPTIONS=--use-system-ca`.

---

## Étape 0 — Dépôt Git distant (non fait par l'assistant)

Le projet est déjà en dépôt Git local avec un premier commit. À faire :

```bash
# créer le repo GitHub (ex. LandryKouyi/lhairafro-boutique) puis :
git remote add origin https://github.com/LandryKouyi/lhairafro-boutique.git
git push -u origin main
```

---

## Étape 1 — Service Render (plan PAYANT)

1. Render → **New → Blueprint** (il lit `render.yaml`) **ou** New → Web Service depuis le repo.
2. Vérifier : runtime Node, région **Frankfurt**, plan **Starter** (payant : pas de mise
   en veille + disque persistant `/var/data` pour la base SQLite).
3. `buildCommand = npm install`, `startCommand = npm run start:prod`, health check `/health`.
4. Laisser le premier déploiement se faire. Noter l'URL Render (`https://lhairafro-boutique.onrender.com`).
5. Tester : `curl --ssl-no-revoke https://lhairafro-boutique.onrender.com/health`.

À ce stade la boutique est en ligne, **mode livraison + repli WhatsApp** (Mobile Money
encore inactif tant que les variables PVit ne sont pas complètes).

---

## Étape 2 — Domaine `lhairafro.com` (Cloudflare ↔ Render)

1. Render → service → **Settings → Custom Domains** → ajouter `lhairafro.com`
   (et `www.lhairafro.com`). Render fournit une cible CNAME.
2. Cloudflare (compte `chrysoslandry@gmail.com`, zone `lhairafro.com`) → **DNS** :
   - `www` → CNAME vers la cible Render.
   - apex `lhairafro.com` → CNAME (flatten) vers la cible Render, **proxy activé**.
   - ⚠️ Ne PAS toucher aux enregistrements **MX / TXT** de Cloudflare Email Routing
     (`contact@lhairafro.com` doit rester actif : c'est la boîte qui reçoit les OTP PVit).
3. Attendre la validation SSL Render (le domaine passe « Verified / Certificate issued »).
4. Tester : `curl --ssl-no-revoke https://lhairafro.com/health`.

---

## Étape 3 — Les 2 URLs PVit (dashboard MyPVit → Paramétrages → Urls)

✅ **FAIT (mode TEST)** — les deux URLs ont été créées dans le dashboard L'Hair Afro,
pointant vers le domaine en ligne, et leurs codes sont déjà reportés dans le projet
(`.env.example` + `src/config.js`) :

| Type | URL saisie | Code généré | Variable |
|---|---|---|---|
| **CALLBACK** | `https://lhairafro.com/api/pvit-callback` | **MKTAO** | `PVIT_CALLBACK_URL_CODE` |
| **Réception de clé secrète** | `https://lhairafro.com/api/pvit-secret` | **7UMSP** | `PVIT_RECEPTION_URL_CODE` (= `receptionUrlCode`) |

> En **production**, si PVit fournit un nouveau contexte (nouveau slug / compte
> d'opération PROD), recréer ces 2 URLs et remplacer les codes ci-dessus par les
> nouveaux dans les variables Render.

Relever aussi, page **Paramétrages → APIs**, le code de l'endpoint **CHECK STATUS**
(non encore noté) → `PVIT_URL_STATUS` (ex. `/XXXXXXXX/status`).

---

## Étape 4 — Mot de passe API PVit (OTP email — Landry uniquement)

Page **Paramétrages → APIs** → **RENEW SECRET KEY** → définir le **mot de passe API**
(OTP reçu par email sur `contact@lhairafro.com`, qui arrive dans le Gmail de Landry).
Ce mot de passe = `PVIT_API_PASSWORD`. **Ne jamais l'écrire dans le repo.**

---

## Étape 5 — Poser les variables sur Render (dashboard → Environment)

Renseigner (les non-secrètes sont déjà dans `render.yaml`) :

```
PVIT_API_PASSWORD       = (le mot de passe API défini à l'étape 4)   ← SECRET
PVIT_CALLBACK_URL_CODE  = MKTAO   (URL callback, créée à l'étape 3)
PVIT_RECEPTION_URL_CODE = 7UMSP   (URL réception de clé, créée à l'étape 3)
PVIT_URL_STATUS         = (code endpoint CHECK STATUS, à relever page APIs)
```

> Les codes `MKTAO` / `7UMSP` sont déjà les défauts du code (`src/config.js`) : en
> mode TEST sur le même domaine, seul `PVIT_API_PASSWORD` (et éventuellement
> `PVIT_URL_STATUS`) reste indispensable à poser. Les remettre explicitement sur
> Render reste recommandé pour la lisibilité.

(déjà posées via le blueprint : `PVIT_SLUG`, `PVIT_OPERATION_ACCOUNT`, `PVIT_URL_RENEW`,
`PVIT_URL_REST`, `BOUTIQUE_WHATSAPP`, `DATABASE_PATH`, `NODE_ENV`.)

Sauvegarder → Render redéploie. Au redémarrage, le log doit indiquer
**« Paiement Mobile Money (PVit) : ACTIF »**. Vérifier aussi
`curl --ssl-no-revoke https://lhairafro.com/api/boutique` → `"mobileMoneyActif":true`.

---

## Étape 6 — Les 4 transactions test PVit (débloque la PROD)

Règle sandbox PVit : **montant < 1000 XAF = succès**, **> 1000 = échec** (min 150 FCFA).
Le compte d'opération **TEST** est `ACC_6A5A03E304ADF`.

Depuis la vraie boutique en ligne (`https://lhairafro.com/boutique.html`), passer des
commandes **Mobile Money** avec le numéro de test, en jouant sur le total du panier :

- **2 succès** : paniers dont le total est **< 1000 FCFA** (ex. ajuster un produit test à
  petit prix, ou créer temporairement un produit à 200 FCFA le temps des tests).
- **2 échecs** : paniers dont le total est **> 1000 FCFA**.

Vérifier côté boutique que le statut passe (bouton « J'ai payé — vérifier ») et côté
dashboard PVit que les 2 succès + 2 échecs sont enregistrés → la condition technique
de passage en production est remplie.

> Astuce : les prix placeholder actuels (3 500–15 000) dépassent 1000. Pour obtenir des
> **succès** en sandbox, créer 1–2 produits temporaires à bas prix (< 1000) et les
> retirer ensuite, ou tester avant de saisir les prix définitifs de Ludmilla.

---

## Étape 7 — Demander le passage en PRODUCTION

1. Dashboard PVit : le bandeau « effectuer ≥ 2 succès + 2 échecs » doit avoir disparu
   (profil déjà « en attente de validation » côté KYC).
2. **Demander le passage en production** ; l'équipe PVit valide.
3. Une fois en prod : créer les **comptes d'opération de PROD** au n° **Airtel `074598750`**
   (rapatriement des fonds vers Ludmilla).
4. Récupérer les **identifiants de PROD** (nouveau slug éventuel, nouveaux codes
   d'endpoint, nouveau compte d'opération) et **mettre à jour les variables Render**
   (`PVIT_SLUG`, `PVIT_OPERATION_ACCOUNT`, `PVIT_URL_*`). Recréer si besoin les 2 URLs
   (callback + réception de clé) en contexte prod.
5. Faire **un vrai paiement Airtel/Moov** de test (petit montant réel) depuis la boutique.

---

## Étape 8 — Remise à la cliente

- Basculer `BOUTIQUE_WHATSAPP` sur le **numéro définitif de Ludmilla** (si différent).
- Rebasculer la destination Cloudflare Email Routing `contact@lhairafro.com` vers l'email
  de Ludmilla, et lui faire **changer** le mot de passe de la boîte ET le mot de passe PVit.
- Remplacer les **produits placeholder** par les vrais (noms, prix, photos, catégories).
- ⚠️ Garder le **domaine + hébergement mail EN VIE** tant que le compte PVit existe
  (sinon les OTP de récupération sont perdus).

---

## Ce qui reste bloqué sur un input externe

| Bloquant | Qui / quoi | Impact |
|---|---|---|
| Contenu produits (noms, prix, photos, logo) | **Ludmilla** | Placeholders en attendant |
| Plan Render payant | **Landry** (facturation) | Nécessaire au HTTPS public |
| Mot de passe API PVit + OTP email | **Landry** (OTP) | Active le Mobile Money |
| Codes des 2 URLs + CHECK STATUS | **PVit** (générés après création) | Renseignés à l'étape 3/5 |
| Comptes d'opération PROD | **Validation PVit** | Après les 4 transactions test |
