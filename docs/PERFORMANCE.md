# Mesures de performance

## Première observation

Le 15 octobre 2026, la somme des working sets des neuf processus Spotify ouverts
était d'environ 1 425 Mio. C'est une observation ponctuelle d'une session existante,
pas une mesure de démarrage ni une consommation privée et exclusive. Les pages
mémoire partagées peuvent être comptées plusieurs fois.

## Relevé du prototype Windows

Le 15 octobre 2026, après connexion puis redémarrage de Spotisloth, 15 échantillons
espacés d'une seconde ont été relevés, avec tous les descendants WebView2.
Le client affichait l'accueil réel, sans lecture. La médiane de mémoire privée
était de **251,38 Mio**, sur sept processus ; le CPU moyen était arrondi à 0 %.

Dans la session Spotify déjà ouverte, un relevé distinct de 15 échantillons donnait
1 988,52 Mio de mémoire privée. Le parcours précédent, l'état de la fenêtre et la
durée de session n'étaient pas identiques. Le prototype n'intégrait pas encore
toutes les fonctions. Ces chiffres décrivent deux sessions existantes : ils ne
permettent pas de calculer un gain à fonctionnalités équivalentes.

## Comparaison à réaliser

Tester Spotify et Spotisloth release sur le même PC, compte et réseau, à tour de rôle.
Fermer les applications avant les mesures à froid. Faire cinq passages par scénario.

| Scénario                             | Mesures                                                            |
| ------------------------------------ | ------------------------------------------------------------------ |
| Démarrage à froid puis repos de 30 s | Temps jusqu'à interaction, mémoire privée, working set, CPU        |
| Accueil et bibliothèque              | Délai d'affichage et nombre d'appels réseau                        |
| Recherche identique                  | Latence jusqu'aux résultats, annulation des recherches précédentes |
| Playlist longue                      | Réactivité au défilement, mémoire après parcours                   |
| Lecture pendant 10 minutes           | Coupures, CPU, mémoire et croissance des caches                    |

Inclure le processus Rust et **tous ses descendants WebView2** dans la mesure Spotisloth.
Ne pas comparer un shell vide avec un Spotify lisant de la musique. Indiquer les
fonctions absentes et conserver les résultats bruts localement.

Objectifs provisoires : réduire sensiblement mémoire et latences, sans régression
fonctionnelle. Les seuils définitifs seront fixés après le premier prototype réel.

## Campagne du 19 octobre 2026

La campagne utilise les versions release sur le même PC et le même compte, une
application à la fois. Les processus sont fermés entièrement entre les passages.
Les caches de Windows, du réseau et des applications sont conservés : il s’agit
de relances de processus à chaud, pas de démarrages après redémarrage du PC.
Les clients sont lancés maximisés. Les mesures de lecture demandent 320 kbit/s
dans les deux applications ; le réglage Spotify initial est rétabli après les essais.
Pour Tauri, le script définit `SPOTISLOTH_BENCHMARK_MAXIMIZE=1` dans le processus
enfant : ce réglage de diagnostic maximise la fenêtre à sa création, sans modifier
le lancement habituel ni les composants de l’interface.

Le temps de démarrage part de la demande de lancement. Il se termine au premier
relevé d’accessibilité présentant l’accueil chargé, des cartes et la bibliothèque.
La fenêtre seule ne suffit pas. Les relevés encadrent le délai entre la dernière
observation non prête et la première observation prête ; leur coût est inclus.
Les résultats sont arrondis en conséquence. Aucun texte de compte ou de catalogue
n’est enregistré avec les mesures.

Le relevé mémoire distingue la RAM privée résidente (`WorkingSetPrivate`), la
mémoire privée engagée (`PrivateMemorySize64`) et la somme des working sets.
Seule la première évite de compter plusieurs fois les pages partagées tout en
mesurant la résidence en RAM. Le CPU est la différence des temps processeur,
pondérée par le temps écoulé et divisée par les 16 processeurs logiques du PC.
Les processus apparus pendant un intervalle sont pris en compte et les PID réutilisés
sont distingués par leur date de création. Les premiers compteurs CPU sont ignorés.

## Outil de relevé local

`tools/Measure-Client.ps1` suit le processus principal et tous ses descendants,
y compris WebView2. Il relève RAM privée résidente, mémoire privée engagée, working set et CPU (part de la capacité
totale de la machine), sans enregistrer les lignes de commande ni informations de compte.

```powershell
./tools/Measure-Client.ps1 -Client Spotify -Seconds 15 -OutputPath .local/spotify-idle.json
./tools/Measure-Client.ps1 -Client Spotisloth -Seconds 15 -OutputPath .local/spotisloth-idle.json
```

Le premier échantillon CPU est ignoré ; une application doit déjà être ouverte.
Les médianes de mémoire sont des relevés ponctuels. Le script ne mesure pas la
latence d'affichage ni les coupures audio et ne valide pas, seul, un gain global.

`Start-ClientBenchmark.ps1` relance un client en fermant son exécutable résolu et
les descendants observés. Il conserve l’horodatage du lancement et n’efface aucun
cache. `-StopOnly` permet de fermer l’autre client avant une mesure.
