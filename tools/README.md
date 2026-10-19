# Diagnostics locaux

Ces outils servent au développement. Ils ne font pas partie des fonctions de
l'application et ne transmettent pas de données au dépôt ou à la CI.

## Connexion, catalogue et audio

Compiler `spotify-probe` sur Windows avec les prérequis Rust MSVC :

```powershell
cargo build --release --locked --manifest-path tools/spotify-probe/Cargo.toml
```

Après une connexion normale à Spotisloth, vérifier la réutilisation de sa session
et la première page de bibliothèque :

```powershell
./tools/spotify-probe/target/release/spotify-probe.exe --stored --library
```

Seule l'entrée du coffre appartenant à Spotisloth est lue. La sortie affiche des
résultats et des compteurs, sans identifiants ni jetons. `--library` est en lecture
seule. Si `SPOTISLOTH_DIAGNOSTIC_DIR` est défini, la réponse d'images est enregistrée
dans ce dossier ; utiliser uniquement un dossier local ignoré comme `.local`.

Le mode historique accepte aussi un fichier JSON local avec `accessToken` et un
`trackUri` facultatif. Ajouter `--play` lance alors le titre pendant trois secondes,
puis arrête le lecteur. Un jeton capturé peut expirer ; ce mode n'établit pas la
validité de la connexion normale. Ne jamais publier ce fichier.

Le mode `--stored --profiles` lit le profil public du compte et jusqu’à huit
propriétaires distincts de la première page de bibliothèque. Il vérifie aussi la
relecture depuis le cache. Sa sortie contient uniquement des booléens et compteurs
(`PROFILES_OK`), sans nom, URL de photo, identifiant ou autre information de compte.
Ce mode ne modifie ni les playlists ni la lecture.

## Spotify Connect

La sonde partage les réglages de construction du lecteur : 320 kbit/s demandés
par défaut. Elle ne lit pas le fichier de préférences de l’application.
`CONNECT_QUALITY` affiche uniquement le niveau courant signalé par un appareil
distant, ou `unknown`. Ce résultat ne mesure pas le format de la sortie audio locale.

Avec Spotify ouvert sur un autre appareil du même compte, ce diagnostic enregistre
un récepteur temporaire et attend les mises à jour de la liste des appareils :

```powershell
./tools/spotify-probe/target/release/spotify-probe.exe --stored --connect
```

Il ne lance aucun morceau et ne transfère pas la lecture. Il affiche seulement
des compteurs (`CONNECT_DEVICES_OK`) ; il ferme sa session à la fin. Les transferts
et commandes du lecteur doivent aussi être vérifiés dans l’exécutable Tauri.

`--connect-transfer-roundtrip` transfère la lecture active vers le récepteur de
diagnostic, puis vers l’appareil d’origine. `--connect-queue-roundtrip` ajoute le
titre courant et retire uniquement la nouvelle occurrence confirmée dans la file.
Le serveur peut renuméroter les UID : la sonde vérifie donc aussi le préfixe manuel
et l’ordre des autres titres avant le retrait.
Ces deux modes modifient réellement la lecture ; les exécuter séparément avec le
lecteur en pause et fermer Spotisloth auparavant. Les réponses affichées décrivent
les compteurs, les types et les noms des champs ; elles ne contiennent ni URI,
nom d’appareil, identifiant du compte, ni jeton.

`--connect-transfer-playing-roundtrip` accepte aussi une lecture en cours et vérifie
sa continuité à la position attendue après l’aller-retour. Il peut interrompre
brièvement le son pendant le changement d’appareil. Le préfixe de file est comparé
sans afficher les URI.

`--connect-volume-roundtrip` vérifie un changement de volume avec le lecteur en
pause, puis remet le niveau initial. `SPOTISLOTH_CONNECT_TRACE=1` affiche uniquement
le type d’opération, la méthode HTTP et le code de réponse. Le volume utilise PUT,
conformément à la [correction du client spogo](https://github.com/openclaw/spogo/pull/24/files).

Après un diagnostic interrompu seulement, `--connect-cleanup-test-prefix=N` peut
retirer de une à trois occurrences de test en tête. Vérifier auparavant que ces
occurrences ont bien été créées par le test. La sonde refuse un autre titre ou un
élément provenant du contexte ; ce mode ne doit pas servir à nettoyer une file
personnelle sans vérification.

## Jam (diagnostic de création et fermeture)

`--stored --connect-jam-roundtrip` vérifie l'absence de Jam, crée une session,
relit son état, attend une notification Connect puis termine uniquement la session
renvoyée. Fermer Spotisloth avant le test. Le diagnostic refuse une session déjà
existante et n'envoie aucune invitation. Il affiche des booléens et des compteurs,
sans lien d'invitation, membre, identifiant ou jeton.

`SPOTISLOTH_JAM_TRACE=1` ajoute uniquement le statut HTTP et l'indication de mutation.

## Ressources

Voir le [protocole de mesure](../docs/PERFORMANCE.md) pour `Measure-Client.ps1`.

Le relevé sépare RAM privée résidente, mémoire engagée et working set total. Le CPU
est pondéré par les intervalles réels, sur la capacité totale du PC. `-Scenario`
vaut `Idle`, `Navigation` ou `Playback` ; `-Seconds` accepte jusqu’à 900 secondes.
`Start-ClientBenchmark.ps1` ferme complètement puis relance l’application, avec
un horodatage UTC. Ces scripts ne vident pas les caches et n’enregistrent pas les
contenus de l’interface, les lignes de commande ou les identifiants de compte.
