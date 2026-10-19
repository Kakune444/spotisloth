use futures_util::{StreamExt, stream};
use librespot_core::{
    SpotifyUri, authentication::Credentials, config::SessionConfig, session::Session,
};
use librespot_metadata::{Album, Metadata, Track};
use librespot_oauth::OAuthClientBuilder;
use librespot_playback::{
    audio_backend,
    config::AudioFormat,
    mixer::{Mixer, MixerConfig, softmixer::SoftMixer},
    player::Player,
};
use protobuf::Message;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager, State};
use tokio::sync::{Mutex, Semaphore};
mod audio;
mod connect;
mod library_api;
use audio::{AudioPreferences, AudioQuality};
use connect::{ConnectAction, ConnectError, ConnectRuntime, ConnectView};
use library_api::{LibraryApi, LibraryError};
use library_api::{PlaylistEdit, playlist_permissions, revision_hex};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppError {
    code: &'static str,
    message: &'static str,
    retry_after_seconds: Option<u64>,
}
type Result<T> = std::result::Result<T, AppError>;
impl From<ConnectError> for AppError {
    fn from(value: ConnectError) -> Self {
        match value {
            ConnectError::Input => error("INPUT", "Commande Spotify Connect invalide."),
            ConnectError::NotReady => error(
                "CONNECT_NOT_READY",
                "Spotify Connect se reconnecte. Réessayez dans un instant.",
            ),
            ConnectError::Missing => error(
                "NOT_FOUND",
                "Cet appareil ou ce titre n’est plus disponible.",
            ),
            ConnectError::Restricted => error(
                "RESTRICTED",
                "Cette commande n’est pas disponible sur cet appareil.",
            ),
            ConnectError::Conflict => error(
                "CONFLICT",
                "La lecture ou la file a changé. Vérifiez son état avant de recommencer.",
            ),
            ConnectError::RateLimited(wait) => AppError {
                code: "RATE_LIMIT",
                message: "Spotify demande de patienter avant de réessayer.",
                retry_after_seconds: Some(wait),
            },
            ConnectError::Auth => error("AUTH_REQUIRED", "Reconnectez-vous à Spotify."),
            ConnectError::Network => network_error("connect"),
            ConnectError::Uncertain => error(
                "UNCERTAIN",
                "Spotify n’a pas confirmé la commande. Vérifiez la lecture avant de réessayer.",
            ),
            ConnectError::Protocol => error(
                "API_CHANGED",
                "La réponse Spotify Connect doit être adaptée.",
            ),
        }
    }
}
fn error(code: &'static str, message: &'static str) -> AppError {
    AppError {
        code,
        message,
        retry_after_seconds: None,
    }
}
fn network_error(_: impl std::fmt::Display) -> AppError {
    error(
        "NETWORK",
        "Spotify est indisponible. Réessayez dans un instant.",
    )
}

impl From<LibraryError> for AppError {
    fn from(value: LibraryError) -> Self {
        match value {
            LibraryError::Input => error("INPUT", "Ces informations ne sont pas valides."),
            LibraryError::Auth => error("AUTH_REQUIRED", "Reconnectez-vous à Spotify."),
            LibraryError::Permission => error(
                "PERMISSION",
                "Vous n’avez pas les droits pour modifier cette playlist.",
            ),
            LibraryError::Missing => error("NOT_FOUND", "Cette playlist n’est plus disponible."),
            LibraryError::Conflict => error(
                "CONFLICT",
                "La playlist a changé. Rechargez-la avant de recommencer.",
            ),
            LibraryError::RateLimited(wait) => AppError {
                code: "RATE_LIMIT",
                message: "Spotify demande de patienter avant de réessayer.",
                retry_after_seconds: Some(wait),
            },
            LibraryError::Uncertain => error(
                "UNCERTAIN",
                "Spotify n’a pas confirmé la modification. Vérifiez son résultat avant de réessayer.",
            ),
            LibraryError::Protocol => error(
                "API_CHANGED",
                "La réponse Spotify a changé et doit être adaptée.",
            ),
            LibraryError::Network => network_error("network"),
        }
    }
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportedAuth {
    access_token: String,
    client_token: Option<String>,
}
struct Native {
    session: Session,
    player: Arc<Player>,
    connect: Arc<ConnectRuntime>,
    quality: AudioQuality,
}
struct Backend {
    client: reqwest::Client,
    native: Mutex<Option<Native>>,
    imported: Mutex<Option<ImportedAuth>>,
    connection: Mutex<()>,
    requests: Semaphore,
    metadata: Semaphore,
    writes: Mutex<()>,
    cooldown: Mutex<Option<Instant>>,
    cache: Mutex<HashMap<String, (Instant, Value)>>,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrackView {
    uri: String,
    name: String,
    artist: String,
    album: String,
    image: String,
    duration_ms: u32,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Status {
    connected: bool,
    native_ready: bool,
    username: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Collection {
    name: String,
    description: String,
    revision: Option<String>,
    can_edit_metadata: bool,
    can_edit_items: bool,
    tracks: Vec<CollectionTrack>,
    total: usize,
    offset: usize,
}
#[derive(Serialize)]
struct CollectionTrack {
    #[serde(flatten)]
    track: TrackView,
    position: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LikedPage {
    tracks: Vec<TrackView>,
    next_token: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ContextPage {
    uris: Vec<String>,
    next: Option<String>,
    revision: Option<String>,
}

impl Backend {
    async fn library_result<T>(&self, result: library_api::Result<T>) -> Result<T> {
        if let Err(LibraryError::RateLimited(wait)) = &result {
            *self.cooldown.lock().await = Some(Instant::now() + Duration::from_secs(*wait));
        }
        result.map_err(Into::into)
    }
    async fn check_library_cooldown(&self) -> Result<()> {
        if let Some(until) = *self.cooldown.lock().await {
            if until > Instant::now() {
                return Err(
                    LibraryError::RateLimited((until - Instant::now()).as_secs() + 1).into(),
                );
            }
        }
        Ok(())
    }

    async fn track_views(&self, session: &Session, uris: Vec<String>) -> Result<Vec<TrackView>> {
        let tracks: Vec<_> = stream::iter(uris)
            .map(|uri| async move {
                let Ok(parsed) = SpotifyUri::from_uri(&uri) else {
                    return Ok::<_, AppError>(TrackView {
                        uri,
                        name: "Titre indisponible".into(),
                        ..TrackView::default()
                    });
                };
                let result = tokio::time::timeout(Duration::from_secs(15), async {
                    let _slot = self.metadata.acquire().await.map_err(network_error)?;
                    Track::get(session, &parsed).await.map_err(network_error)
                })
                .await;
                Ok::<_, AppError>(match result {
                    Ok(Ok(track)) => track_view(track),
                    _ => TrackView {
                        uri,
                        name: "Titre indisponible".into(),
                        ..TrackView::default()
                    },
                })
            })
            .buffered(4)
            .collect()
            .await;
        tracks.into_iter().collect()
    }

    fn new() -> Self {
        Self {
            client: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(15))
                .connect_timeout(Duration::from_secs(5))
                .build()
                .expect("HTTP client"),
            native: Mutex::new(None),
            imported: Mutex::new(None),
            connection: Mutex::new(()),
            requests: Semaphore::new(3),
            metadata: Semaphore::new(4),
            writes: Mutex::new(()),
            cooldown: Mutex::new(None),
            cache: Mutex::new(HashMap::new()),
        }
    }
    async fn session(&self) -> Result<Session> {
        self.native
            .lock()
            .await
            .as_ref()
            .map(|n| n.session.clone())
            .filter(|s| !s.is_invalid())
            .ok_or_else(|| {
                error(
                    "AUTH_REQUIRED",
                    "Connectez-vous à Spotify pour écouter votre musique.",
                )
            })
    }
    async fn auth(&self) -> Result<ImportedAuth> {
        if let Ok(session) = self.session().await {
            let access =
                tokio::time::timeout(Duration::from_secs(15), session.login5().auth_token())
                    .await
                    .map_err(network_error)?
                    .map_err(network_error)?;
            let client_token =
                tokio::time::timeout(Duration::from_secs(15), session.spclient().client_token())
                    .await
                    .map_err(network_error)?
                    .map_err(network_error)?;
            return Ok(ImportedAuth {
                access_token: access.access_token,
                client_token: Some(client_token),
            });
        }
        self.imported.lock().await.clone().ok_or_else(|| {
            error(
                "AUTH_REQUIRED",
                "Connectez-vous à Spotify pour retrouver votre musique.",
            )
        })
    }
    async fn query(&self, name: &str, variables: Value) -> Result<Value> {
        let key = format!("{name}:{variables}");
        if let Some((time, value)) = self.cache.lock().await.get(&key) {
            if time.elapsed() < Duration::from_secs(45) {
                return Ok(value.clone());
            }
        }
        let _slot = self.requests.acquire().await.map_err(network_error)?;
        if let Some(until) = *self.cooldown.lock().await {
            if until > Instant::now() {
                return Err(AppError {
                    code: "RATE_LIMIT",
                    message: "Spotify demande de patienter avant de réessayer.",
                    retry_after_seconds: Some((until - Instant::now()).as_secs() + 1),
                });
            }
        }
        let auth = self.auth().await?;
        let definitions: Value =
            serde_json::from_str(include_str!("queries.json")).map_err(network_error)?;
        let mut body = definitions
            .get(name)
            .cloned()
            .ok_or_else(|| error("QUERY", "Cette page n'est pas encore disponible."))?;
        body["variables"] = variables;
        let mut request = self
            .client
            .post("https://api-partner.spotify.com/pathfinder/v2/query")
            .bearer_auth(&auth.access_token)
            .header("app-platform", "Win32")
            .json(&body);
        if let Some(token) = auth.client_token {
            request = request.header("client-token", token);
        }
        let response = request.send().await.map_err(network_error)?;
        if response.status().as_u16() == 429 {
            let wait = response
                .headers()
                .get("retry-after")
                .and_then(|h| h.to_str().ok())
                .and_then(|h| h.parse::<u64>().ok())
                .unwrap_or(60)
                .clamp(1, 3600);
            *self.cooldown.lock().await = Some(Instant::now() + Duration::from_secs(wait));
            return Err(AppError {
                code: "RATE_LIMIT",
                message: "Spotify demande de patienter avant de réessayer.",
                retry_after_seconds: Some(wait),
            });
        }
        if matches!(response.status().as_u16(), 401 | 403) {
            self.imported.lock().await.take();
            return Err(error(
                "AUTH_REQUIRED",
                "La session a expiré. Reconnectez-vous à Spotify.",
            ));
        }
        let body: Value = response
            .error_for_status()
            .map_err(network_error)?
            .json()
            .await
            .map_err(network_error)?;
        if body
            .get("errors")
            .and_then(Value::as_array)
            .is_some_and(|e| !e.is_empty())
        {
            return Err(error(
                "API_CHANGED",
                "Cette page Spotify a changé et doit être adaptée.",
            ));
        }
        let mut cache = self.cache.lock().await;
        cache.retain(|_, (time, _)| time.elapsed() < Duration::from_secs(45));
        if cache.len() >= 24 {
            cache.clear();
        }
        cache.insert(key, (Instant::now(), body.clone()));
        Ok(body)
    }
}

#[tauri::command]
async fn get_status(state: State<'_, Arc<Backend>>) -> Result<Status> {
    let native = state.native.lock().await;
    let ready = native.as_ref().is_some_and(|n| !n.session.is_invalid());
    Ok(Status {
        connected: ready || state.imported.lock().await.is_some(),
        native_ready: ready,
        username: native
            .as_ref()
            .filter(|_| ready)
            .map(|n| n.session.username()),
    })
}

#[tauri::command]
async fn connect_spotify(
    app: tauri::AppHandle,
    state: State<'_, Arc<Backend>>,
    interactive: bool,
) -> Result<Status> {
    let _connection = state.connection.lock().await;
    if state.session().await.is_ok() {
        return get_status(state.clone()).await;
    }
    let mut config = SessionConfig::default();
    let device_path = app
        .path()
        .app_local_data_dir()
        .map_err(network_error)?
        .join("connect-device-id");
    if let Ok(saved) = std::fs::read_to_string(&device_path) {
        if !saved.is_empty()
            && saved.len() <= 80
            && saved
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        {
            config.device_id = saved;
        }
    }
    if let Some(parent) = device_path.parent() {
        std::fs::create_dir_all(parent).map_err(network_error)?;
    }
    std::fs::write(&device_path, &config.device_id).map_err(network_error)?;
    let vault = keyring::Entry::new("spotisloth-desktop", "spotify-session")
        .map_err(|_| error("STORAGE", "Le coffre Windows est indisponible."))?;
    let local = std::env::var_os("SPOTISLOTH_SESSION_FILE")
        .or_else(|| std::env::var_os("FASTIFY_SESSION_FILE"))
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| {
            serde_json::from_slice::<ImportedAuth>(
                b.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&b),
            )
            .ok()
        });
    let imported_mode = local.is_some();
    let credentials = if let Some(auth) = local {
        *state.imported.lock().await = Some(auth.clone());
        Credentials::with_access_token(auth.access_token)
    } else if let Ok(saved) = vault
        .get_password()
        .or_else(|_| keyring::Entry::new("fastify-desktop", "spotify-session")?.get_password())
    {
        serde_json::from_str(&saved)
            .map_err(|_| error("STORAGE", "La session enregistrée n'est plus valide."))?
    } else if interactive {
        let client_id = config.client_id.clone();
        let token = tauri::async_runtime::spawn_blocking(move || {
            OAuthClientBuilder::new(&client_id, "http://127.0.0.1:8898/login", vec!["streaming"])
                .open_in_browser()
                .with_custom_message("Connexion terminée. Vous pouvez revenir dans Spotisloth.")
                .build()
                .and_then(|client| client.get_access_token())
        })
        .await
        .map_err(network_error)?
        .map_err(|_| {
            error(
                "AUTH_REQUIRED",
                "La connexion Spotify n'a pas abouti. Réessayez.",
            )
        })?;
        Credentials::with_access_token(token.access_token)
    } else {
        return Err(error("AUTH_REQUIRED", "Connectez-vous à Spotify."));
    };
    let session = Session::new(config, None);
    let quality = AudioPreferences::read(&audio_preferences_path(&app)?)
        .map_err(|_| error("STORAGE", "Impossible de lire les préférences audio."))?
        .quality;
    let mixer = SoftMixer::open(MixerConfig::default()).map_err(network_error)?;
    let backend = audio_backend::find(Some("rodio".to_owned()))
        .ok_or_else(|| error("AUDIO", "Aucune sortie audio n'est disponible."))?;
    let player = Player::new(
        quality.player_config(),
        session.clone(),
        mixer.get_soft_volume(),
        move || backend(None, AudioFormat::default()),
    );
    let runtime = match ConnectRuntime::start(
        session.clone(),
        credentials,
        player.clone(),
        Arc::new(mixer.clone()),
        state.client.clone(),
    )
    .await
    {
        Ok(runtime) => Arc::new(runtime),
        Err(err) => {
            session.shutdown();
            return Err(err.into());
        }
    };
    if !imported_mode {
        let reusable = Credentials { username: Some(session.username()), auth_data: session.auth_data(), auth_type: librespot_protocol::authentication::AuthenticationType::AUTHENTICATION_STORED_SPOTIFY_CREDENTIALS };
        let saved = serde_json::to_string(&reusable).map_err(network_error)?;
        if vault.set_password(&saved).is_err() {
            runtime.shutdown();
            session.shutdown();
            return Err(error(
                "STORAGE",
                "Impossible d'enregistrer la session dans le coffre Windows.",
            ));
        }
    }
    let mut updates = runtime.subscribe();
    *state.native.lock().await = Some(Native {
        session: session.clone(),
        player,
        connect: runtime,
        quality,
    });
    let shared = state.inner().clone();
    tauri::async_runtime::spawn(async move {
        loop {
            if session.is_invalid() {
                break;
            }
            let current = shared.native.lock().await;
            if current
                .as_ref()
                .is_none_or(|n| n.session.device_id() != session.device_id())
            {
                break;
            }
            drop(current);
            let snapshot = updates.borrow_and_update().clone();
            let _ = app.emit("connect-state", snapshot);
            if updates.changed().await.is_err() {
                break;
            }
        }
    });
    get_status(state.clone()).await
}

#[tauri::command]
async fn disconnect_spotify(state: State<'_, Arc<Backend>>) -> Result<()> {
    let _connection = state.connection.lock().await;
    if let Some(native) = state.native.lock().await.take() {
        native.connect.shutdown();
        native.player.stop();
        native.session.shutdown();
    }
    state.imported.lock().await.take();
    state.cache.lock().await.clear();
    for service in ["spotisloth-desktop", "fastify-desktop"] {
        if let Ok(entry) = keyring::Entry::new(service, "spotify-session") {
            match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => {}
                Err(_) => {
                    return Err(error(
                        "STORAGE",
                        "La session locale n'a pas pu être supprimée.",
                    ));
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
async fn get_home(state: State<'_, Arc<Backend>>, timezone: String) -> Result<Value> {
    if timezone.len() > 80 {
        return Err(error("INPUT", "Fuseau horaire invalide."));
    }
    state.query("home", json!({ "homeEndUserIntegration":"INTEGRATION_DESKTOP", "timeZone":timezone, "sp_t":"", "facet":"", "sectionItemsLimit":12, "includeEpisodeContentRatingsV2":true })).await
}

#[tauri::command]
async fn search_catalog(state: State<'_, Arc<Backend>>, query: String) -> Result<Value> {
    let query = query.trim();
    if query.is_empty() || query.chars().count() > 200 {
        return Err(error(
            "INPUT",
            "Saisissez une recherche de 1 à 200 caractères.",
        ));
    }
    state.query("searchDesktop", json!({ "searchTerm":query, "offset":0, "limit":20, "numberOfTopResults":5, "includeAuthors":true, "includeAudiobooks":true, "includeAlbumPreReleases":false, "includeEpisodeContentRatingsV2":true })).await
}

#[tauri::command]
async fn get_library(state: State<'_, Arc<Backend>>, offset: Option<usize>) -> Result<Value> {
    let session = state.session().await?;
    let offset = offset.unwrap_or(0);
    if offset > 100_000 {
        return Err(error("INPUT", "Page de bibliothèque invalide."));
    }
    let bytes = tokio::time::timeout(
        Duration::from_secs(15),
        session.spclient().get_rootlist(offset, Some(40)),
    )
    .await
    .map_err(network_error)?
    .map_err(network_error)?;
    let root =
        librespot_protocol::playlist4_external::SelectedListContent::parse_from_bytes(&bytes)
            .map_err(network_error)?;
    let mut page = library_page(&root, offset, &session.username());
    let uris: Vec<_> = page["items"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|i| i["uri"].as_str())
        .collect();
    if !uris.is_empty() {
        // This operation supplies artwork only; names come from decorated rootlist metadata.
        if let Ok(lookup) = state
            .query("lookupChildEntities", json!({"uris":uris}))
            .await
        {
            if let (Some(items), Some(entities)) = (
                page["items"].as_array_mut(),
                lookup["data"]["lookupEntities"].as_array(),
            ) {
                for item in items {
                    if let Some(entity) =
                        entities.iter().find(|entity| entity["uri"] == item["uri"])
                    {
                        item["images"] = entity["visualIdentityTrait"]["squareCoverImage"]["image"]
                            ["data"]
                            .clone();
                    }
                }
            }
        }
    }
    Ok(page)
}

fn library_page(
    root: &librespot_protocol::playlist4_external::SelectedListContent,
    offset: usize,
    username: &str,
) -> Value {
    let contents = root.contents.as_ref();
    let items: Vec<Value> = contents
        .into_iter()
        .flat_map(|c| {
            c.items.iter().enumerate().filter_map(|(index, item)| {
                let SpotifyUri::Playlist { id, .. } = SpotifyUri::from_uri(item.uri()).ok()? else {
                    return None;
                };
                let uri = SpotifyUri::Playlist { id, user: None }.to_uri().ok()?;
                let meta = c.meta_items.get(index);
                let name = meta
                    .and_then(|m| m.attributes.as_ref())
                    .map(|a| a.name())
                    .filter(|n| !n.is_empty())
                    .unwrap_or("Playlist");
                let owner = meta.map(|m| m.owner_username()).unwrap_or("");
                let own = !username.is_empty() && owner == username;
                let editable = meta.and_then(|m| m.capabilities.as_ref()).and_then(|c| c.can_edit_items).unwrap_or(own);
                Some(json!({"uri":uri,"name":name,"ownerV2":{"data":{"name":owner}},"canEditItems":editable}))
            })
        })
        .collect();
    let consumed = contents.map_or(0, |c| c.items.len());
    let total = root.length().max(0) as usize;
    let next = offset.saturating_add(consumed);
    json!({"items":items,"total":total,"offset":offset,"nextOffset":if consumed > 0 && next < total {Some(next)} else {None}})
}

fn track_view(track: Track) -> TrackView {
    TrackView {
        uri: track.id.to_uri().unwrap_or_default(),
        name: track.name,
        artist: track
            .artists
            .iter()
            .map(|a| a.name.as_str())
            .collect::<Vec<_>>()
            .join(", "),
        album: track.album.name,
        image: track
            .album
            .covers
            .first()
            .map(|i| format!("https://i.scdn.co/image/{}", i.id))
            .unwrap_or_default(),
        duration_ms: track.duration.max(0) as u32,
    }
}

#[tauri::command]
async fn get_saved_status(state: State<'_, Arc<Backend>>, uris: Vec<String>) -> Result<Vec<bool>> {
    let _slot = state.requests.acquire().await.map_err(network_error)?;
    state.check_library_cooldown().await?;
    let session = state.session().await?;
    state
        .library_result(
            LibraryApi::new(&session, &state.client)
                .contains(&uris)
                .await,
        )
        .await
}

#[tauri::command]
async fn set_saved_track(state: State<'_, Arc<Backend>>, uri: String, saved: bool) -> Result<()> {
    let _write = state.writes.lock().await;
    let _slot = state.requests.acquire().await.map_err(network_error)?;
    state.check_library_cooldown().await?;
    let session = state.session().await?;
    state
        .library_result(
            LibraryApi::new(&session, &state.client)
                .set_saved(&uri, saved)
                .await,
        )
        .await?;
    state.cache.lock().await.clear();
    Ok(())
}

#[tauri::command]
async fn get_liked_tracks(
    state: State<'_, Arc<Backend>>,
    token: Option<String>,
) -> Result<LikedPage> {
    let _slot = state.requests.acquire().await.map_err(network_error)?;
    state.check_library_cooldown().await?;
    let session = state.session().await?;
    let (uris, next_token) = state
        .library_result(
            LibraryApi::new(&session, &state.client)
                .liked_page(token.as_deref().unwrap_or(""))
                .await,
        )
        .await?;
    drop(_slot);
    let tracks = state.track_views(&session, uris).await?;
    Ok(LikedPage { tracks, next_token })
}

#[tauri::command]
async fn get_writable_playlists(state: State<'_, Arc<Backend>>) -> Result<Value> {
    let _slot = state.requests.acquire().await.map_err(network_error)?;
    let session = state.session().await?;
    let mut items = Vec::new();
    let mut offset = 0;
    // Explicitly opening the picker fetches lightweight playlist names, not track contents.
    for _ in 0..20 {
        let bytes = tokio::time::timeout(
            Duration::from_secs(15),
            session.spclient().get_rootlist(offset, Some(1000)),
        )
        .await
        .map_err(network_error)?
        .map_err(network_error)?;
        let root =
            librespot_protocol::playlist4_external::SelectedListContent::parse_from_bytes(&bytes)
                .map_err(network_error)?;
        let page = library_page(&root, offset, &session.username());
        if let Some(page_items) = page["items"].as_array() {
            items.extend(
                page_items
                    .iter()
                    .filter(|item| item["canEditItems"] == true)
                    .cloned(),
            );
        }
        let Some(next) = page["nextOffset"].as_u64() else {
            return Ok(json!({"items":items}));
        };
        offset = next as usize;
    }
    Err(error(
        "LIBRARY_TOO_LARGE",
        "Cette bibliothèque ne peut pas être chargée entièrement pour le moment.",
    ))
}

#[tauri::command]
async fn edit_playlist(
    state: State<'_, Arc<Backend>>,
    uri: String,
    revision: Option<String>,
    edit: PlaylistEdit,
) -> Result<()> {
    let _write = state.writes.lock().await;
    let _slot = state.requests.acquire().await.map_err(network_error)?;
    state.check_library_cooldown().await?;
    let session = state.session().await?;
    state
        .library_result(
            LibraryApi::new(&session, &state.client)
                .edit_playlist(&uri, revision.as_deref(), &edit)
                .await,
        )
        .await?;
    state.cache.lock().await.clear();
    Ok(())
}

#[tauri::command]
async fn create_playlist(
    state: State<'_, Arc<Backend>>,
    name: String,
    description: String,
) -> Result<String> {
    let _write = state.writes.lock().await;
    let _slot = state.requests.acquire().await.map_err(network_error)?;
    state.check_library_cooldown().await?;
    let session = state.session().await?;
    let uri = state
        .library_result(
            LibraryApi::new(&session, &state.client)
                .create_playlist(&name, &description)
                .await,
        )
        .await?;
    state.cache.lock().await.clear();
    Ok(uri)
}

#[tauri::command]
async fn open_collection(
    state: State<'_, Arc<Backend>>,
    uri: String,
    offset: usize,
) -> Result<Collection> {
    let session = state.session().await?;
    let id = SpotifyUri::from_uri(&uri).map_err(|_| error("INPUT", "Lien Spotify invalide."))?;
    if offset > 100_000 {
        return Err(error("INPUT", "Page de playlist invalide."));
    }
    let (name, description, revision, can_edit_metadata, can_edit_items, total, uris) = match id {
        SpotifyUri::Album { .. } => {
            let item = tokio::time::timeout(Duration::from_secs(15), Album::get(&session, &id))
                .await
                .map_err(network_error)?
                .map_err(network_error)?;
            let uris: Vec<_> = item.tracks().filter_map(|id| id.to_uri().ok()).collect();
            let total = uris.len();
            (
                item.name.clone(),
                String::new(),
                None,
                false,
                false,
                total,
                uris.into_iter().skip(offset).take(40).collect(),
            )
        }
        SpotifyUri::Playlist { .. } => {
            let _slot = state.requests.acquire().await.map_err(network_error)?;
            state.check_library_cooldown().await?;
            let item = state
                .library_result(
                    LibraryApi::new(&session, &state.client)
                        .playlist_page(&uri, offset, 40)
                        .await,
                )
                .await?;
            let (metadata, items) = playlist_permissions(&item, &session.username());
            let attributes = item.attributes.get_or_default();
            let uris = item
                .contents
                .as_ref()
                .map(|c| c.items.iter().map(|i| i.uri().to_owned()).collect())
                .unwrap_or_default();
            (
                attributes.name().to_owned(),
                attributes.description().to_owned(),
                Some(revision_hex(item.revision())),
                metadata,
                items,
                item.length().max(0) as usize,
                uris,
            )
        }
        _ => {
            return Err(error(
                "UNAVAILABLE",
                "Cette page n'est pas encore disponible dans ce prototype.",
            ));
        }
    };
    let tracks = state
        .track_views(&session, uris)
        .await?
        .into_iter()
        .enumerate()
        .map(|(index, track)| CollectionTrack {
            track,
            position: offset + index,
        })
        .collect();
    Ok(Collection {
        name,
        description,
        revision,
        can_edit_metadata,
        can_edit_items,
        tracks,
        total,
        offset,
    })
}

#[tauri::command]
async fn get_context_page(
    state: State<'_, Arc<Backend>>,
    uri: String,
    cursor: Option<String>,
    revision: Option<String>,
) -> Result<ContextPage> {
    let _slot = state.requests.acquire().await.map_err(network_error)?;
    state.check_library_cooldown().await?;
    let session = state.session().await?;
    let cursor = cursor.unwrap_or_default();
    if uri == "spotify:collection:tracks" {
        let (uris, next) = state
            .library_result(
                LibraryApi::new(&session, &state.client)
                    .liked_uris_page(&cursor, 1000)
                    .await,
            )
            .await?;
        return Ok(ContextPage {
            uris,
            next,
            revision: None,
        });
    }
    let offset = if cursor.is_empty() {
        0
    } else {
        cursor
            .parse::<usize>()
            .map_err(|_| error("INPUT", "Page de lecture invalide."))?
    };
    if offset > 100_000 {
        return Err(error("INPUT", "Page de lecture invalide."));
    }
    let id = SpotifyUri::from_uri(&uri).map_err(|_| error("INPUT", "Lien Spotify invalide."))?;
    let (uris, total, current_revision) = match id {
        SpotifyUri::Playlist { .. } => {
            let page = state
                .library_result(
                    LibraryApi::new(&session, &state.client)
                        .playlist_page(&uri, offset, 1000)
                        .await,
                )
                .await?;
            let current = revision_hex(page.revision());
            if revision
                .as_ref()
                .is_some_and(|expected| *expected != current)
            {
                return Err(LibraryError::Conflict.into());
            }
            let uris: Vec<_> = page
                .contents
                .as_ref()
                .into_iter()
                .flat_map(|contents| contents.items.iter().map(|item| item.uri().to_owned()))
                .collect();
            (uris, page.length().max(0) as usize, Some(current))
        }
        SpotifyUri::Album { .. } => {
            let _metadata = state.metadata.acquire().await.map_err(network_error)?;
            let album = tokio::time::timeout(Duration::from_secs(15), Album::get(&session, &id))
                .await
                .map_err(network_error)?
                .map_err(network_error)?;
            let all: Vec<_> = album.tracks().filter_map(|id| id.to_uri().ok()).collect();
            let total = all.len();
            (
                all.into_iter().skip(offset).take(1000).collect(),
                total,
                None,
            )
        }
        _ => {
            return Err(error(
                "INPUT",
                "Ce contexte de lecture n’est pas disponible.",
            ));
        }
    };
    let consumed = uris.len();
    if consumed == 0 && offset < total {
        return Err(LibraryError::Protocol.into());
    }
    let next = (consumed > 0 && offset + consumed < total).then(|| (offset + consumed).to_string());
    Ok(ContextPage {
        uris,
        next,
        revision: current_revision,
    })
}

#[tauri::command]
async fn get_track_details(
    state: State<'_, Arc<Backend>>,
    uris: Vec<String>,
) -> Result<Vec<TrackView>> {
    if uris.is_empty()
        || uris.len() > 40
        || uris.iter().any(|uri| library_api::track_uri(uri).is_err())
    {
        return Err(error("INPUT", "La liste de titres n’est pas valide."));
    }
    let session = state.session().await?;
    state.track_views(&session, uris).await
}

fn audio_preferences_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf> {
    app.path()
        .app_local_data_dir()
        .map(|p| p.join("audio-preferences.json"))
        .map_err(|_| error("STORAGE", "Les préférences audio sont indisponibles."))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioSettings {
    quality: AudioQuality,
    active_quality: Option<AudioQuality>,
    restart_required: bool,
}

async fn audio_settings(state: &Backend, preferences: AudioPreferences) -> AudioSettings {
    let native = state.native.lock().await;
    let active_quality = native.as_ref().map(|n| n.quality);
    AudioSettings {
        quality: preferences.quality,
        active_quality,
        restart_required: active_quality.is_some_and(|q| q != preferences.quality),
    }
}

#[tauri::command]
async fn get_audio_settings(
    app: tauri::AppHandle,
    state: State<'_, Arc<Backend>>,
) -> Result<AudioSettings> {
    let _connection = state.connection.lock().await;
    let preferences = AudioPreferences::read(&audio_preferences_path(&app)?)
        .map_err(|_| error("STORAGE", "Impossible de lire les préférences audio."))?;
    Ok(audio_settings(&state, preferences).await)
}

#[tauri::command]
async fn set_audio_quality(
    app: tauri::AppHandle,
    state: State<'_, Arc<Backend>>,
    quality: AudioQuality,
) -> Result<AudioSettings> {
    let _connection = state.connection.lock().await;
    let preferences = AudioPreferences { quality };
    preferences
        .write(&audio_preferences_path(&app)?)
        .map_err(|_| error("STORAGE", "Impossible d’enregistrer la qualité audio."))?;
    Ok(audio_settings(&state, preferences).await)
}

#[tauri::command]
async fn get_connect_state(state: State<'_, Arc<Backend>>) -> Result<ConnectView> {
    let native = state.native.lock().await;
    let runtime = native
        .as_ref()
        .map(|n| n.connect.clone())
        .ok_or_else(|| error("AUTH_REQUIRED", "Connectez-vous à Spotify."))?;
    drop(native);
    Ok(runtime.view().await)
}
#[tauri::command]
async fn connect_command(
    state: State<'_, Arc<Backend>>,
    action: ConnectAction,
    device_id: Option<String>,
) -> Result<()> {
    let native = state.native.lock().await;
    let runtime = native
        .as_ref()
        .map(|n| n.connect.clone())
        .ok_or_else(|| error("AUTH_REQUIRED", "Connectez-vous à Spotify."))?;
    drop(native);
    runtime
        .execute(action, device_id.as_deref())
        .await
        .map_err(Into::into)
}

pub fn run() {
    tauri::Builder::default()
        .manage(Arc::new(Backend::new()))
        .invoke_handler(tauri::generate_handler![
            get_status,
            get_audio_settings,
            set_audio_quality,
            connect_spotify,
            disconnect_spotify,
            get_home,
            search_catalog,
            get_library,
            get_saved_status,
            set_saved_track,
            get_liked_tracks,
            get_writable_playlists,
            edit_playlist,
            create_playlist,
            open_collection,
            get_context_page,
            get_track_details,
            get_connect_state,
            connect_command
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let shared = window.state::<Arc<Backend>>().inner().clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(native) = shared.native.lock().await.take() {
                        native.connect.shutdown();
                        native.player.stop();
                        native.session.shutdown();
                    }
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("Spotisloth could not start");
}

#[cfg(test)]
mod tests {
    use super::*;
    use librespot_protocol::playlist4_external::{
        Item, ListAttributes, ListItems, MetaItem, SelectedListContent,
    };

    #[test]
    fn rootlist_keeps_names_aligned_when_folders_are_filtered() {
        let mut root = SelectedListContent::new();
        root.set_length(8);
        let mut contents = ListItems::new();
        contents.set_pos(0);
        contents.set_truncated(true);
        for (uri, name) in [
            ("spotify:start-group:folder", "Dossier"),
            (
                "spotify:user:owner:playlist:37i9dQZF1DXcBWIGoYBM5M",
                "Ma playlist",
            ),
        ] {
            let mut item = Item::new();
            item.set_uri(uri.into());
            contents.items.push(item);
            let mut meta = MetaItem::new();
            let mut attributes = ListAttributes::new();
            attributes.set_name(name.into());
            meta.attributes = Some(attributes).into();
            contents.meta_items.push(meta);
        }
        root.contents = Some(contents).into();
        let page = library_page(&root, 0, "owner");
        assert_eq!(page["items"].as_array().unwrap().len(), 1);
        assert_eq!(page["items"][0]["name"], "Ma playlist");
        assert_eq!(
            page["items"][0]["uri"],
            "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M"
        );
        assert_eq!(page["nextOffset"], 2);
    }

    #[test]
    fn empty_rootlist_does_not_repeat_the_same_page() {
        let page = library_page(&SelectedListContent::new(), 40, "owner");
        assert!(page["nextOffset"].is_null());
        assert!(page["items"].as_array().unwrap().is_empty());
    }

    #[test]
    fn playlist_picker_honors_an_explicit_denial_for_the_owner() {
        let mut root = SelectedListContent::new();
        let mut contents = ListItems::new();
        let mut item = Item::new();
        item.set_uri("spotify:playlist:37i9dQZF1DXcBWIGoYBM5M".into());
        contents.items.push(item);
        let mut meta = MetaItem::new();
        meta.set_owner_username("owner".into());
        contents.meta_items.push(meta);
        root.contents = Some(contents).into();
        assert_eq!(
            library_page(&root, 0, "owner")["items"][0]["canEditItems"],
            true
        );
        let mut caps = librespot_protocol::playlist_permission::Capabilities::new();
        caps.set_can_edit_items(false);
        root.contents.as_mut().unwrap().meta_items[0].capabilities = Some(caps).into();
        assert_eq!(
            library_page(&root, 0, "owner")["items"][0]["canEditItems"],
            false
        );
    }
}
