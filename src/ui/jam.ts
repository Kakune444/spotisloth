import { invoke } from "@tauri-apps/api/core";
import qrcode from "qrcode-generator";
import { escapeHtml as esc, imageUrl } from "../lib/catalog.ts";
import { JamModel, type JamSession } from "../lib/jam.ts";

export class JamView {
  readonly model: JamModel;
  private open = false;
  private dialog: HTMLDialogElement | null = null;
  private qrUrl = "";
  private qrSvg = "";
  private signature = "";
  constructor(
    private root: HTMLElement,
    private heading: HTMLElement,
    private presence: (active: boolean) => void,
    private error: (error: unknown) => void,
  ) {
    this.model = new JamModel(
      {
        current: () => invoke<JamSession | null>("get_jam"),
        create: () => invoke<JamSession>("create_jam"),
        end: (sessionId) => invoke("end_jam", { sessionId }),
      },
      () => this.render(),
    );
    root.addEventListener("click", (event) => {
      const action = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-jam]",
      )?.dataset.jam;
      if (action === "close") this.close();
      if (action === "create") void this.create();
      if (action === "retry") void this.model.refresh();
      if (action === "end") this.confirmEnd();
      if (action === "copy") void this.copy();
    });
    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.close();
    });
  }

  setReady(ready: boolean): void {
    this.model.setReady(ready);
    if (!ready) {
      this.close();
      this.dialog?.close();
      this.qrUrl = this.qrSvg = "";
    } else void this.model.refresh();
  }
  notice(): void {
    void this.model.refresh();
  }
  async show(create = false): Promise<void> {
    this.open = true;
    this.root.hidden = false;
    document.body.classList.add("jam-open");
    this.heading.textContent = "File d’attente et Jam";
    this.render();
    if (create) await this.create();
    else await this.model.refresh();
    this.root.querySelector<HTMLButtonElement>("[data-jam=close]")?.focus();
  }
  close(): void {
    this.open = false;
    this.root.hidden = true;
    document.body.classList.remove("jam-open");
    this.heading.textContent = "En cours de lecture";
  }

  private async create(): Promise<void> {
    try {
      await this.model.create();
    } catch (error) {
      this.error(error);
    }
  }

  private async copy(): Promise<void> {
    const session = this.model.session;
    if (!session?.canInvite || !session.inviteUrl) return;
    try {
      await navigator.clipboard.writeText(session.inviteUrl);
      const output = this.root.querySelector<HTMLElement>(".jam-copy-status");
      if (output) output.textContent = "Lien copié dans le presse-papiers";
    } catch {
      const input =
        this.root.querySelector<HTMLInputElement>(".jam-invite-url");
      input?.focus();
      input?.select();
      this.error({ message: "Sélectionne le lien et copie-le avec Ctrl+C." });
    }
  }

  private confirmEnd(): void {
    const session = this.model.session;
    if (!session?.owner || this.model.busy || this.dialog) return;
    const id = session.id;
    const dialog = document.createElement("dialog");
    dialog.className = "playlist-dialog jam-end-dialog";
    dialog.setAttribute("aria-labelledby", "jam-end-title");
    dialog.innerHTML =
      '<h2 id="jam-end-title">Mettre fin au Jam pour tout le monde ?</h2><p>Vous n’écouterez plus de musique ensemble.</p><p class="dialog-error" role="alert" hidden></p><div class="dialog-actions"><button class="pill" data-cancel>Annuler</button><button class="pill jam-danger" data-confirm>Terminer le Jam</button></div>';
    document.body.append(dialog);
    this.dialog = dialog;
    dialog
      .querySelector("[data-cancel]")!
      .addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => {
      dialog.remove();
      this.dialog = null;
    });
    dialog
      .querySelector("[data-confirm]")!
      .addEventListener("click", async () => {
        dialog.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
          b.disabled = true;
        });
        try {
          if (await this.model.end(id)) dialog.close();
        } catch (error) {
          const output = dialog.querySelector<HTMLElement>(".dialog-error")!;
          output.textContent =
            (error as { message?: string }).message ||
            "Impossible de terminer le Jam. Vérifie son état et réessaie.";
          output.hidden = false;
        } finally {
          dialog.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
            b.disabled = false;
          });
        }
      });
    dialog.addEventListener("cancel", (event) => {
      if (this.model.busy) event.preventDefault();
    });
    dialog.showModal();
  }

  private render(): void {
    const model = this.model,
      session = model.session;
    this.presence(!!session);
    if (!this.open) return;
    const signature = JSON.stringify([
      session,
      model.ready,
      model.busy,
      model.loaded,
      model.error,
    ]);
    if (signature === this.signature) return;
    this.signature = signature;
    const focused = (document.activeElement as HTMLElement)?.dataset.jam;
    const disabled = !model.ready || model.busy || !!model.error;
    let content: string;
    if (session) {
      if (session.inviteUrl !== this.qrUrl) {
        this.qrUrl = session.inviteUrl;
        this.qrSvg = "";
        if (session.canInvite && session.inviteUrl) {
          const qr = qrcode(0, "M");
          qr.addData(session.inviteUrl);
          qr.make();
          this.qrSvg = qr.createSvgTag({ scalable: true, margin: 4 });
        }
      }
      content = `<h3>Jam de ${esc(session.ownerName)}</h3>
        <div class="jam-members" aria-label="Participants au Jam">${session.members
          .map((member) => {
            const image = imageUrl(member.image);
            return `<div class="jam-member">${image ? `<img src="${esc(image)}" alt="" referrerpolicy="no-referrer"/>` : '<span class="jam-avatar">♪</span>'}<span>${esc(member.name)}${member.currentUser ? " · Vous" : ""}<small>${member.host ? "Hôte" : "Participant"}</small></span></div>`;
          })
          .join("")}</div>
        ${session.canInvite && session.inviteUrl ? `<div class="jam-invite"><strong>Invitez des personnes à rejoindre votre Jam</strong><p>Partagez le lien ou demandez-leur de scanner le QR code.</p><button class="pill white" data-jam="copy" ${disabled ? "disabled" : ""}>Copier le lien</button><div class="jam-qr" role="img" aria-label="QR code d’invitation au Jam">${this.qrSvg}</div><input class="jam-invite-url" aria-label="Lien d’invitation au Jam" readonly value="${esc(session.inviteUrl)}"/><p class="jam-copy-status" role="status"></p></div>` : session.canInvite ? '<p class="jam-help">Le lien d’invitation est indisponible.</p><button class="pill" data-jam="retry">Réessayer</button>' : ""}
        ${session.owner ? `<button class="pill jam-end" data-jam="end" ${disabled ? "disabled" : ""}>Terminer le Jam</button>` : '<p class="jam-help">Ce Jam est animé par une autre personne.</p>'}`;
    } else if (!model.loaded && !model.error)
      content = '<p class="jam-help" role="status">Chargement du Jam…</p>';
    else
      content = `<h3>Écoutez ensemble</h3><p class="jam-help">Invitez vos proches à écouter et à ajouter des titres à la file d’attente.</p><button class="pill white" data-jam="create" ${disabled ? "disabled" : ""}>Lancer un Jam</button><p class="jam-help">Spotify Premium est nécessaire pour lancer un Jam.</p>`;
    const error = model.error as { message?: string } | null;
    this.root.innerHTML = `<div class="jam-panel-heading"><h2>Jam</h2><button class="icon-button" data-jam="close" aria-label="Fermer le panneau Jam">×</button></div>${content}${error ? `<p class="jam-error" role="alert">${esc(error.message || "Impossible de vérifier le Jam.")}</p><button class="pill" data-jam="retry" ${model.busy ? "disabled" : ""}>Réessayer</button>` : ""}`;
    if (focused)
      this.root
        .querySelector<HTMLButtonElement>(`[data-jam="${focused}"]`)
        ?.focus();
  }
}
