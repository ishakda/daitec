# Comment lancer Daitec

Daitec est un système **client–serveur** : un serveur (base de données + application)
et des postes qui s'y connectent (navigateur, application de bureau .exe, téléphone
du livreur). Trois façons de le faire tourner :

## 1. Cloud (recommandé — accessible de partout)
Serveur hébergé sur **Supabase + Vercel** :
1. Suivez `docs/DEPLOYMENT.md` (script `scripts/deploy_supabase.sh` + import Vercel).
2. Vous obtenez une adresse du type `https://daitec.vercel.app`.
3. Tout le monde s'y connecte : navigateur, .exe de bureau, téléphone du livreur.

## 2. Serveur local / LAN (magasin sans dépendance internet)
Sur un PC du magasin (Windows avec WSL, ou Linux) :
```bash
# prérequis : Node 20+, PostgreSQL 16 (+contrib)
createdb daitec
psql -d daitec -f scripts/local_bootstrap.sql
DATABASE_URL=postgresql://postgres@localhost/daitec ./scripts/migrate.sh
cd web && cp .env.example .env.local   # éditer les URLs + AUTH_SECRET
npm ci && npm run build && npm start   # serveur sur http://<IP-du-PC>:3000
```
Les autres postes du magasin se connectent à `http://192.168.x.x:3000`.

## 3. L'application de bureau (.exe Windows)
`Daitec-1.0.0-portable.exe` — **aucune installation requise** :
1. Double-cliquez le fichier.
2. Au premier lancement, entrez l'adresse de votre serveur
   (ex. `https://daitec.vercel.app` ou `http://192.168.1.10:3000`).
3. C'est tout — l'application s'ouvre en plein écran, imprime les tickets,
   accède à la caméra (scan QR) et au GPS (livreur). `Ctrl+Shift+S` pour
   changer de serveur.

### Mode kiosque (poste caissier) 🔒
Dans l'écran de configuration du .exe, cochez **« Mode kiosque (poste caissier) »**
et définissez un **PIN (4 à 8 chiffres)** :
- l'application démarre en **plein écran verrouillé** directement sur la **Caisse (POS)** ;
- impossible de fermer, réduire ou quitter sans le PIN ;
- **Ctrl+Alt+Q** (ou Ctrl+Shift+S) affiche l'écran de déverrouillage — PIN requis ;
- le caissier se connecte avec son compte « Caissier », qui ne voit de toute façon
  ni les coûts ni les autres modules (RBAC côté serveur).

> Le .exe est une coquille de bureau : les données restent sur votre serveur.
> Pour générer l'installateur signé (Setup.exe), poussez un tag `v*` sur GitHub —
> le workflow `.github/workflows/desktop.yml` le construit automatiquement
> (Actions → artifacts / Release).

## Comptes de démonstration (serveur local seedé)
- Propriétaire : `demo@sahla.dz / demo12345`
- Livreur : `livreur@sahla.dz / livreur123`
