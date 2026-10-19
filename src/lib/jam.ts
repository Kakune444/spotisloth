export type JamMember = {
  id: string;
  name: string;
  image: string;
  currentUser: boolean;
  host: boolean;
};
export type JamSession = {
  id: string;
  owner: boolean;
  ownerName: string;
  inviteUrl: string;
  canInvite: boolean;
  members: JamMember[];
};
export type JamApi = {
  current(): Promise<JamSession | null>;
  create(): Promise<JamSession>;
  end(id: string): Promise<void>;
};

/** Reads are invalidated by mutations and account changes; writes are never retried. */
export class JamModel {
  session: JamSession | null = null;
  ready = false;
  loaded = false;
  loading = false;
  busy = false;
  error: unknown = null;
  private epoch = 0;
  private read = 0;
  private dirty = false;
  private api: JamApi;
  private changed: () => void;
  constructor(api: JamApi, changed: () => void) {
    this.api = api;
    this.changed = changed;
  }

  setReady(ready: boolean): void {
    if (ready === this.ready) return;
    ++this.epoch;
    ++this.read;
    this.ready = ready;
    this.session = null;
    this.loaded = this.loading = this.busy = this.dirty = false;
    this.error = null;
    this.changed();
  }

  async refresh(): Promise<void> {
    if (!this.ready) return;
    if (this.busy || this.loading) {
      this.dirty = true;
      return;
    }
    const epoch = this.epoch,
      read = ++this.read;
    this.loading = true;
    this.dirty = false;
    this.changed();
    try {
      const session = await this.api.current();
      if (epoch !== this.epoch || read !== this.read) return;
      this.session = session;
      this.loaded = true;
      this.error = null;
    } catch (error) {
      if (epoch === this.epoch && read === this.read) this.error = error;
    } finally {
      if (epoch === this.epoch && read === this.read) {
        this.loading = false;
        this.changed();
        if (this.dirty) void this.refresh();
      }
    }
  }

  async create(): Promise<boolean> {
    if (!this.ready || this.busy) return false;
    return this.mutate(() => this.api.create());
  }

  async end(id: string): Promise<boolean> {
    if (!this.ready || this.busy) return false;
    if (this.session?.id !== id || !this.session.owner)
      throw {
        code: "CONFLICT",
        message: "Le Jam a changé. Vérifie la session avant de recommencer.",
      };
    return this.mutate(async () => {
      await this.api.end(id);
      return null;
    });
  }

  private async mutate(
    operation: () => Promise<JamSession | null>,
  ): Promise<boolean> {
    const epoch = this.epoch;
    ++this.read;
    this.loading = false;
    this.busy = true;
    this.error = null;
    this.changed();
    // The operation result is applied only if its account is still current.
    const previous = this.session;
    try {
      const result = await operation();
      if (epoch !== this.epoch) return false;
      this.session = result;
      this.loaded = true;
      return true;
    } catch (error) {
      if (epoch !== this.epoch) return false;
      this.session = previous;
      this.error = error;
      throw error;
    } finally {
      if (epoch === this.epoch) {
        this.busy = false;
        this.changed();
        // Resolve lost acknowledgements by reading, without repeating the write.
        await this.refresh();
      }
    }
  }
}
