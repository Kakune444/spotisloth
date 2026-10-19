# Jam Spotify

Le Jam se lance depuis **Se connecter à un appareil → Lancer un Jam**.
Le panneau latéral présente les membres, le lien et le QR code d'invitation.
L'hôte peut terminer la session après confirmation. Spotify Premium est requis
pour héberger un Jam, selon l'[aide Spotify](https://support.spotify.com/fr/article/jam/).

## Protocole observé le 19 octobre 2026

Les captures restent dans `.local`, hors Git. Aucun jeton, identifiant de membre
ou lien de session n'est inclus ici. Les opérations utilisent la session native
de l'application et les services internes observés dans Spotify Desktop :

| Opération                    | Requête                                                        |
| ---------------------------- | -------------------------------------------------------------- |
| Lire le Jam courant          | `GET /social-connect/v2/sessions/current`                      |
| Créer ou activer un Jam      | `GET /social-connect/v2/sessions/current_or_new?activate=true` |
| Produire un lien partageable | `POST /url-dispenser/v1/generate-url`                          |
| Terminer en tant qu'hôte     | `DELETE /social-connect/v3/sessions/{session_id}`              |

`join_session_url` est une adresse interne `hm://social-connect/...`, pas un lien
à partager. Le service de liens reçoit `join_session_uri` et renvoie une adresse
HTTPS Spotify ; le QR code est généré localement. Le cache d'invitation ne conserve
que le Jam courant. Une erreur du service de liens laisse la session visible et
permet encore sa fermeture.

Les notifications Dealer déjà reçues par librespot signalent les changements.
Un canal borné transmet uniquement une révision ; l'interface relit alors l'état.
Les notifications concurrentes sont regroupées et aucun sondage périodique n'est
ajouté. Une reconnexion effectue une lecture initiale après l'accueil.

Avant une fermeture, le backend relit la session et vérifie l'identifiant attendu
et le rôle d'hôte. Une mutation n'est jamais renvoyée automatiquement après une
réponse incertaine. Les lectures tardives ne remplacent pas une création confirmée
ou les données d'un autre compte après déconnexion.

Ces routes internes peuvent changer. Cette première intégration couvre l'hôte,
l'invitation et l'affichage des membres. Rejoindre un Jam depuis un lien dans
Spotisloth, retirer des participants et modifier leurs autorisations restent à
implémenter. Les invités utilisent actuellement Spotify pour ouvrir l'invitation.
