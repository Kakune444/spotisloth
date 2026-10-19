import type { RepeatMode } from "./queue.ts";
import type { ReportedQuality } from "./audio.ts";
export type ConnectTrack = {
  uri: string;
  name: string;
  artist: string;
  album: string;
  image: string;
  durationMs: number;
};
export type ConnectDevice = {
  id: string;
  name: string;
  kind: string;
  local: boolean;
  active: boolean;
  available: boolean;
  volume: number | null;
};
export type ConnectState = {
  available: boolean;
  ready: boolean;
  localDeviceId: string;
  activeDeviceId: string;
  devices: ConnectDevice[];
  track: ConnectTrack | null;
  playing: boolean;
  loading: boolean;
  quality: ReportedQuality | null;
  positionMs: number;
  shuffle: boolean;
  repeat: RepeatMode;
  revision: string;
  contextName: string;
  queue: (ConnectTrack & { key: string; queued: boolean })[];
  restrictions: {
    pause: boolean;
    resume: boolean;
    seek: boolean;
    next: boolean;
    previous: boolean;
    shuffle: boolean;
    repeat: boolean;
    add: boolean;
    editQueue: boolean;
  };
};
export type ConnectAction =
  | { kind: "transfer"; deviceId: string }
  | {
      kind: "play";
      uri: string;
      context: string | null;
      tracks: string[] | null;
      index: number | null;
      shuffle: boolean;
      repeat: RepeatMode;
    }
  | { kind: "pause" | "resume" | "next" | "previous" }
  | { kind: "seek" | "volume"; value: number }
  | { kind: "shuffle"; value: boolean }
  | { kind: "repeat"; value: RepeatMode }
  | { kind: "add"; uri: string }
  | { kind: "jump" | "remove"; key: string; revision: string }
  | { kind: "move"; key: string; revision: string; to: number };
export function emptyConnectState(): ConnectState {
  return {
    available: false,
    ready: false,
    localDeviceId: "",
    activeDeviceId: "",
    devices: [],
    track: null,
    playing: false,
    loading: false,
    quality: null,
    positionMs: 0,
    shuffle: false,
    repeat: "off",
    revision: "",
    contextName: "",
    queue: [],
    restrictions: {
      pause: false,
      resume: false,
      seek: false,
      next: false,
      previous: false,
      shuffle: false,
      repeat: false,
      add: false,
      editQueue: false,
    },
  };
}
export function commandDevice(state: ConnectState): string | null {
  return state.activeDeviceId || state.localDeviceId || null;
}
export function nextRepeat(mode: RepeatMode): RepeatMode {
  return mode === "off" ? "all" : mode === "all" ? "one" : "off";
}
/** Resolve the occurrence from the captured revision, never from a newer display index. */
export function queueAction(
  state: ConnectState,
  key: string,
  revision: string,
  kind: "jump" | "remove" | "move",
  to?: number,
): ConnectAction {
  if (state.revision !== revision || !state.queue.some((t) => t.key === key))
    throw new Error("La file a changé. Réessayez depuis sa nouvelle version.");
  if (kind === "move") {
    if (
      to === undefined ||
      !Number.isInteger(to) ||
      to < 0 ||
      to >= state.queue.length
    )
      throw new Error("Position de file invalide.");
    return { kind, key, revision, to };
  }
  return { kind, key, revision };
}
