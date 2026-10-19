# Plan de création

Choix validé : Rust + Tauri 2, interface TypeScript. Cible initiale : Windows x64.
Le nom du dépôt public est `spotisloth`. Pas de nouvelles fonctionnalités produit.

Avant chaque commit de jalon, présenter à l'utilisateur 4–5 lignes : résultat,
vérifications effectuées, limites et prochaine étape. Un commit par étape validée ;
les sous-étapes peuvent avoir leurs propres commits sans déclarer le jalon terminé.

| Étape           | Livraison                                                               | Critère de validation                                                                            | État                                                                                                                                   |
| --------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Étude        | Requêtes Spotify observées, mesures initiales, inventaire des fonctions | Séparer observations, hypothèses et inconnues                                                    | Premier relevé terminé                                                                                                                 |
| 2. Faisabilité  | Connexion, bibliothèque, lecture d'un morceau                           | Tester une session réelle et le renouvellement ; aucune simulation présentée comme fonctionnelle | Connexion OAuth, lecture et reconnexion validées ; expiration à éprouver                                                               |
| 3. Fondations   | Dépôt public, projet Tauri, commandes de vérification, CI Windows       | TypeScript compilé et exécutable Windows compilé                                                 | Validé : CI Windows et exécutable lancé localement                                                                                     |
| 4. Interface    | Accueil, recherche, bibliothèque, albums, playlists, lecteur            | Navigation et affichage vérifiés visuellement                                                    | Partiel : accueil, recherche, bibliothèque, albums, playlists et lecteur vérifiés                                                      |
| 5. Fonctions    | Données réelles et commandes du lecteur                                 | Vérifier les parcours avec un compte autorisé                                                    | Partiel : lecteur, favoris, édition de playlists et Spotify Connect vérifiés sous Windows ; autres parcours à compléter                |
| 6. Optimisation | Mesures comparables et corrections                                      | Comparer des versions release sur les mêmes parcours                                             | En cours : cinq passages initiaux par client ; correctif du lecteur livré, comparaison après correctif et lecture prolongée à terminer |
| 7. Distribution | Installateur Windows et documentation                                   | Installer et lancer sur Windows ; signaler les fonctions manquantes                              | À faire                                                                                                                                |

## Principes techniques

- Les accès réseau passent par un client Rust partagé, avec délais, annulation,
  pagination et limites de cache. L'interface ne lance pas de requêtes en boucle.
- Ne pas télécharger le catalogue ou la bibliothèque complète au démarrage.
- Les secrets ne vont ni dans le dépôt, ni dans les journaux, ni dans les erreurs UI.
- Valider la lecture et la connexion avant de promettre la parité Spotify.
- Ne pas confondre une interface de démonstration avec une application utilisable.

## Fonctions à inventorier

Connexion et déconnexion ; accueil ; recherche ; bibliothèque ; favoris ; albums ;
artistes ; playlists (lecture et édition) ; podcasts ; file d'attente ; lecture,
pause, piste suivante/précédente, position, volume, aléatoire, répétition ; appareils
Spotify Connect ; Jam (hébergement et invitation intégrés, participation et droits à compléter) ; médias Windows ; paroles ; téléchargements et mode hors ligne ;
paramètres ; fonctions disponibles selon le compte.

La qualité audio locale propose 96/160/320 kbit/s. Le lossless reste une fonction
manquante du moteur actuel ; le pilotage Connect d’un appareil compatible est un
parcours distinct. Voir [les limites et vérifications audio](STATUS.md#qualité-audio-et-lossless).

Le périmètre complet reste la cible. Toute fonction inaccessible doit être
documentée et discutée, sans la retirer silencieusement du plan.
