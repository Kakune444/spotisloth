# État du prototype

Date de vérification : 19 octobre 2026. Une fonction implémentée reste à vérifier
dans l'exécutable avant d'être déclarée opérationnelle.

| Élément                                | État et preuve                                                                                                                                                                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dépôt public                           | Créé, commits et workflow Windows disponibles                                                                                                                                                                                                  |
| Connexion native avec session capturée | Vérifiée : `SESSION_OK`                                                                                                                                                                                                                        |
| Métadonnées natives                    | Vérifiées : `METADATA_OK`                                                                                                                                                                                                                      |
| Lecture audio native                   | Démarrage et arrêt après trois secondes vérifiés : `PROBE_OK`                                                                                                                                                                                  |
| Accueil interne                        | Rejeu HTTP 200, y compris sans identifiant de suivi                                                                                                                                                                                            |
| Recherche complète interne             | Rejeu HTTP 200 de `searchDesktop`                                                                                                                                                                                                              |
| Connexion OAuth et coffre Windows      | Connexion terminée par l'utilisateur ; reconnexion après redémarrage vérifiée                                                                                                                                                                  |
| Interface et lecteur Tauri             | Exécutable release compilé ; accueil, recherche et lecteur testés sous Windows                                                                                                                                                                 |
| Bibliothèque                           | Noms, pochettes et deuxième page vérifiés : 27 puis 57 playlists affichées                                                                                                                                                                     |
| Albums et playlists                    | Album de 16 titres et playlist de 36 titres affichés ; pagination à vérifier                                                                                                                                                                   |
| Pause et position                      | Pause et déplacement à 25 % vérifiés dans l'application                                                                                                                                                                                        |
| Volume et file locale                  | Volume réglé à 20 %, titre suivant et conservation après consultation d’un autre album vérifiés                                                                                                                                                |
| Favoris                                | Ajout puis retrait confirmés par relecture sur un compte réel ; état initial restauré                                                                                                                                                          |
| Édition des playlists                  | Création privée, nom/description, ajout, retrait d’un doublon, déplacement et conflit vérifiés par le moteur ; formulaires, menu et recherche du sélecteur vérifiés dans Tauri                                                                 |
| Artistes, podcasts, livres audio       | Recherche partielle, pages et lecture à compléter                                                                                                                                                                                              |
| Aléatoire et répétition                | Aléatoire et titre suivant vérifiés dans Tauri ; répétition du titre à sa fin et retour au début de la playlist vérifiés                                                                                                                       |
| File locale                            | Ajout prioritaire, doublon distinct, métadonnées différées, enchaînement après fin et glisser-déposer Windows vérifiés                                                                                                                         |
| File et appareils Connect              | Deux appareils détectés ; commandes et file vérifiées dans Tauri. Transferts aller-retour vérifiés en lecture et en pause, avec conservation des modes et des 40 titres suivants ; volume et ajout/retrait d’un doublon confirmés par la sonde |
| Paroles, hors ligne, médias Windows    | À étudier et implémenter                                                                                                                                                                                                                       |
| Comparaison de ressources équivalentes | Cinq relances et relevés au repos par client effectués ; comparaison après correctif et lecture prolongée à terminer, voir PERFORMANCE.md                                                                                                      |
| Jam Spotify                            | Hébergement, profil des membres, lien et QR code vérifiés dans Tauri ; création/relecture/notification/fermeture vérifiées par la sonde. Participation d'un autre compte à confirmer                                                           |
| Installateur et distribution publique  | En attente d'une version utilisable                                                                                                                                                                                                            |

## Limites techniques connues

Les requêtes internes et leurs hashes peuvent changer côté Spotify. Le frontend
n'inclut pas de runtime Node.js en production. Le moteur audio est Rust ; WebView2
affiche uniquement l'interface. Les données et secrets restent côté Rust, sauf les
métadonnées utiles à l'affichage. Les captures et fichiers de diagnostic restent
exclus du dépôt et des artefacts CI.

L'expiration est gérée par librespot pour les sessions natives. Le mode de diagnostic
par fichier dépend d'un jeton temporaire. La recherche est temporisée à 350 ms et
ignore les réponses devenues obsolètes ; l'annulation réseau complète est à ajouter.

Les dossiers, albums et artistes suivis ne sont pas encore intégrés à la
bibliothèque. La lecture de collection charge 40 titres par
page. Le nouveau lecteur laisse librespot résoudre et paginer le contexte Spotify ;
la file affichée suit les prochains titres publiés par l’appareil actif.
Le renouvellement après expiration réelle et la récupération d'une session révoquée
restent à éprouver ; la reconnexion après redémarrage ne suffit pas à les valider.

Les modifications de playlists utilisent la révision lue sur le serveur. Un conflit
déclenche un rechargement ; une requête d’écriture dont la réponse est perdue n’est
jamais renvoyée automatiquement. Les droits renvoyés par Spotify priment sur le
statut de propriétaire. Le retrait vise une position précise pour conserver les
autres occurrences du même titre. Les métadonnées indisponibles conservent leur
position dans la liste.

La liste des favoris est paginée. Le service collection peut renvoyer des éléments
supprimés ou d’autres types : les pages sans titre sont sautées dans une limite de
dix requêtes par chargement. Les playlists proposées pour l’ajout sont chargées
seulement à l’ouverture du sélecteur ; leur contenu n’est pas préchargé.

## Vérification des mutations Spotify

La sonde utilise la session de Spotisloth dans le coffre Windows. Le test de favori
choisit un titre initialement absent, confirme son ajout, puis confirme son retrait.
Le test de playlist crée un élément privé temporaire, vérifie les opérations et
le retire de la bibliothèque à la fin. Il vérifie aussi qu’une ancienne révision
est refusée et qu’un seul doublon est retiré. Aucune donnée de compte ne passe par
la compilation GitHub.

Le client Tauri a affiché les vrais Titres likés et leur état sauvegardé. Les
fenêtres de création et de modification ont été ouvertes ; le menu d’un titre
ouvre un sélecteur ne contenant que des playlists modifiables. Sa recherche a
été testée. Les mutations complètes sont vérifiées par la sonde qui partage le
même service Rust ; tous les clics d’écriture n’ont pas été rejoués dans l’interface.

## Profils et noms des propriétaires

Les identifiants de compte et de propriétaire servent aux requêtes et aux droits ;
ils ne sont plus utilisés comme noms affichés. Le profil public fournit le nom et
la photo du compte. La bibliothèque charge les noms des propriétaires après ses
playlists, sans attendre ces profils pour afficher les titres ou activer la lecture.
Si le profil est indisponible, l’avatar reste neutre et le sous-titre reste « Playlist ».

Les requêtes passent par le service de profils de librespot, avec les listes de
playlists et d’artistes du profil désactivées. Trois requêtes au maximum sont actives.
Un cache de 256 entrées au maximum, partagé par le compte et la bibliothèque,
regroupe les lectures simultanées du même propriétaire. Les réponses positives sont
conservées dix minutes, les absences une minute. La déconnexion vide ce cache et
invalide les réponses tardives dans l’interface. Seuls le nom public et l’URL HTTPS
de la photo sont conservés dans le modèle de profil.

## Qualité audio et lossless

Les préférences proposent 96, 160 et 320 kbit/s. La lecture locale demande désormais
320 kbit/s par défaut, au lieu des 160 kbit/s implicites de librespot. Le moteur peut
utiliser un autre format disponible pour un titre ; le réglage décrit une préférence,
pas une mesure du flux décodé. Il est enregistré dans un petit fichier local, remplacé
sans exposer une écriture partielle. Il s’applique à la prochaine création du lecteur ;
l’interface indique lorsqu’un redémarrage est nécessaire.

Le lossless local reste indisponible avec librespot 0.8.0. La présence d’un décodeur
FLAC parmi ses dépendances ne signifie pas que le service de streaming lossless de
Spotify est pris en charge. Les mainteneurs le confirment dans
[le suivi officiel de librespot](https://github.com/librespot-org/librespot/issues/1583).

Un appareil distant compatible peut utiliser son propre moteur lossless.
La page Préférences utilise le niveau courant de `playback_quality`, jamais son
niveau cible. Les niveaux HiFi exigent aussi `hifi_status=on`. Une capacité annoncée,
un niveau inconnu ou un état de chargement ne produit pas d’indication Lossless.
Le rapport distant est ignoré lorsque Spotisloth devient l’appareil actif pour éviter
de reprendre la qualité du lecteur précédent. Il ne constitue pas une mesure du
signal reçu par un casque ou un DAC. Le réglage de qualité d’un autre appareil reste
dans Spotify, selon [la procédure officielle](https://support.spotify.com/fr/article/lossless-audio-quality/).

## Spotify Connect et file partagée

Le même moteur Rust assure la lecture audio et le récepteur Connect. La réponse
d’inscription et les mises à jour du serveur alimentent l’interface ; elle ne
demande pas l’état Spotify en boucle. L’identifiant de cet ordinateur est conservé
localement pour retrouver le même appareil après redémarrage. La session conservée
sous l’ancien nom Fastify est reprise dans le coffre Spotisloth après connexion.

La liste d’appareils, le titre, la position, les modes et la file suivent l’appareil
actif. Le moteur gère aussi les fins de morceaux ; l’interface ne fait plus avancer
une seconde file locale. Elle affiche 40 titres à la fois parmi les prochains titres
publiés par Spotify (jusqu’à 80 pour le récepteur librespot). Les métadonnées
manquantes restent chargées au besoin, par lots limités.
Les séparateurs internes restent dans le protocole et sont exclus des lignes de
titres. L’affichage s’arrête au premier séparateur de cycle pour ne pas présenter
les répétitions futures comme des ajouts. Les ajouts manuels et la suite du contexte
ont leurs sections habituelles.

Les commandes capturent l’appareil visé. Les déplacements et retraits utilisent la
révision de file et une occurrence précise : une ancienne ligne ne peut pas cibler
un autre doublon après une mise à jour. Les restrictions de l’appareil actif sont
appliquées dans le lecteur et vérifiées côté Rust. Une commande réseau dont la
réponse est perdue n’est pas renvoyée automatiquement ; le message demande de
vérifier la lecture. La file partagée n’écrit pas dans les playlists.

Un transfert attend la confirmation de l’appareil et du morceau. Le récepteur local
attend aussi la préparation de son contexte. Si la destination reconstruit un autre
ordre, le client restaure la portion de file publiée par la source, avec la révision
courante de la destination. L’instantané reste borné et côté Rust. Les modes, le
contexte et les ajouts manuels sont contrôlés avant cette restauration ; un changement
concurrent l’interrompt. La position et l’état lecture/pause sont également rétablis
si nécessaire, après confirmation de la destination.

La copie locale de librespot-connect 0.8.0 conserve sa licence et son empreinte
d’origine. Son [adaptation documentée](../vendor/librespot-connect/SPOTISLOTH.md)
publie les états déjà reçus lors de l’inscription, des commandes et des mises à jour.
Elle ajoute un canal borné en mémoire, sans nouveau trafic réseau.
Elle corrige aussi l’ordre de désactivation lors d’un transfert sortant pour que
le récepteur ne reprenne pas la main au moment d’arrêter sa lecture locale.

Le gestionnaire natif de dépôt Tauri est désactivé dans la fenêtre Windows pour
permettre le glisser-déposer HTML des lignes. Ce réglage suit la
[configuration officielle Tauri](https://v2.tauri.app/reference/config/#windowconfig).

L’implémentation utilise les appareils enregistrés sur le compte. La découverte
locale par mDNS et l’appairage Cast ne sont pas implémentés.
Le Jam permet d'héberger et d'inviter ; rejoindre depuis un lien dans Spotisloth
et gérer les autorisations des participants restent à implémenter.
Les appareils physiques, les restrictions propres à chaque modèle et une longue
perte réseau nécessitent des vérifications supplémentaires.
La conservation de l’ordre porte sur le tampon publié par l’appareil source ; elle
ne garantit pas le même tirage aléatoire au-delà de ce tampon.

## Version vérifiée

Code compilé : `862abde`.
[Compilation Windows et tests](https://github.com/Kakune444/spotisloth/actions/runs/39303187533)
réussis : 31 tests TypeScript et 38 tests Rust. Les vérifications utilisent le
compte local, avec Spotify Windows et le récepteur Spotisloth. Elles ne constituent
pas une validation de tous les appareils Connect.

Dans `862abde`, le cycle Jam réel confirme la création, le lien partageable,
la relecture, une notification Dealer et la fermeture avec retour à l'absence de
session. Le panneau Tauri affiche l'hôte, sa photo et le QR code ; « Copier le lien »
confirme la copie. Un transfert en lecture vers Spotisloth conserve le Jam ; le
serveur confirme Spotisloth comme appareil hôte et la position continue de progresser.
Le protocole et les limites sont détaillés dans [JAM.md](JAM.md).

Dans `33bafd3`, la sonde confirme le nom public et la photo du compte, la relecture
du cache et les quatre propriétaires distincts de la première page. La version
Windows a été relancée : photo de compte et noms publics des propriétaires sont
visibles dans la bibliothèque, sans identifiant technique en sous-titre.

Dans `7bf8ea4`, le menu du compte et la page Préférences sont vérifiés dans Tauri.
Le passage de 320 à 96 kbit/s affiche le message de redémarrage ; après relance,
96 kbit/s est conservé et devient le réglage actif. Le choix 320 kbit/s est ensuite
rétabli et confirmé actif après une seconde relance. La qualité distante « Lossless »
est lue par la sonde et affichée dans Tauri.
L’aller-retour Spotify → récepteur de diagnostic → Spotify conserve la pause, la
position et les 40 titres suivants ; Spotify signale encore Lossless après le retour.
Le format réellement décodé par la sortie locale n’a pas été instrumenté.

Dans Tauri (`35d04f1`), la lecture native apparaît dans Spotify et les commandes de
pause/reprise suivent l’appareil actif. La position distante, le choix d’un titre
de la file et son déplacement au clavier ont été vérifiés ; l’ordre déplacé a été
restauré. La version `670abfb` a été lancée sous Windows : reconnexion,
accueil, titre distant, bandeau de lecture, sélecteur d’appareils et affichage de la
file partagée sont vérifiés.

La sonde de `670abfb`, qui utilise le même service Rust, confirme les transferts
Spotify → Spotisloth → Spotify en lecture et en pause. Elle vérifie le même morceau,
la position à deux secondes près, les modes aléatoire/répétition et les 40 premières
occurrences à suivre. Le volume est modifié puis restauré avec confirmation serveur.
Un doublon est ajouté puis son occurrence précise retirée ; les autres titres sont
conservés. Aucun titre de test ne reste dans la file et la lecture a repris sur
l’appareil d’origine.

Avant le remplacement de la file locale par Connect, l’aléatoire sur le contexte complet, le passage au titre affiché dans la file,
la répétition d’un titre après sa fin réelle et le retour de la fin d’une playlist
à son début ont été vérifiés dans `162e4cf`. L’ajout prioritaire d’une occurrence
en double puis le retour à la sélection ont également été vérifiés. La sonde de
cette version a relu les liens de tous les favoris et leur état sans mutation.

Les essais de mutations de favoris et de playlists restent ceux de `2886e1e`,
avec le même service Rust d’écriture. Les formulaires et le sélecteur avaient été
vérifiés dans `8aa06b2`, puis le visuel et la pagination des favoris dans `327a6c4`.
