import assert from "node:assert/strict";
import test from "node:test";
import { JamModel, type JamSession } from "./jam.ts";
const jam = (id: string): JamSession => ({
  id,
  owner: true,
  ownerName: "Alice",
  inviteUrl: "https://open.spotify.com/socialsession/example",
  canInvite: true,
  members: [],
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
test("a late read cannot replace a Jam created in the meantime", async () => {
  const old = deferred<JamSession | null>();
  let reads = 0;
  const model = new JamModel(
    {
      current: () =>
        ++reads === 1 ? old.promise : Promise.resolve(jam("new")),
      create: async () => jam("new"),
      end: async () => {},
    },
    () => {},
  );
  model.setReady(true);
  const reading = model.refresh();
  await model.create();
  old.resolve(null);
  await reading;
  assert.equal(model.session?.id, "new");
});
test("logout invalidates a pending creation without erasing the new account", async () => {
  const pending = deferred<JamSession>();
  const model = new JamModel(
    {
      current: async () => jam("second-account"),
      create: () => pending.promise,
      end: async () => {},
    },
    () => {},
  );
  model.setReady(true);
  const writing = model.create();
  model.setReady(false);
  model.setReady(true);
  await model.refresh();
  pending.resolve(jam("first-account"));
  await writing;
  assert.equal(model.session?.id, "second-account");
});
test("duplicate creation is blocked and uncertain writes are read back only", async () => {
  const pending = deferred<JamSession>();
  let writes = 0,
    reads = 0;
  const model = new JamModel(
    {
      current: async () => {
        ++reads;
        return jam("confirmed");
      },
      create: () => {
        ++writes;
        return pending.promise;
      },
      end: async () => {},
    },
    () => {},
  );
  model.setReady(true);
  const first = model.create();
  assert.equal(await model.create(), false);
  pending.resolve(jam("confirmed"));
  await first;
  assert.equal(writes, 1);
  assert.equal(reads, 1);
});
test("an uncertain creation reconciles the server state without retrying", async () => {
  let writes = 0;
  const model = new JamModel(
    {
      current: async () => jam("created-on-server"),
      create: async () => {
        ++writes;
        throw { code: "UNCERTAIN" };
      },
      end: async () => {},
    },
    () => {},
  );
  model.setReady(true);
  await assert.rejects(model.create());
  assert.equal(model.session?.id, "created-on-server");
  assert.equal(writes, 1);
});
test("ending a stale or guest session never submits a request", async () => {
  let writes = 0;
  const model = new JamModel(
    {
      current: async () => jam("new"),
      create: async () => jam("new"),
      end: async () => {
        ++writes;
      },
    },
    () => {},
  );
  model.setReady(true);
  await model.refresh();
  await assert.rejects(model.end("old"));
  model.session!.owner = false;
  await assert.rejects(model.end("new"));
  assert.equal(writes, 0);
});
test("a burst of session notices coalesces into one follow-up read", async () => {
  const pending = deferred<JamSession | null>();
  let reads = 0;
  const model = new JamModel(
    {
      current: () =>
        ++reads === 1 ? pending.promise : Promise.resolve(jam("current")),
      create: async () => jam("current"),
      end: async () => {},
    },
    () => {},
  );
  model.setReady(true);
  const first = model.refresh();
  await Promise.all([model.refresh(), model.refresh(), model.refresh()]);
  pending.resolve(null);
  await first;
  await Promise.resolve();
  assert.equal(reads, 2);
  assert.equal(model.session?.id, "current");
});
