# Idées & feuille de route — Livraison / Cartographie (Daitec)

Le socle livré (positions clients/magasins, livreurs suivis en direct, COD
intégré aux paiements) ouvre naturellement sur :

## Court terme (fort impact, effort modéré)
1. **Zones & frais de livraison** — tarifs par wilaya/commune (ou par rayon km
   autour du magasin), appliqués automatiquement comme `shipping` sur la vente.
2. **Preuve de livraison** — photo du colis + signature du client sur l'écran
   du livreur, archivées sur la livraison (litiges, confiance).
3. **Réconciliation caisse livreur** — clôture de tournée : COD attendu vs
   remis, écart tracé (même logique que la clôture de caisse POS).
4. **Lien de suivi client** — SMS/WhatsApp avec un lien public « votre commande
   est en route » montrant la position du livreur (jeton temporaire).
5. **Étiquettes colis** — impression thermique d'une étiquette (n° LIV,
   client, téléphone, COD, code-barres) depuis la livraison.

## Moyen terme
6. **Optimisation de tournée** — ordonnancement multi-arrêts (heuristique du
   plus proche voisin d'abord, OSRM/openrouteservice ensuite) + itinéraire
   tracé sur la carte du livreur.
7. **Géofencing** — passage automatique « En route → Livrée ? » quand le
   livreur reste > 2 min à moins de 100 m de la destination (confirmation à
   un geste).
8. **Heatmap des ventes** — carte de chaleur du CA par quartier pour choisir
   l'emplacement d'un nouveau magasin ou cibler la prospection.
9. **Affectation intelligente** — suggérer le livreur le plus proche / le
   moins chargé à la création de la livraison.
10. **Intégrations transporteurs DZ** — Yalidine, ZR Express, Maystro… :
    pousser la livraison chez le transporteur et suivre son statut via API.

## Long terme
11. **E-commerce → livraison** — les commandes du site (Phase 3) créent
    automatiquement vente + livraison + affectation.
12. **Application livreur native** (Flutter) — suivi GPS en arrière-plan,
    mode hors-ligne, notifications push.
13. **SLA & analytics livraison** — délai moyen par zone/livreur, taux
    d'échec par motif, COD moyen, ponctualité.
