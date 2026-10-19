export type Card = {
  uri: string;
  name: string;
  subtitle: string;
  image: string;
  kind: string;
  durationMs: number;
  ownerId?: string;
};
export type Section = { name: string; items: Card[] };
type Json = Record<string, unknown>;
const object = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
const string = (value: unknown): string =>
  typeof value === "string" ? value : "";
const text = (value: unknown): string =>
  string(value) ||
  string(object(value).text) ||
  string(object(value).transformedLabel);

export function imageUrl(value: unknown): string {
  const candidate = string(value);
  try {
    const url = new URL(candidate);
    if (url.protocol === "https:" && !url.username && !url.password)
      return url.href;
  } catch {
    /* Missing cover artwork is normal. */
  }
  return "";
}

function findImage(value: unknown, depth = 0): string {
  if (depth > 5 || !value || typeof value !== "object") return "";
  const obj = object(value);
  const direct = imageUrl(obj.url);
  if (direct) return direct;
  for (const child of Array.isArray(value) ? value : Object.values(obj)) {
    const found = findImage(child, depth + 1);
    if (found) return found;
  }
  return "";
}

function findNames(value: unknown): string[] {
  const obj = object(value);
  return array(obj.items ?? value)
    .slice(0, 3)
    .map((item) => {
      const artist = object(object(item).data ?? item);
      return text(artist.name) || text(object(artist.profile).name);
    })
    .filter(Boolean);
}

export function toCard(value: unknown): Card | null {
  let data = object(value);
  for (let i = 0; i < 5; i++) {
    const inner = data.data ?? data.item ?? data.content ?? data.track;
    if (!inner || string(data.uri).startsWith("spotify:")) break;
    data = object(inner);
  }
  const uri = string(data.uri);
  const kind = uri.split(":")[1];
  if (
    !/^spotify:(track|episode|album|playlist|artist|show):[A-Za-z0-9]+$/.test(
      uri,
    )
  )
    return null;
  const name =
    text(data.name) || text(object(data.profile).name) || text(data.title);
  if (!name) return null;
  const by =
    findNames(data.artists).join(", ") ||
    text(object(data.ownerV2).data && object(object(data.ownerV2).data).name);
  const labels: Record<string, string> = {
    album: "Album",
    playlist: "Playlist",
    artist: "Artiste",
    show: "Podcast",
    episode: "Épisode",
    track: "Titre",
  };
  return {
    uri,
    name,
    kind,
    ...(kind === "playlist" && string(data.ownerId)
      ? { ownerId: string(data.ownerId) }
      : {}),
    subtitle: by || labels[kind] || "",
    image: findImage(
      data.coverArt ??
        data.images ??
        data.visuals ??
        object(data.albumOfTrack).coverArt,
    ),
    durationMs: Number(
      object(data.trackDuration).totalMilliseconds ??
        object(data.duration).totalMilliseconds ??
        0,
    ),
  };
}

export function collectCards(value: unknown, limit = 50): Card[] {
  const found = new Map<string, Card>();
  function visit(node: unknown, depth: number): void {
    if (!node || typeof node !== "object" || depth > 18 || found.size >= limit)
      return;
    const card = toCard(node);
    if (card) {
      found.set(card.uri, card);
      return;
    }
    for (const child of Array.isArray(node) ? node : Object.values(node))
      visit(child, depth + 1);
  }
  visit(value, 0);
  return [...found.values()];
}

export function homeSections(value: unknown): Section[] {
  const data = object(object(value).data);
  const home = object(data.home);
  const sections = array(object(object(home.sectionContainer).sections).items);
  return sections
    .map((section) => {
      const item = object(section);
      const meta = object(item.data);
      return {
        name: text(meta.title) || text(object(meta.title).text) || "Pour vous",
        items: collectCards(item.sectionItems, 12),
      };
    })
    .filter((section) => section.items.length > 0);
}

export function searchSections(value: unknown): Section[] {
  const results = object(object(object(value).data).searchV2);
  return [
    ["Titres", "tracksV2"],
    ["Artistes", "artists"],
    ["Albums", "albumsV2"],
    ["Playlists", "playlists"],
    ["Podcasts", "podcasts"],
  ]
    .map(([name, key]) => ({ name, items: collectCards(results[key], 20) }))
    .filter((section) => section.items.length > 0);
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}

export function formatTime(ms: number): string {
  const seconds = Math.max(0, Math.floor(Number.isFinite(ms) ? ms / 1000 : 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
