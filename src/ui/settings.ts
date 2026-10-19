import { invoke } from "@tauri-apps/api/core";
import {
  qualityLabel,
  qualityOptions,
  isAudioQuality,
  type AudioSettings,
} from "../lib/audio.ts";
import type { ConnectState } from "../lib/connect.ts";

export class AudioSettingsView {
  private root: HTMLElement | null = null;
  constructor(
    private state: ConnectState,
    private error: (error: unknown) => void,
  ) {}

  async open(container: HTMLElement): Promise<void> {
    const root = document.createElement("section");
    root.className = "audio-settings";
    root.innerHTML =
      '<h1>Préférences</h1><h2>Qualité audio</h2><p role="status">Chargement des préférences…</p>';
    this.root = root;
    container.replaceChildren(root);
    try {
      const settings = await invoke<AudioSettings>("get_audio_settings");
      if (!root.isConnected || this.root !== root) return;
      root.innerHTML = `<h1>Préférences</h1><h2>Qualité audio</h2>
        <div class="setting-row"><div><label for="audio-quality">Qualité du streaming</label><p>Qualité demandée pour la lecture sur cet ordinateur. Elle peut varier selon le titre disponible.</p></div>
        <select id="audio-quality">${qualityOptions.map((o) => `<option value="${o.value}" ${o.value === settings.quality ? "selected" : ""}>${o.label}</option>`).join("")}<option disabled>Lossless — indisponible</option></select></div>
        <p class="setting-notice" id="audio-quality-notice" role="status"></p>
        <div class="setting-row"><div><strong>Lossless</strong><p>La lecture locale de Spotisloth ne prend pas en charge la qualité sans perte. Sur un autre appareil compatible, utilise les réglages de qualité de Spotify.</p></div><span class="quality-unavailable">Indisponible ici</span></div>
        <h2>Lecture en cours</h2><div class="setting-row"><div><strong id="quality-device"></strong><p>Qualité signalée par l’appareil de lecture.</p></div><span id="reported-quality"></span></div>`;
      this.notice(settings);
      this.update(this.state);
      const select = root.querySelector<HTMLSelectElement>("#audio-quality")!;
      select.addEventListener("change", async () => {
        if (!isAudioQuality(select.value)) return;
        select.disabled = true;
        try {
          const next = await invoke<AudioSettings>("set_audio_quality", {
            quality: select.value,
          });
          settings.quality = next.quality;
          if (root.isConnected && this.root === root) this.notice(next);
        } catch (error) {
          select.value = settings.quality;
          this.error(error);
        } finally {
          select.disabled = false;
        }
      });
    } catch (error) {
      if (!root.isConnected || this.root !== root) return;
      root.innerHTML =
        '<h1>Préférences</h1><h2>Qualité audio</h2><p>Impossible de charger les préférences.</p><button class="pill" id="retry-audio">Réessayer</button>';
      root
        .querySelector("button")!
        .addEventListener("click", () => void this.open(container));
      this.error(error);
    }
  }

  private notice(settings: AudioSettings): void {
    const notice = this.root?.querySelector("#audio-quality-notice");
    if (notice)
      notice.textContent = settings.restartRequired
        ? `Qualité enregistrée. Redémarre Spotisloth pour appliquer ce réglage. Réglage actif : ${qualityLabel(settings.activeQuality)}.`
        : "La qualité choisie est enregistrée sur cet ordinateur.";
  }

  update(state: ConnectState): void {
    this.state = state;
    if (!this.root?.isConnected) return;
    const device = this.root.querySelector("#quality-device");
    if (!device) return;
    device.textContent =
      state.devices.find((d) => d.active)?.name ?? "Aucun appareil actif";
    const quality = this.root.querySelector<HTMLElement>("#reported-quality")!;
    quality.textContent = state.track
      ? qualityLabel(state.quality)
      : "Aucune lecture";
    quality.classList.toggle(
      "is-lossless",
      state.quality === "lossless" || state.quality === "lossless24",
    );
  }
}
