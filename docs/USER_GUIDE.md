# Guide utilisateur — Daitec

## Démarrer

1. **Créer un compte** (`/signup`), puis suivre l'assistant : nom commercial,
   activité, wilaya, taux de TVA, identifiants fiscaux (NIF/NIS/RC/AI, optionnels).
   Daitec crée automatiquement : magasin principal, dépôt principal, modes de
   paiement algériens (Espèces, CIB, Edahabia, virement, chèque, crédit),
   catégories de dépenses et numérotation des documents.
2. **Langue** : sélecteur en haut à droite — Français, العربية (interface
   entièrement RTL), English.

## Au quotidien

### Caisse (POS)
1. **Ouvrir la caisse** en saisissant le fonds de caisse.
2. **Scanner** un code-barres (douchette USB : scan + Entrée) ou taper le nom
   du produit ; cliquer une carte produit pour l'ajouter au panier.
3. Ajuster quantités et remises ligne par ligne ; associer un **client**
   (obligatoire pour la vente à crédit).
4. **Encaisser** : choisir le mode, saisir les espèces reçues — la monnaie à
   rendre s'affiche. Paiement partiel = le reste passe en créance client.
5. **Mettre en attente / reprendre** des ventes ; **clôturer la caisse** en fin
   de journée : Daitec calcule les espèces attendues et l'écart.

**Mode hors ligne** : si Internet coupe, la caisse continue — recherche et
scan fonctionnent sur le catalogue local, les ventes s'enregistrent en tickets
locaux (« HL-001 ») et se synchronisent **automatiquement** au retour de la
connexion (badge « à synchroniser » dans l'en-tête). Aucune vente n'est perdue
ni comptée deux fois ; une vente refusée à la synchronisation (stock devenu
insuffisant) apparaît dans « Ventes en conflit » pour vérification.

### Ventes & documents
- **Ventes → Nouvelle vente** : facture ou proforma, remise globale, échéance,
  acompte. Impression **A4** via le bouton Imprimer (PDF via la boîte de dialogue).
- **Devis** : création puis **conversion en facture** en un clic.
- **Retour / avoir** : depuis la fiche d'une vente — quantités contrôlées,
  remboursement espèces optionnel, stock réintégré automatiquement.

### Achats & stock
- **Achats → Nouvelle commande** fournisseur, puis **Réceptionner**
  (réception partielle supportée). La réception met à jour le stock, le coût
  moyen pondéré et crée la facture fournisseur (dette).
- **Stock** : soldes par dépôt, valeur du stock, ajustements (entrée, sortie,
  casse, perte, inventaire), **transferts** entre dépôts (expédier → réceptionner).
- Chaque mouvement est tracé dans un journal infalsifiable.

### Clients & fournisseurs
Fiches avec identifiants fiscaux, plafond de crédit, solde, historique,
meilleurs produits. **Encaisser un règlement** depuis la fiche client
(affectation à une facture précise) ; idem pour régler un fournisseur.
Le système refuse tout paiement supérieur au restant dû.

### Dépenses, rapports, alertes
- **Dépenses** par catégorie (loyer, salaires, électricité…).
- **Rapports** : ventes (par jour/mois/produit/catégorie/employé/mode de
  paiement, export CSV), stock (valorisation, stock bas, ruptures, stock
  dormant), créances/dettes, résultat estimé (CA − coût des ventes − dépenses).
- Le **tableau de bord** affiche CA, bénéfice, créances, dettes, valeur du
  stock et alertes en temps réel.

### Notifications
La cloche 🔔 en haut de l'écran regroupe les alertes générées automatiquement :
**stock bas / rupture**, **factures clients en retard**, **factures fournisseurs
à payer sous 7 jours** et **échecs de livraison**. Cliquez une notification
pour ouvrir l'élément concerné ; « Tout marquer comme lu » vide le compteur.
Tant qu'une condition persiste, elle se re-signale après lecture.

### Ticket de caisse thermique
**Paramètres → Ticket de caisse** : largeur du papier (58 mm ou 80 mm), texte
d'en-tête et de pied personnalisés, affichage NIF/TVA/caissier/client, et
**impression automatique** après chaque vente. Après un encaissement, le ticket
s'ouvre dans une fenêtre d'impression (le bouton 🖨 dans l'en-tête du POS
réimprime le dernier ticket en DUPLICATA). Fonctionne avec toute imprimante
thermique installée comme imprimante système (Epson, Xprinter, etc.).

### Livraisons & carte
- **Position des clients** : fiche client → « Position » — recherchez une adresse
  ou cliquez sur la carte pour poser l'épingle.
- **Créer une livraison** depuis une facture (le COD = reste à payer, ajustable)
  ou depuis **Livraisons → Nouvelle livraison** ; affectez un **livreur**.
- **Ajouter un livreur en 10 secondes** : **Livraisons → Livreurs → Ajouter un
  livreur** — tapez juste son nom, l'e-mail et le mot de passe sont générés
  automatiquement, et Daitec vous affiche une **fiche d'identifiants** à copier
  ou imprimer et remettre au livreur. Il apparaît immédiatement dans les listes
  d'affectation.
- **Espace livreur** (sur téléphone) : liste de ses livraisons, boutons
  Appeler / Itinéraire, statuts en un geste (Récupéré → En route → Livrée),
  et bouton **En service** qui active le suivi GPS. À la livraison, le COD est
  encaissé automatiquement (espèces) et la facture passe en « payée ».
- **Code QR client** : chaque client possède un code QR (fiche client →
  « Code QR client » → imprimer la carte). À la livraison, le livreur
  **scanne le QR du client** avec la caméra de son téléphone — Daitec vérifie
  qu'il correspond bien au client de cette livraison (« Client vérifié ✓ »)
  et le tamponne sur la livraison (badge « QR vérifié » côté gestionnaire).
- **Preuve de livraison** : au moment de « Livrée », le livreur prend une
  **photo du colis** et fait **signer le client** sur l'écran (pad tactile).
  Photo et signature sont archivées de façon infalsifiable sur la livraison —
  l'icône 📷 dans la liste des livraisons les affiche (qui, quand).
- **Carte** : magasins, dépôts, clients (orange = avec créance), livraisons en
  cours par couleur de statut, et position des livreurs actualisée toutes les
  10 secondes.
- **Carte de chaleur du chiffre d'affaires** : cochez « Carte de chaleur (CA) »
  pour voir d'où vient votre chiffre d'affaires — les zones passent du bleu
  (faible) au rouge (élevé) selon le CA cumulé par client géolocalisé. Choisissez
  la période (30 jours à 12 mois). Idéal pour repérer vos secteurs les plus
  rentables et cibler tournées et prospection. (Les ventes de comptoir sans
  client identifié n'ont pas de position et ne sont pas comptées ici.)

## Administration

- **Paramètres → Utilisateurs & rôles** : créer des comptes employés avec un
  rôle (Administrateur, Manager, Vendeur, Caissier, Magasinier, Comptable) —
  chaque rôle limite ce que l'employé voit (un caissier ne voit ni les coûts
  ni les bénéfices).
- **Journal d'audit** : qui a fait quoi, quand — modifications de prix,
  suppressions, remboursements, ouvertures de caisse… non modifiable.
- **Raccourcis** : `Ctrl+K` ouvre la recherche globale et les actions rapides
  (nouvelle vente, nouveau produit, ouvrir la caisse…).

## Compte de démonstration

`demo@sahla.dz / demo12345` — société fictive « Daitec Demo Store » (livreur : `livreur@sahla.dz / livreur123`) avec
catalogue, ventes et achats réalistes, totalement isolée de vos données.
