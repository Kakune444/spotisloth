import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  collectCards,
  escapeHtml as esc,
  formatTime,
  homeSections,
  imageUrl,
  searchSections,
  type Card,
  type Section,
} from "./lib/catalog.ts";
import "./style.css";
import { SavedTracks } from "./lib/saved.ts";
import { PlaylistDialogs } from "./ui/playlists.ts";
import { PlaybackQueue } from "./lib/queue.ts";
import {
  commandDevice,
  emptyConnectState,
  nextRepeat,
  queueAction,
  type ConnectAction,
  type ConnectState,
} from "./lib/connect.ts";
import { DevicePicker } from "./ui/devices.ts";
import { QueueView } from "./ui/queue.ts";
import { AudioSettingsView } from "./ui/settings.ts";
import { JamView } from "./ui/jam.ts";

type Status = {
  connected: boolean;
  nativeReady: boolean;
};
type UserProfile = { displayName: string; image: string };
let accountProfile: UserProfile | null = null;
type NativeTrack = {
  uri: string;
  name: string;
  artist: string;
  album: string;
  image: string;
  durationMs: number;
};
type Playback = {
  selection: string;
  track: NativeTrack | null;
  playing: boolean;
  loading: boolean;
  positionMs: number;
  unavailable: boolean;
  ended: boolean;
};
type Collection = {
  name: string;
  description: string;
  revision: string | null;
  canEditMetadata: boolean;
  canEditItems: boolean;
  tracks: (NativeTrack & { position: number })[];
  total: number;
  offset: number;
};
type AppError = { code?: string; message?: string; retryAfterSeconds?: number };
let status: Status = { connected: false, nativeReady: false };
let playback: Playback = {
  selection: "",
  track: null,
  playing: false,
  loading: false,
  positionMs: 0,
  ended: false,
  unavailable: false,
};
let library: Card[] = [];
let libraryNext: number | null = null;
let libraryFilter = "all";
let libraryLoading = false;
const queue = new PlaybackQueue<Card>();
let connectState = emptyConnectState();
let connectPending = false;
let connectEpoch = 0;
const connectQueueKeys = new Map<number, string>();
const connectQueued = new Set<number>();
const connectMetadata = new Map<string, NativeTrack>();
const metadataPending = new Set<string>();
let queueDragSnapshot: {
  key: string;
  revision: string;
  device: string | null;
} | null = null;
let queuePreparing = false;
let queueDragId: number | null = null;
let collectionTracks: Card[] = [];
let sections: Section[] = [];
let cards = new Map<string, Card>();
let requestId = 0;
let searchTimer: ReturnType<typeof setTimeout>;
let toastTimer: ReturnType<typeof setTimeout>;
let collectionUri = "";
let collectionOffset = 0;
let collectionTotal = 0;
let lastPlaybackUpdate = performance.now();
const savedTracks = new SavedTracks();
let activeView = "home";
const queueView = new QueueView(queue, {
  active: () => activeView === "queue",
  cover,
  save: savedButton,
  menu: menuButton,
  queued: (id) => connectQueued.has(id),
  rendered: (uris) => {
    updateSavedButtons();
    void refreshSaved(uris);
  },
  error: showError,
});
let likedTokens = [""];
let likedIndex = 0;
let likedOffsets = [0];
let selectedCollection: { card: Card; data: Collection } | null = null;
let playlistPending = false;
let drag: {
  uri: string;
  playlist: string;
  revision: string;
  position: number;
} | null = null;
const playlists = new PlaylistDialogs({
  changed: (uri) => {
    void loadLibrary();
    if (activeView === "collection" && selectedCollection?.card.uri === uri) {
      const { card } = selectedCollection;
      void openCollection(card, collectionOffset);
    }
  },
  created: (card) => {
    void loadLibrary();
    void openCollection(card);
  },
  error: showError,
  pending: (value) => {
    playlistPending = value;
    document
      .querySelectorAll<HTMLButtonElement>(
        "[data-menu], #edit-playlist, #create-playlist",
      )
      .forEach((button) => {
        button.disabled = value || !status.nativeReady;
      });
  },
});
const likedCard: Card = {
  uri: "spotify:collection:tracks",
  name: "Titres likés",
  subtitle: "Playlist",
  image: "",
  kind: "liked",
  durationMs: 0,
};

const paths: Record<string, string> = {
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 22v-2a8 8 0 0 1 16 0v2"/>',
  saved: '<circle cx="12" cy="12" r="10"/><path d="m7 12 3 3 7-7"/>',
  more: '<circle cx="4" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="20" cy="12" r="1"/>',
  add: '<circle cx="12" cy="12" r="10"/><path d="M7 12h10M12 7v10"/>',
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1Z"/>',
  search: '<circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 5 5"/>',
  library: '<path d="M4 3v18M9 3v18M14 4l5-1 3 17-5 1Z"/>',
  play: '<path d="m8 4 13 8-13 8Z"/>',
  pause: '<path d="M7 4h3v16H7zM14 4h3v16h-3z"/>',
  previous: '<path d="M5 4v16m14-16L7 12l12 8Z"/>',
  next: '<path d="M19 4v16M5 4l12 8-12 8Z"/>',
  volume:
    '<path d="M3 9h4l5-4v14l-5-4H3Zm13-2a7 7 0 0 1 0 10m3-13a11 11 0 0 1 0 16"/>',
  computer:
    '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4"/>',
  phone:
    '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M10 18h4"/>',
  tablet:
    '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M11 18h2"/>',
  speaker:
    '<rect x="5" y="2" width="14" height="20" rx="2"/><circle cx="12" cy="14" r="4"/><circle cx="12" cy="6" r="1"/>',
  tv: '<rect x="2" y="4" width="20" height="14" rx="2"/><path d="M8 22h8m-4-4v4"/>',
  queue: '<path d="M3 5h18M3 11h12M3 17h8m6-2 5 3-5 3Z"/>',
  music:
    '<path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="5.5" cy="18.5" rx="3.5" ry="2.5"/><ellipse cx="16.5" cy="16.5" rx="3.5" ry="2.5"/>',
  heart:
    '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  shuffle:
    '<path d="M3 6h3c5 0 7 12 12 12h3m-4-4 4 4-4 4M3 18h3c2 0 4-3 5-6m3-4c1-1 3-2 4-2h3m-4-4 4 4-4 4"/>',
  repeat:
    '<path d="m17 2 4 4-4 4M3 10V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4m14 0v2a2 2 0 0 1-2 2H3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
};
const icon = (name: string, cls = "") =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] ?? paths.music}</svg>`;
const byId = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

byId("app").innerHTML = `
  <header class="topbar">
    <a class="brand" href="#" aria-label="Spotisloth, accueil">${icon("music")}<strong>Spotisloth</strong></a>
    <div class="top-center"><button class="round home-button" id="home" aria-label="Accueil">${icon("home")}</button>
      <label class="search-box">${icon("search")}<input id="search" type="search" maxlength="200" placeholder="Que souhaitez-vous écouter ?" aria-label="Rechercher dans Spotify" autocomplete="off" spellcheck="false"/><span class="search-hint">Ctrl K</span></label>
    </div>
    <div id="account"><button class="pill white" id="connect">Se connecter</button></div>
  </header>
  <div class="workspace">
    <aside class="library pane" aria-label="Bibliothèque">
      <div class="library-heading">${icon("library")}<h2>Bibliothèque</h2><button id="create-playlist" class="round" title="Créer une playlist" aria-label="Créer une playlist" disabled>+</button></div>
      <div class="chips library-filters"><button class="chip active" data-library="all">Tout</button><button class="chip" data-library="playlist">Playlists</button><button class="chip" data-library="album">Albums</button><button class="chip" data-library="artist">Artistes</button></div>
      <div id="library-list" class="library-list"><div class="library-empty"><strong>Votre bibliothèque vous attend</strong><p>Connectez-vous pour retrouver votre musique.</p></div></div>
    </aside>
    <main class="content pane" id="content" tabindex="-1" aria-label="Contenu Spotify"><div id="main-content"></div></main>
    <aside class="now-playing pane" aria-label="En cours de lecture"><h2 id="right-panel-heading">En cours de lecture</h2><section id="jam-panel" aria-label="Jam" hidden></section><div id="now-playing"><div class="now-empty">${icon("music")}<p>Choisissez un titre<br/>pour commencer à écouter.</p></div></div></aside>
  </div>
  <footer class="player" aria-label="Lecteur audio">
    <div id="track-info" class="track-info"></div>
    <div class="transport"><div class="transport-buttons">
      <button id="shuffle" class="icon-button mode-button" aria-label="Activer la lecture aléatoire" aria-pressed="false" disabled>${icon("shuffle")}</button>
      <button id="previous" class="icon-button" aria-label="Titre précédent" disabled>${icon("previous")}</button>
      <button id="toggle-play" class="play-button" aria-label="Lire" disabled>${icon("play")}</button>
      <button id="next" class="icon-button" aria-label="Titre suivant" disabled>${icon("next")}</button>
      <button id="repeat" class="icon-button mode-button" aria-label="Activer la répétition" aria-pressed="false" disabled>${icon("repeat")}</button>
    </div><div class="timeline"><span id="position">0:00</span><input id="seek" type="range" min="0" max="100" value="0" aria-label="Position de lecture" disabled/><span id="duration">0:00</span></div></div>
    <div class="player-options"><button id="show-devices" class="icon-button" aria-label="Se connecter à un appareil" title="Se connecter à un appareil" disabled>${icon("computer")}</button><button id="show-queue" class="icon-button" aria-label="File d’attente">${icon("queue")}</button>${icon("volume")}<input id="volume" type="range" min="0" max="100" value="50" aria-label="Volume" disabled/></div>
  </footer>
  <button id="connect-banner" class="connect-banner" hidden></button>
  <div id="toast" role="status" aria-live="polite" hidden></div>`;

const devicePicker = new DevicePicker(
  byId<HTMLButtonElement>("show-devices"),
  connectState,
  icon,
  (id) => {
    void sendConnect({ kind: "transfer", deviceId: id });
  },
  (create) => void jamView.show(create),
);
const jamView = new JamView(
  byId("jam-panel"),
  byId("right-panel-heading"),
  (active) => devicePicker.setJam(active),
  showError,
);
const audioSettings = new AudioSettingsView(connectState, showError);
byId("connect-banner").addEventListener("click", () =>
  byId("show-devices").click(),
);
function showError(value: unknown): void {
  const err = value as AppError;
  const message = err?.message || "Une erreur est survenue. Réessayez.";
  const toast = byId("toast");
  toast.textContent = `${message}${err.retryAfterSeconds ? ` (${err.retryAfterSeconds} s)` : ""}`;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 6500);
  if (err.code === "AUTH_REQUIRED") {
    jamView.setReady(false);
    accountProfile = null;
    status.connected = false;
    status.nativeReady = false;
    renderAccount();
  }
}

function cover(card: Pick<Card, "image" | "name" | "kind">, cls = ""): string {
  if (card.kind === "liked")
    return `<span class="cover liked-cover ${cls}">${icon("heart")}</span>`;
  const image = imageUrl(card.image);
  return image
    ? `<img class="cover ${cls} ${card.kind === "artist" ? "artist-cover" : ""}" src="${esc(image)}" alt="" draggable="false" loading="lazy" decoding="async"/>`
    : `<span class="cover placeholder ${cls}">${icon("music")}</span>`;
}

function renderAccount(): void {
  const name = accountProfile?.displayName || "Compte Spotify";
  const photo = imageUrl(accountProfile?.image);
  const initial = accountProfile?.displayName
    ? Array.from(accountProfile.displayName)[0].toUpperCase()
    : "";
  const open = document.querySelector(".profile")?.hasAttribute("open");
  byId("account").innerHTML = status.connected
    ? `<details class="profile" ${open ? "open" : ""}><summary title="${esc(name)}" aria-label="${esc(name)}"><span>${initial ? esc(initial) : icon("user")}</span>${photo ? `<img src="${esc(photo)}" alt="" referrerpolicy="no-referrer"/>` : ""}</summary><div class="profile-menu"><div class="profile-identity">${esc(name)}</div><button id="show-settings">Préférences</button><button id="disconnect">Se déconnecter</button></div></details>`
    : '<button class="pill white" id="connect">Se connecter</button>';
  document
    .querySelector<HTMLImageElement>(".profile summary img")
    ?.addEventListener(
      "error",
      (event) => (event.currentTarget as HTMLImageElement).remove(),
      { once: true },
    );
  byId<HTMLButtonElement>("create-playlist").disabled =
    !status.nativeReady || playlistPending;
}

function welcome(): void {
  byId("main-content").innerHTML =
    `<div class="welcome"><div class="welcome-symbol">${icon("music")}</div><p class="eyebrow">VOTRE MUSIQUE</p><h1>Tout commence<br/>par un titre.</h1><p>Retrouvez vos albums, vos artistes et vos playlists.</p><button class="pill green" id="welcome-connect">Se connecter à Spotify</button></div>`;
}

function renderLibrary(): void {
  const items = library.filter(
    (card) => libraryFilter === "all" || card.kind === libraryFilter,
  );
  byId("library-list").innerHTML = items.length
    ? items
        .map(
          (card) =>
            `<button class="library-item" data-uri="${esc(card.uri)}">${cover(card)}<span><strong>${esc(card.name)}</strong><small>${esc(card.subtitle)}</small></span></button>`,
        )
        .join("")
    : `<div class="library-empty"><strong>${status.connected ? "Aucun élément affiché" : "Votre bibliothèque vous attend"}</strong><p>${status.connected ? "Aucun élément disponible pour ce filtre." : "Connectez-vous pour retrouver votre musique."}</p></div>`;
  if (libraryNext !== null)
    byId("library-list").insertAdjacentHTML(
      "beforeend",
      `<button class="pill" id="library-more" ${libraryLoading ? "disabled" : ""}>Afficher plus</button>`,
    );
  if (
    status.connected &&
    (libraryFilter === "all" || libraryFilter === "playlist")
  )
    byId("library-list").insertAdjacentHTML(
      "afterbegin",
      `<button class="library-item" id="liked-tracks">${cover(likedCard)}<span><strong>Titres likés</strong><small>Playlist</small></span></button>`,
    );
}

function savedButton(uri: string): string {
  if (!uri.startsWith("spotify:track:")) return "<span></span>";
  return `<button class="save-button" data-save="${esc(uri)}" aria-label="Vérification des favoris" disabled>${icon("add")}</button>`;
}
function updateSavedButtons(): void {
  document
    .querySelectorAll<HTMLButtonElement>("[data-save]")
    .forEach((button) => {
      const uri = button.dataset.save!;
      const value = savedTracks.get(uri);
      const label = value
        ? "Retirer des Titres likés"
        : "Sauvegarder dans les Titres likés";
      button.disabled =
        !status.nativeReady || value === undefined || savedTracks.busy(uri);
      button.classList.toggle("is-saved", !!value);
      button.setAttribute("aria-pressed", String(!!value));
      button.setAttribute(
        "aria-label",
        value === undefined ? "Vérification des favoris" : label,
      );
      button.title = label;
      button.innerHTML = icon(value ? "saved" : "add");
    });
}
async function refreshSaved(uris?: string[]): Promise<void> {
  if (!status.nativeReady) return;
  const requested = [
    ...new Set(
      uris ??
        [...cards.values()]
          .filter((c) => c.kind === "track")
          .map((c) => c.uri)
          .concat(playback.track ? [playback.track.uri] : []),
    ),
  ].filter((uri) => /^spotify:track:[A-Za-z0-9]{22}$/.test(uri));
  for (let offset = 0; offset < requested.length; offset += 50) {
    const batch = requested.slice(offset, offset + 50);
    const snapshot = savedTracks.snapshot(batch);
    try {
      const values = await invoke<boolean[]>("get_saved_status", {
        uris: batch,
      });
      savedTracks.accept(batch, values, snapshot);
      updateSavedButtons();
    } catch (err) {
      showError(err);
      return;
    }
  }
}
async function toggleSaved(uri: string): Promise<void> {
  const current = savedTracks.get(uri);
  if (current === undefined || !status.nativeReady) return;
  const operation = savedTracks.begin(uri);
  if (operation === null) return;
  updateSavedButtons();
  try {
    await invoke("set_saved_track", { uri, saved: !current });
    savedTracks.finish(uri, operation, !current);
    if (activeView === "liked") {
      likedTokens = [""];
      void openLiked();
    }
  } catch (err) {
    savedTracks.finish(uri, operation);
    showError(err);
    void refreshSaved([uri]);
  } finally {
    updateSavedButtons();
  }
}

function remember(items: Card[]): void {
  items.forEach((card) => cards.set(card.uri, card));
}
function cardGrid(items: Card[]): string {
  remember(items);
  return `<div class="card-grid">${items
    .map((card) => {
      const content = `<span class="artwork">${cover(card)}<span class="card-play">${icon("play")}</span></span><strong>${esc(card.name)}</strong><span class="card-subtitle">${esc(card.subtitle)}</span>`;
      return card.kind === "track"
        ? `<article class="music-card track-card"><button class="card-main" data-uri="${esc(card.uri)}">${content}</button>${savedButton(card.uri)}${menuButton(card.uri)}</article>`
        : `<button class="music-card" data-uri="${esc(card.uri)}">${content}</button>`;
    })
    .join("")}</div>`;
}
function renderSections(items: Section[], title?: string): void {
  cards.clear();
  remember(library);
  byId("main-content").innerHTML =
    `${title ? `<h1 class="page-title">${esc(title)}</h1>` : '<div class="chips content-chips"><span class="chip active">Tout</span><span class="chip">Musique</span><span class="chip">Podcasts</span></div>'}${items.map((section) => `<section class="music-section"><h2>${esc(section.name)}</h2>${cardGrid(section.items)}</section>`).join("") || '<div class="empty"><h1>Aucun résultat</h1><p>Essayez une autre recherche.</p></div>'}`;
  updateSavedButtons();
  void refreshSaved();
}

async function loadHome(): Promise<void> {
  const id = ++requestId;
  if (!status.connected) {
    welcome();
    return;
  }
  byId("main-content").innerHTML =
    '<div class="loading" role="status">Chargement de votre musique…</div>';
  try {
    const result = await invoke("get_home", {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    if (id !== requestId) return;
    sections = homeSections(result);
    activeView = "home";
    renderSections(sections);
  } catch (err) {
    if (id === requestId) {
      byId("main-content").innerHTML =
        '<div class="empty"><h1>Impossible de charger l’accueil</h1><button class="pill white" id="retry-home">Réessayer</button></div>';
      showError(err);
    }
  }
}

async function search(query: string): Promise<void> {
  const id = ++requestId;
  if (!status.connected) {
    welcome();
    return;
  }
  byId("main-content").innerHTML =
    '<div class="loading" role="status">Recherche…</div>';
  try {
    const result = await invoke("search_catalog", { query });
    if (id !== requestId) return;
    const groups = searchSections(result);
    activeView = "search";
    renderSections(groups, `Résultats pour « ${query} »`);
  } catch (err) {
    if (id === requestId) {
      byId("main-content").innerHTML =
        '<div class="empty"><h1>Recherche indisponible</h1><p>Réessayez dans un instant.</p></div>';
      showError(err);
    }
  }
}

async function loadLibrary(offset = 0): Promise<void> {
  const epoch = connectEpoch;
  if (libraryLoading) return;
  libraryLoading = true;
  try {
    const result = await invoke<{
      items: unknown[];
      nextOffset: number | null;
    }>("get_library", { offset });
    if (epoch !== connectEpoch || !status.connected) return;
    const incoming = collectCards(result.items, 40);
    library = [
      ...new Map(
        [...(offset ? library : []), ...incoming].map((card) => [
          card.uri,
          card,
        ]),
      ).values(),
    ];
    libraryNext = result.nextOffset;
    renderLibrary();
    void resolveLibraryOwners(incoming, epoch);
  } catch (err) {
    if ((err as AppError)?.code !== "AUTH_REQUIRED") showError(err);
  } finally {
    libraryLoading = false;
    renderLibrary();
  }
}

async function resolveLibraryOwners(
  items: Card[],
  epoch: number,
): Promise<void> {
  const usernames = [
    ...new Set(items.flatMap((card) => (card.ownerId ? [card.ownerId] : []))),
  ];
  if (!usernames.length) return;
  try {
    const profiles = await invoke<
      { id: string; profile: UserProfile | null }[]
    >("get_user_profiles", { usernames });
    if (epoch !== connectEpoch || !status.connected) return;
    const names = new Map(
      profiles
        .filter((item) => item.profile)
        .map((item) => [item.id, item.profile!.displayName]),
    );
    for (const card of library) {
      const name = card.ownerId && names.get(card.ownerId);
      if (name) card.subtitle = name;
    }
    // Preserve the sidebar's focus and scroll position while names arrive.
    document
      .querySelectorAll<HTMLElement>(".library-item[data-uri]")
      .forEach((row) => {
        const card = library.find((card) => card.uri === row.dataset.uri);
        const label = row.querySelector("small");
        if (card && label) label.textContent = card.subtitle;
      });
  } catch {
    /* Profiles are optional; music and playlist controls remain available. */
  }
}

async function loadAccountProfile(epoch: number): Promise<void> {
  try {
    const profile = await invoke<UserProfile | null>("get_account_profile");
    if (epoch !== connectEpoch || !status.connected) return;
    accountProfile = profile;
    renderAccount();
  } catch {
    /* Keep a neutral avatar when the public profile is unavailable. */
  }
}

function nativeCard(track: NativeTrack): Card {
  return {
    uri: track.uri,
    name: track.name,
    subtitle: track.artist,
    image: track.image,
    kind: "track",
    durationMs: track.durationMs,
  };
}

function menuButton(uri: string, position?: number, queueId?: number): string {
  if (!uri.startsWith("spotify:track:")) return "<span></span>";
  return `<button class="icon-button track-menu-button" data-menu="${esc(uri)}" ${position === undefined ? "" : `data-position="${position}"`} ${queueId === undefined ? "" : `data-queue-id="${queueId}"`} aria-label="Plus d’options" ${!status.nativeReady || playlistPending ? "disabled" : ""}>${icon("more")}</button>`;
}
function closeTrackMenu(): void {
  document.querySelector(".track-menu")?.remove();
}
function openTrackMenu(button: HTMLElement): void {
  closeTrackMenu();
  const uri = button.dataset.menu!;
  const position =
    button.dataset.position === undefined
      ? null
      : Number(button.dataset.position);
  const snapshot = activeView === "collection" ? selectedCollection : null;
  const queueId =
    button.dataset.queueId === undefined
      ? null
      : Number(button.dataset.queueId);
  const menu = document.createElement("div");
  menu.className = "track-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `<button role="menuitem" data-action="queue">Ajouter à la file d’attente</button><button role="menuitem" data-action="add">Ajouter à une playlist</button>${queueId !== null ? '<button role="menuitem" data-action="unqueue">Retirer de la file d’attente</button>' : ""}${snapshot?.data.canEditItems && position !== null ? '<button role="menuitem" data-action="remove">Supprimer de cette playlist</button>' : ""}`;
  document.body.append(menu);
  const rect = button.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(rect.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - menu.offsetHeight - 8))}px`;
  menu.querySelector<HTMLButtonElement>("button")?.focus();
  menu.addEventListener("click", (event) => {
    const action = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-action]",
    )?.dataset.action;
    if (!action) return;
    closeTrackMenu();
    if (action === "add") void playlists.add(uri);
    if (action === "queue") void sendConnect({ kind: "add", uri });
    if (action === "unqueue" && queueId !== null)
      void editConnectQueue("remove", queueId, undefined, null);
    if (action === "remove" && snapshot?.data.revision && position !== null)
      void playlists.change(snapshot.card.uri, snapshot.data.revision, {
        kind: "remove",
        position,
        uri,
      });
  });
  menu.addEventListener("keydown", (event) => {
    const buttons = [...menu.querySelectorAll<HTMLButtonElement>("button")];
    if (event.key === "Escape") {
      closeTrackMenu();
      button.focus();
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const index = buttons.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      buttons[
        (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
          buttons.length
      ]?.focus();
    }
  });
}
function moveTrack(position: number, to: number, uri: string): void {
  const snapshot = selectedCollection;
  if (
    playlistPending ||
    activeView !== "collection" ||
    !snapshot?.data.canEditItems ||
    !snapshot.data.revision ||
    to < 0 ||
    to >= snapshot.data.total ||
    to === position
  )
    return;
  void playlists.change(snapshot.card.uri, snapshot.data.revision, {
    kind: "move",
    position,
    to,
    uri,
  });
}
function trackList(
  tracks: NativeTrack[],
  offset: number,
  editable = false,
): string {
  return `<div class="tracklist"><div class="tracklist-heading"><span>#</span><span>Titre</span><span>Album</span><span></span><span>${icon("clock")}</span><span></span></div>${tracks
    .map((track, index) => {
      const position = offset + index;
      return `<div class="track-row" ${editable ? `draggable="true" tabindex="0" data-position="${position}" data-track="${esc(track.uri)}" title="Glissez pour déplacer · Alt + ↑ ou ↓"` : ""}><button class="row-play" data-play="${esc(track.uri)}" data-play-position="${position}"><span class="track-index">${position + 1}</span><span class="row-name">${cover({ image: track.image, name: track.name, kind: "track" })}<span><strong>${esc(track.name)}</strong><small>${esc(track.artist)}</small></span></span></button><span class="album-name">${esc(track.album)}</span>${savedButton(track.uri)}<span>${formatTime(track.durationMs)}</span>${menuButton(track.uri, editable ? position : undefined)}</div>`;
    })
    .join("")}</div>`;
}

async function openLiked(index = 0): Promise<void> {
  const token = likedTokens[index];
  if (token === undefined) return;
  const id = ++requestId;
  byId("main-content").innerHTML =
    '<div class="loading" role="status">Chargement des Titres likés…</div>';
  try {
    const result = await invoke<{
      tracks: NativeTrack[];
      nextToken: string | null;
    }>("get_liked_tracks", { token });
    if (id !== requestId) return;
    activeView = "liked";
    likedIndex = index;
    if (result.nextToken) likedTokens[index + 1] = result.nextToken;
    else likedTokens.length = index + 1;
    likedOffsets[index + 1] = likedOffsets[index] + result.tracks.length;
    collectionTracks = result.tracks.map(nativeCard);
    cards.clear();
    remember(library);
    remember(collectionTracks);
    byId("main-content").innerHTML =
      `<div class="collection-header liked-header">${cover(likedCard)}<div><p>Playlist</p><h1>Titres likés</h1></div></div>${result.tracks.length ? trackList(result.tracks, likedOffsets[index] ?? 0) : '<div class="empty"><p>Aucun titre sur cette page.</p></div>'}<div class="pagination"><button class="pill" id="liked-prev" ${index === 0 ? "disabled" : ""}>Précédent</button><span>Page ${index + 1}</span><button class="pill" id="liked-next" ${!result.nextToken ? "disabled" : ""}>Suivant</button></div>`;
    updateSavedButtons();
    void refreshSaved();
    updateControls();
  } catch (err) {
    if (id !== requestId) return;
    byId("main-content").innerHTML =
      '<div class="empty"><h1>Impossible de charger les Titres likés</h1><button class="pill white" id="liked-tracks">Réessayer</button></div>';
    showError(err);
  }
}
async function openCollection(card: Card, offset = 0): Promise<void> {
  const id = ++requestId;
  byId("main-content").innerHTML =
    '<div class="loading" role="status">Chargement des titres…</div>';
  try {
    const result = await invoke<Collection>("open_collection", {
      uri: card.uri,
      offset,
    });
    if (id !== requestId) return;
    if (offset > 0 && offset >= result.total) {
      await openCollection(
        card,
        Math.max(0, Math.floor((result.total - 1) / 40) * 40),
      );
      return;
    }
    activeView = "collection";
    card = { ...card, name: result.name };
    selectedCollection = { card, data: result };
    collectionUri = card.uri;
    collectionOffset = result.offset;
    collectionTotal = result.total;
    collectionTracks = result.tracks.map(nativeCard);
    cards.clear();
    remember(library);
    remember([card, ...collectionTracks]);
    byId("main-content").innerHTML =
      `<div class="collection-header">${cover(card)}<div><p>${esc(card.kind === "album" ? "Album" : "Playlist")}</p><h1>${esc(result.name)}</h1>${result.description ? `<p class="playlist-description">${esc(result.description)}</p>` : ""}<p>${result.total} titres</p></div></div>
      ${result.canEditMetadata ? '<div class="collection-actions"><button class="pill" id="edit-playlist">Modifier les informations</button></div>' : ""}
      ${trackList(result.tracks, offset, result.canEditItems)}
      <div class="pagination"><button class="pill" id="collection-prev" ${offset === 0 ? "disabled" : ""}>Précédent</button><span>${result.total ? offset + 1 : 0}–${Math.min(offset + 40, result.total)} sur ${result.total}</span><button class="pill" id="collection-next" ${offset + 40 >= result.total ? "disabled" : ""}>Suivant</button></div>`;
    updateControls();
    updateSavedButtons();
    void refreshSaved();
  } catch (err) {
    if (id === requestId) {
      byId("main-content").innerHTML =
        '<div class="empty"><h1>Cette page est indisponible</h1><p>Réessayez après vous être connecté.</p></div>';
      showError(err);
    }
  }
}

async function sendConnect(
  action: ConnectAction,
  device = commandDevice(connectState),
): Promise<void> {
  if (connectPending || !connectState.ready) return;
  const epoch = connectEpoch;
  connectPending = true;
  updateControls();
  try {
    await invoke("connect_command", { action, deviceId: device });
  } catch (err) {
    if (epoch === connectEpoch) showError(err);
  } finally {
    if (epoch === connectEpoch) {
      connectPending = false;
      queuePreparing = false;
      updateControls();
    }
  }
}
async function editConnectQueue(
  kind: "jump" | "remove" | "move",
  id: number,
  to?: number,
  captured = queueDragSnapshot,
): Promise<void> {
  const key = captured?.key ?? connectQueueKeys.get(id);
  if (!key) return;
  try {
    await sendConnect(
      queueAction(
        connectState,
        key,
        captured?.revision ?? connectState.revision,
        kind,
        to,
      ),
      captured?.device ?? commandDevice(connectState),
    );
  } catch (err) {
    showError(err);
  }
}
async function startTrack(uri: string, position?: number): Promise<void> {
  if (!status.nativeReady || !connectState.ready || connectPending) return;
  if (!/^spotify:track:[A-Za-z0-9]{22}$/.test(uri)) {
    showError({
      message: "Ce type de contenu ne peut pas encore être lu dans Spotisloth.",
    });
    return;
  }
  const collection = activeView === "collection" ? selectedCollection : null;
  const context =
    collection?.card.uri ?? (activeView === "liked" ? likedCard.uri : null);
  const tracks = context
    ? null
    : [...cards.values()].filter((c) => c.kind === "track").map((c) => c.uri);
  const index =
    collection && Number.isInteger(position)
      ? position!
      : tracks
        ? tracks.indexOf(uri)
        : null;
  queuePreparing = true;
  await sendConnect({
    kind: "play",
    uri,
    context,
    tracks: tracks?.length ? tracks : [uri],
    index: index !== null && index >= 0 ? index : null,
    shuffle: queue.shuffle,
    repeat: queue.repeat,
  });
}
async function command(command: string, value?: number): Promise<void> {
  if (command === "seek" || command === "volume")
    await sendConnect({ kind: command, value: value ?? 0 });
  else await sendConnect({ kind: command === "play" ? "resume" : "pause" });
}
function step(direction: number): void {
  void sendConnect({ kind: direction < 0 ? "previous" : "next" });
}
function togglePlayback(): void {
  if (playback.track) void command(playback.playing ? "pause" : "play");
}
function applyConnect(next: ConnectState): void {
  const previous = connectState;
  connectState = next;
  audioSettings.update(next);
  const cached = next.track ? connectMetadata.get(next.track.uri) : undefined;
  const track = next.track ? { ...next.track, ...(cached ?? {}) } : null;
  const changed =
    previous.revision !== next.revision || previous.track?.uri !== track?.uri;
  const metadataChanged =
    playback.track?.name !== track?.name ||
    playback.track?.artist !== track?.artist ||
    playback.track?.durationMs !== track?.durationMs ||
    playback.track?.image !== track?.image ||
    playback.track?.album !== track?.album;
  playback = {
    selection: next.revision,
    track,
    playing: next.playing,
    loading: next.loading,
    positionMs: next.positionMs,
    ended: false,
    unavailable: false,
  };
  lastPlaybackUpdate = performance.now();
  if (changed) {
    const known = new Map(
      [
        ...cards.values(),
        ...(queue.current ? [queue.current.track] : []),
        ...queue.upcoming.map((e) => e.track),
      ].map((c) => [c.uri, c]),
    );
    queue.clear();
    connectQueueKeys.clear();
    connectQueued.clear();
    queueView.reset();
    if (track) {
      queue.reset(
        [
          nativeCard(track),
          ...next.queue.map((t) => known.get(t.uri) ?? nativeCard(t)),
        ],
        0,
        next.contextName,
      );
      queue.upcoming.forEach((e, i) => {
        connectQueueKeys.set(e.id, next.queue[i].key);
        if (next.queue[i].queued) connectQueued.add(e.id);
      });
    }
  }
  queue.shuffle = next.shuffle;
  queue.repeat = next.repeat;
  if (metadataChanged && track) queue.updateTrack(track.uri, nativeCard(track));
  if (changed || metadataChanged) {
    renderPlayback();
    queueView.render();
  } else updateControls();
  updatePosition();
  const active = next.devices.find((d) => d.active);
  const volume = active?.volume;
  if (
    volume !== null &&
    volume !== undefined &&
    document.activeElement !== byId("volume")
  )
    byId<HTMLInputElement>("volume").value = String(volume);
  const remote = !!active && !active.local;
  byId("connect-banner").hidden = !remote;
  byId("connect-banner").textContent = remote
    ? "Lecture sur " + active.name
    : "";
  document.body.classList.toggle("remote-playback", remote);
  if (
    track?.name === "Chargement du titre…" &&
    !metadataPending.has(track.uri)
  ) {
    const epoch = connectEpoch;
    const uri = track.uri;
    metadataPending.add(uri);
    void invoke<NativeTrack[]>("get_track_details", { uris: [uri] })
      .then((tracks) => {
        if (epoch !== connectEpoch) return;
        const detail = tracks[0];
        if (!detail) return;
        if (connectMetadata.size >= 200) connectMetadata.clear();
        connectMetadata.set(uri, detail);
        if (playback.track?.uri === uri) {
          playback.track = detail;
          queue.updateTrack(uri, nativeCard(detail));
          renderPlayback();
          queueView.render();
        }
      })
      .catch((err) => {
        if (epoch === connectEpoch) showError(err);
      })
      .finally(() => {
        if (epoch === connectEpoch) metadataPending.delete(uri);
      });
  }
}
function updateControls(): void {
  const ready = status.nativeReady && connectState.ready && !connectPending;
  const hasTrack = !!playback.track && ready;
  devicePicker.update(connectState, connectPending);
  const toggle = byId<HTMLButtonElement>("toggle-play");
  toggle.disabled =
    !hasTrack ||
    queuePreparing ||
    playback.loading ||
    (playback.playing
      ? connectState.restrictions.pause
      : connectState.restrictions.resume);
  if (toggle.dataset.playing !== String(playback.playing)) {
    toggle.dataset.playing = String(playback.playing);
    toggle.innerHTML = icon(playback.playing ? "pause" : "play");
  }
  toggle.classList.toggle("is-loading", queuePreparing || playback.loading);
  toggle.setAttribute("aria-label", playback.playing ? "Pause" : "Lire");
  byId<HTMLInputElement>("seek").disabled =
    !hasTrack || playback.loading || connectState.restrictions.seek;
  byId<HTMLInputElement>("volume").disabled =
    !ready ||
    !connectState.activeDeviceId ||
    connectState.devices.find((d) => d.active)?.volume === null;
  byId<HTMLButtonElement>("previous").disabled =
    !hasTrack ||
    playback.loading ||
    queuePreparing ||
    connectState.restrictions.previous;
  byId<HTMLButtonElement>("next").disabled =
    !hasTrack ||
    playback.loading ||
    queuePreparing ||
    connectState.restrictions.next;
  const shuffle = byId<HTMLButtonElement>("shuffle");
  shuffle.disabled =
    !ready || queuePreparing || connectState.restrictions.shuffle;
  shuffle.setAttribute("aria-pressed", String(queue.shuffle));
  shuffle.classList.toggle("active", queue.shuffle);
  shuffle.setAttribute(
    "aria-label",
    queue.shuffle
      ? "Désactiver la lecture aléatoire"
      : "Activer la lecture aléatoire",
  );
  const repeat = byId<HTMLButtonElement>("repeat");
  repeat.disabled =
    !ready || queuePreparing || connectState.restrictions.repeat;
  repeat.setAttribute("aria-pressed", String(queue.repeat !== "off"));
  repeat.classList.toggle("active", queue.repeat !== "off");
  repeat.setAttribute(
    "aria-label",
    queue.repeat === "off"
      ? "Activer la répétition"
      : queue.repeat === "all"
        ? "Répéter le titre"
        : "Désactiver la répétition",
  );
  repeat.title =
    queue.repeat === "off"
      ? "Répétition désactivée"
      : queue.repeat === "all"
        ? "Répéter la sélection"
        : "Répéter le titre";
  if (repeat.dataset.mode !== queue.repeat) {
    repeat.dataset.mode = queue.repeat;
    repeat.innerHTML = `${icon("repeat")}${queue.repeat === "one" ? '<span class="repeat-one">1</span>' : ""}`;
  }
}
function renderPlayback(): void {
  const track = playback.track;
  byId("track-info").innerHTML = track
    ? `${cover({ image: track.image, name: track.name, kind: "track" })}<span class="track-label"><strong>${esc(track.name)}</strong><small>${esc(track.artist)}</small></span>${savedButton(track.uri)}${menuButton(track.uri)}`
    : "";
  byId("now-playing").innerHTML = track
    ? `${cover({ image: track.image, name: track.name, kind: "track" })}<h3>${esc(track.name)}</h3><p>${esc(track.artist)}</p><div class="album-caption"><small>Album</small><p>${esc(track.album)}</p></div>`
    : '<div class="now-empty">' +
      icon("music") +
      "<p>Choisissez un titre<br/>pour commencer à écouter.</p></div>";
  byId("duration").textContent = formatTime(track?.durationMs || 0);
  updatePosition();
  updateControls();
  updateSavedButtons();
  if (track) void refreshSaved([track.uri]);
}
async function connect(interactive: boolean): Promise<void> {
  if (!isTauri()) {
    if (interactive)
      showError({
        message: "Ouvrez l’application Windows Spotisloth pour vous connecter.",
      });
    return;
  }
  const button = document.querySelector<HTMLButtonElement>(
    "#connect, #welcome-connect",
  );
  if (button) {
    button.disabled = true;
    button.textContent = "Connexion…";
  }
  try {
    status = await invoke<Status>("connect_spotify", { interactive });
    renderAccount();
    if (status.nativeReady) void loadAccountProfile(connectEpoch);
    if (!connectState.available) {
      const initial = await invoke<ConnectState>("get_connect_state");
      if (!connectState.available) applyConnect(initial);
    }
    updateControls();
    await Promise.all([
      loadHome(),
      status.nativeReady ? loadLibrary() : Promise.resolve(),
    ]);
    jamView.setReady(status.nativeReady);
  } catch (err) {
    if (interactive || (err as AppError).code !== "AUTH_REQUIRED")
      showError(err);
  } finally {
    renderAccount();
  }
}

byId<HTMLInputElement>("search").addEventListener("input", (event) => {
  clearTimeout(searchTimer);
  ++requestId;
  const query = (event.target as HTMLInputElement).value.trim();
  searchTimer = setTimeout(() => {
    if (query) void search(query);
    else void loadHome();
  }, 350);
});
document.addEventListener("click", async (event) => {
  if (!(event.target as HTMLElement).closest(".track-menu, [data-menu]"))
    closeTrackMenu();
  const button = (event.target as HTMLElement).closest<HTMLElement>(
    "button, a.brand",
  );
  if (!button) return;
  if (button instanceof HTMLButtonElement && button.disabled) return;
  const id = button.id;
  if (id === "show-settings") {
    ++requestId;
    clearTimeout(searchTimer);
    byId<HTMLInputElement>("search").value = "";
    document.querySelector("details.profile")?.removeAttribute("open");
    activeView = "settings";
    void audioSettings.open(byId("main-content"));
    return;
  }
  if (button.dataset.menu) {
    openTrackMenu(button);
    return;
  }
  if (id === "create-playlist") {
    playlists.details();
    return;
  }
  if (
    id === "edit-playlist" &&
    selectedCollection?.data.canEditMetadata &&
    selectedCollection.data.revision
  ) {
    const { card, data } = selectedCollection;
    playlists.details({
      uri: card.uri,
      name: data.name,
      description: data.description,
      revision: data.revision!,
    });
    return;
  }
  if (button.matches("a.brand") || id === "home" || id === "retry-home") {
    event.preventDefault();
    clearTimeout(searchTimer);
    byId<HTMLInputElement>("search").value = "";
    void loadHome();
  }
  if (id === "connect" || id === "welcome-connect") void connect(true);
  if (id === "disconnect") {
    jamView.setReady(false);
    ++connectEpoch;
    connectState = emptyConnectState();
    audioSettings.update(connectState);
    connectMetadata.clear();
    metadataPending.clear();
    connectQueueKeys.clear();
    connectPending = false;
    devicePicker.close();
    byId("connect-banner").hidden = true;
    document.body.classList.remove("remote-playback");
    playlists.close();
    selectedCollection = null;
    savedTracks.clear();
    try {
      await invoke("disconnect_spotify");
      status = { connected: false, nativeReady: false };
      accountProfile = null;
      library = [];
      libraryNext = null;
      queue.clear();
      queuePreparing = false;
      queueView.reset();
      collectionTracks = [];
      cards.clear();
      playback = {
        selection: "",
        track: null,
        playing: false,
        loading: false,
        unavailable: false,
        positionMs: 0,
        ended: false,
      };
      renderAccount();
      renderLibrary();
      renderPlayback();
      await loadHome();
    } catch (err) {
      showError(err);
    }
  }
  if (button.dataset.save) {
    void toggleSaved(button.dataset.save);
    return;
  }
  if (id === "liked-tracks") {
    likedTokens = [""];
    likedOffsets = [0];
    void openLiked();
  }
  if (id === "liked-prev") void openLiked(Math.max(0, likedIndex - 1));
  if (id === "liked-next") void openLiked(likedIndex + 1);
  if (button.dataset.uri) {
    const card =
      cards.get(button.dataset.uri) ||
      library.find((item) => item.uri === button.dataset.uri);
    if (card) {
      if (card.kind === "track") {
        void startTrack(card.uri);
      } else if (card.kind === "album" || card.kind === "playlist")
        void openCollection(card);
      else
        showError({
          message: "Cette page n’est pas encore disponible dans ce prototype.",
        });
    }
  }
  if (button.dataset.play) {
    void startTrack(button.dataset.play, Number(button.dataset.playPosition));
  }
  if (button.dataset.queuePlay && !queuePreparing && !playback.loading) {
    void editConnectQueue(
      "jump",
      Number(button.dataset.queuePlay),
      undefined,
      null,
    );
  }
  if (button.dataset.queueCurrent) togglePlayback();
  if (id === "queue-more") queueView.more();
  if (button.dataset.library) {
    document
      .querySelectorAll(".library-filters .chip")
      .forEach((item) => item.classList.toggle("active", item === button));
    libraryFilter = button.dataset.library;
    renderLibrary();
  }
  if (id === "library-more" && libraryNext !== null)
    void loadLibrary(libraryNext);
  if (id === "toggle-play") togglePlayback();
  if (id === "shuffle") {
    if (connectState.activeDeviceId)
      void sendConnect({ kind: "shuffle", value: !queue.shuffle });
    else {
      queue.setShuffle(!queue.shuffle);
      updateControls();
    }
  }
  if (id === "repeat") {
    if (connectState.activeDeviceId)
      void sendConnect({ kind: "repeat", value: nextRepeat(queue.repeat) });
    else {
      queue.cycleRepeat();
      updateControls();
    }
  }
  if (id === "previous") step(-1);
  if (id === "next") step(1);
  if (id === "collection-next" || id === "collection-prev") {
    const card =
      cards.get(collectionUri) || library.find((c) => c.uri === collectionUri);
    if (card && collectionTotal > 0)
      void openCollection(
        card,
        Math.max(0, collectionOffset + (id === "collection-next" ? 40 : -40)),
      );
  }
  if (id === "show-queue") {
    ++requestId;
    activeView = "queue";
    queueView.render();
  }
});
byId<HTMLInputElement>("seek").addEventListener("change", (event) => {
  void command(
    "seek",
    Math.round(
      (Number((event.target as HTMLInputElement).value) / 100) *
        (playback.track?.durationMs || 0),
    ),
  );
});
byId<HTMLInputElement>("volume").addEventListener("change", (event) => {
  void command("volume", Number((event.target as HTMLInputElement).value));
});
document.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement;
  if (target.closest("dialog, input, textarea, [contenteditable='true']"))
    return;
  if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
    const queued = target.closest<HTMLElement>(".queue-row[data-queue-id]");
    if (queued) {
      event.preventDefault();
      const id = Number(queued.dataset.queueId);
      const position = queue.upcoming.findIndex((entry) => entry.id === id);
      void editConnectQueue(
        "move",
        id,
        position + (event.key === "ArrowUp" ? -1 : 1),
        null,
      );
      return;
    }
    const row = target.closest<HTMLElement>(".track-row[data-position]");
    if (row) {
      event.preventDefault();
      const position = Number(row.dataset.position);
      moveTrack(
        position,
        position + (event.key === "ArrowUp" ? -1 : 1),
        row.dataset.track!,
      );
    }
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    byId<HTMLInputElement>("search").focus();
  }
  if (
    event.code === "Space" &&
    !target.closest("button, [role='menu']") &&
    playback.track
  ) {
    event.preventDefault();
    togglePlayback();
  }
});
document.addEventListener("dragstart", (event) => {
  const queued = (event.target as HTMLElement).closest<HTMLElement>(
    ".queue-row[data-queue-id]",
  );
  if (queued) {
    queueDragId = Number(queued.dataset.queueId);
    const key = connectQueueKeys.get(queueDragId);
    queueDragSnapshot = key
      ? {
          key,
          revision: connectState.revision,
          device: commandDevice(connectState),
        }
      : null;
    event.dataTransfer?.setData("text/plain", `queue:${queueDragId}`);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    queued.classList.add("dragging");
    closeTrackMenu();
    return;
  }
  const row = (event.target as HTMLElement).closest<HTMLElement>(
    ".track-row[draggable='true']",
  );
  if (!row || playlistPending || !selectedCollection?.data.revision) {
    event.preventDefault();
    return;
  }
  drag = {
    uri: row.dataset.track!,
    position: Number(row.dataset.position),
    playlist: selectedCollection.card.uri,
    revision: selectedCollection.data.revision,
  };
  event.dataTransfer?.setData("text/plain", drag.uri);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  row.classList.add("dragging");
  closeTrackMenu();
});
document.addEventListener("dragover", (event) => {
  const queued = (event.target as HTMLElement).closest<HTMLElement>(
    ".queue-row[data-queue-id]",
  );
  if (queued && queueDragId !== null) {
    event.preventDefault();
    document.querySelector(".drop-target")?.classList.remove("drop-target");
    queued.classList.add("drop-target");
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    return;
  }
  const row = (event.target as HTMLElement).closest<HTMLElement>(
    ".track-row[draggable='true']",
  );
  if (
    row &&
    drag?.playlist === selectedCollection?.card.uri &&
    !playlistPending
  ) {
    event.preventDefault();
    document.querySelector(".drop-target")?.classList.remove("drop-target");
    row.classList.add("drop-target");
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  }
});
document.addEventListener("drop", (event) => {
  const queued = (event.target as HTMLElement).closest<HTMLElement>(
    ".queue-row[data-queue-id]",
  );
  if (queued && queueDragId !== null) {
    event.preventDefault();
    void editConnectQueue(
      "move",
      queueDragId,
      queue.upcoming.findIndex(
        (entry) => entry.id === Number(queued.dataset.queueId),
      ),
    );
    queueDragId = null;
    queueDragSnapshot = null;
    return;
  }
  const row = (event.target as HTMLElement).closest<HTMLElement>(
    ".track-row[draggable='true']",
  );
  const source = drag;
  if (
    row &&
    source &&
    source.playlist === selectedCollection?.card.uri &&
    source.revision === selectedCollection.data.revision
  ) {
    event.preventDefault();
    moveTrack(source.position, Number(row.dataset.position), source.uri);
  }
  drag = null;
  document
    .querySelectorAll(".dragging, .drop-target")
    .forEach((element) => element.classList.remove("dragging", "drop-target"));
});
document.addEventListener("dragend", () => {
  queueDragId = null;
  queueDragSnapshot = null;
  drag = null;
  document
    .querySelectorAll(".dragging, .drop-target")
    .forEach((element) => element.classList.remove("dragging", "drop-target"));
});
window.addEventListener("resize", closeTrackMenu);
byId("content").addEventListener("scroll", closeTrackMenu);

function updatePosition(): void {
  const position = Math.min(
    playback.track?.durationMs || 0,
    playback.positionMs +
      (playback.playing ? performance.now() - lastPlaybackUpdate : 0),
  );
  const positionLabel = byId("position");
  const formatted = formatTime(position);
  if (positionLabel.textContent !== formatted)
    positionLabel.textContent = formatted;
  const seek = byId<HTMLInputElement>("seek");
  if (document.activeElement !== seek) {
    const value = String(
      playback.track?.durationMs
        ? (position / playback.track.durationMs) * 100
        : 0,
    );
    if (seek.value !== value) seek.value = value;
  }
}
setInterval(() => {
  // Server events still update seeks and paused tracks; only playing progress
  // needs extrapolation between those events.
  if (!document.hidden && playback.playing) updatePosition();
}, 500);

async function boot(): Promise<void> {
  welcome();
  renderLibrary();
  if (!isTauri()) return;
  await listen<ConnectState>("connect-state", (event) => {
    if (status.nativeReady && event.payload.available)
      applyConnect(event.payload);
  });
  await listen("jam-changed", () => jamView.notice());
  await connect(false);
}
void boot().catch(showError);
