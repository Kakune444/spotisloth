# Spotisloth

Client Spotify pour Windows, développé en Rust, Tauri et TypeScript.
Objectif : retrouver l'interface et les fonctions habituelles avec une consommation
mesurée, sans ajouter de nouvelles fonctions produit.

Projet indépendant, sans affiliation à Spotify. Ancien nom : Fastify.

## État

Prototype en développement. L'application Windows a été compilée et testée avec
un compte réel : connexion OAuth, reconnexion après redémarrage, accueil,
recherche, bibliothèque paginée, albums et playlists, lecture Rust, pause et déplacement dans le morceau.
Les favoris et l’édition des playlists utilisent aussi les services internes Spotify :
création privée, nom et description, ajout, retrait d’une occurrence et déplacement.
Le lecteur utilise désormais Spotify Connect : sélection d’un appareil, transfert,
commandes à distance et file partagée. L’aléatoire, la répétition, les ajouts et
les déplacements suivent l’appareil actif. Les vérifications de cette intégration
sont détaillées dans l’état des fonctions.
Les autres parcours sont suivis dans [l'état des fonctions](docs/STATUS.md).
**La parité Spotify n'est pas atteinte et aucun gain de performance global n'est
encore démontré.**

## Développement

Prérequis : Node.js 22.18+ (ou version LTS suivante), Rust stable MSVC, Microsoft
C++ Build Tools et WebView2. Voir les [prérequis Tauri](https://v2.tauri.app/start/prerequisites/).

```powershell
npm ci
npm run tauri dev
```

La connexion s'effectue dans le navigateur système. Le prototype utilise le flux
OAuth de librespot. Sa compatibilité doit être vérifiée avec chaque compte ; un
compte Premium est requis pour le moteur librespot. Les identifiants réutilisables
sont conservés dans le coffre Windows. Aucun mot de passe n'est demandé par Spotisloth.

Pour le diagnostic local uniquement, on peut fournir un fichier ignoré par Git via
`SPOTISLOTH_SESSION_FILE`. Ce mécanisme temporaire n'est pas la connexion normale.

```powershell
npm run check
npm test
npm run build
npm run tauri build -- --no-bundle
```

`npm run dev` affiche uniquement l'interface dans le navigateur. Les accès au compte
et la lecture nécessitent l'application Windows. La CI compile sans compte Spotify.

Dans l’application, « Titres likés » ouvre les favoris ; le bouton « + » de la
bibliothèque crée une playlist. Le menu « … » d’un titre permet de l’ajouter à une
playlist modifiable, ou de le retirer de la playlist ouverte. Les playlists
modifiables proposent « Modifier les informations ». Glisser un titre change son
ordre ; `Alt` + `↑` / `↓` déplace aussi la ligne qui a le focus.

Les boutons habituels du lecteur activent l’aléatoire et font défiler les modes de
répétition : désactivée, sélection entière, titre seul. Le menu « … » ajoute aussi
un titre à la file d’attente. Dans la file, on peut déplacer les titres, en choisir
un à lire ensuite ou retirer une occurrence. Cela ne modifie pas la playlist.

Le bouton d’appareil, à côté de la file, ouvre « Se connecter à un appareil ».
Choisir un appareil y transfère la lecture ; « Spotisloth — Cet ordinateur » la
ramène ici. Un bandeau vert indique une lecture sur un autre appareil. Les appareils
doivent être connectés au même compte Spotify. Les commandes indisponibles sur
l’appareil actif sont désactivées.

Le menu du compte propose « Préférences » → « Qualité audio » : 96, 160 ou
320 kbit/s, avec 320 kbit/s par défaut. Le choix est enregistré localement et
s’applique au prochain démarrage du lecteur. La qualité effectivement disponible
peut varier selon le titre.

**La lecture locale ne prend pas en charge le lossless.** Le moteur
[librespot ne le prend pas en charge](https://github.com/librespot-org/librespot/issues/1583).
Sur un appareil distant compatible, Spotify Connect laisse cet appareil gérer
son audio ; la page Préférences affiche la qualité qu’il signale. Le niveau demandé
et la compatibilité de l’appareil ne suffisent pas à afficher « Lossless ».

## Suivi

- [Plan et critères de validation](docs/PLAN.md)
- [Étude de faisabilité](docs/FEASIBILITY.md)
- [Protocole de mesure](docs/PERFORMANCE.md)
- [État des fonctions et vérifications](docs/STATUS.md)

Les captures Fiddler, cookies, jetons, historiques et données personnelles restent
en local dans les dossiers ignorés par Git. Ne jamais les joindre à une issue.

Le moteur audio utilise [librespot](https://github.com/librespot-org/librespot), sous
licence MIT. Les pochettes et contenus restent fournis par Spotify.
Une [petite adaptation locale](vendor/librespot-connect/SPOTISLOTH.md) expose les
états Connect déjà reçus par ce moteur, sans ajouter de requêtes réseau, et corrige
la désactivation du récepteur lors d’un transfert sortant.
