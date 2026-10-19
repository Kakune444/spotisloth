import { escapeHtml as esc } from "../lib/catalog.ts";
import type { ConnectState } from "../lib/connect.ts";

export class DevicePicker {
  private state: ConnectState;
  private button: HTMLButtonElement;
  private panel: HTMLElement;
  private transfer: (id: string) => void;
  private icon: (kind: string) => string;
  private busy = false;
  private signature = "";
  private jamActive = false;
  constructor(
    button: HTMLButtonElement,
    state: ConnectState,
    icon: (kind: string) => string,
    transfer: (id: string) => void,
    private jam: (create: boolean) => void,
  ) {
    this.button = button;
    this.state = state;
    this.transfer = transfer;
    this.icon = icon;
    this.panel = document.createElement("section");
    this.panel.id = "device-picker";
    this.panel.className = "device-picker";
    this.panel.setAttribute("aria-label", "Se connecter à un appareil");
    this.panel.hidden = true;
    document.body.append(this.panel);
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", this.panel.id);
    button.addEventListener("click", () => {
      this.panel.hidden = !this.panel.hidden;
      button.setAttribute("aria-expanded", String(!this.panel.hidden));
      this.render();
      if (!this.panel.hidden)
        this.panel.querySelector<HTMLButtonElement>("button")?.focus();
    });
    document.addEventListener("click", (e) => {
      if (!(e.target as HTMLElement).closest("#device-picker, #show-devices"))
        this.close();
    });
    this.panel.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("[data-open-jam]")) {
        this.close();
        this.jam(!this.jamActive);
        return;
      }
      const target = (e.target as HTMLElement).closest<HTMLButtonElement>(
        "[data-device]",
      );
      if (target && !target.disabled) this.transfer(target.dataset.device!);
    });
    this.panel.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.close();
        button.focus();
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const buttons = [
          ...this.panel.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ),
        ];
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[
          (i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
            buttons.length
        ]?.focus();
      }
    });
  }
  close(): void {
    this.panel.hidden = true;
    this.button.setAttribute("aria-expanded", "false");
  }
  setJam(active: boolean): void {
    if (active === this.jamActive) return;
    this.jamActive = active;
    if (!this.panel.hidden) this.render();
  }
  update(state: ConnectState, busy: boolean): void {
    this.state = state;
    this.busy = busy;
    this.button.disabled = !state.ready;
    this.button.classList.toggle("active", !!state.activeDeviceId);
    const signature = JSON.stringify([
      state.ready,
      state.devices,
      busy,
      this.jamActive,
    ]);
    if (!this.panel.hidden && signature !== this.signature) this.render();
    this.signature = signature;
  }
  private render(): void {
    const focus = (document.activeElement as HTMLElement)?.dataset.device;
    const current = this.state.devices.find((d) => d.active);
    this.panel.innerHTML = `<h2>Se connecter à un appareil</h2><p class="device-current">${current ? `Lecture sur ${esc(current.name)}` : "Choisissez où écouter votre musique"}</p><div class="device-list">${this.state.devices.map((d) => `<button data-device="${esc(d.id)}" class="device-row ${d.active ? "active" : ""}" aria-pressed="${d.active}" ${!d.available || this.busy ? "disabled" : ""}>${this.icon(d.kind)}<span><strong>${esc(d.name)}</strong><small>${d.active ? "En cours de lecture" : d.available ? (d.local ? "Cet ordinateur" : "Spotify Connect") : "Indisponible"}</small></span>${d.active ? '<span class="device-check">✓</span>' : ""}</button>`).join("")}</div>${!this.state.devices.some((d) => !d.local) ? '<p class="device-help">Ouvrez Spotify sur un autre appareil connecté au même compte.</p>' : ""}`;
    this.panel.insertAdjacentHTML(
      "beforeend",
      `<div class="device-jam"><p>Écoutez avec vos amis, partout.</p><button class="pill" data-open-jam ${!this.state.ready || this.busy ? "disabled" : ""}>${this.jamActive ? "Voir le Jam" : "Lancer un Jam"}</button></div>`,
    );
    if (focus)
      [...this.panel.querySelectorAll<HTMLButtonElement>("[data-device]")]
        .find((b) => b.dataset.device === focus)
        ?.focus();
  }
}
