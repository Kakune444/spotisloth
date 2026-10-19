import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collectCards,
  escapeHtml,
  formatTime,
  homeSections,
  imageUrl,
  searchSections,
} from "./catalog.ts";

test("search tracks are retained even when many album hits precede them", () => {
  const albums = Array.from({ length: 100 }, (_, i) => ({
    uri: `spotify:album:A${i}`,
    name: "Album",
  }));
  const result = searchSections({
    data: {
      searchV2: {
        albumsV2: { items: albums },
        tracksV2: {
          items: [
            { item: { data: { uri: "spotify:track:track1", name: "Titre" } } },
          ],
        },
      },
    },
  });
  assert.equal(result[0].name, "Titres");
  assert.equal(result[0].items.length, 1);
  assert.equal(
    result.find((section) => section.name === "Albums")?.items.length,
    20,
  );
});

test("unwraps Pathfinder hits, excludes nested album duplicates and deduplicates URIs", () => {
  const track = {
    item: {
      data: {
        uri: "spotify:track:abc",
        name: "Titre",
        albumOfTrack: { uri: "spotify:album:def", name: "Album" },
        artists: { items: [{ profile: { name: "Artiste" } }] },
      },
    },
  };
  const result = collectCards([
    track,
    track,
    { uri: "spotify:user:private", name: "Ignored" },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].subtitle, "Artiste");
  assert.equal(collectCards([track], 0).length, 0);
});

test("handles missing sections and extracts valid home section items", () => {
  assert.deepEqual(homeSections({}), []);
  const home = {
    data: {
      home: {
        sectionContainer: {
          sections: {
            items: [
              {
                data: { title: { text: "Récents" } },
                sectionItems: {
                  items: [
                    {
                      content: {
                        data: { uri: "spotify:album:abc", name: "Album" },
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    },
  };
  assert.equal(homeSections(home)[0].items[0].name, "Album");
  assert.equal(homeSections(home)[0].name, "Récents");
});

test("remote metadata cannot inject HTML or executable image URLs", () => {
  assert.equal(
    escapeHtml('<img onerror="x">'),
    "&lt;img onerror=&quot;x&quot;&gt;",
  );
  assert.equal(imageUrl("javascript:alert(1)"), "");
  assert.equal(imageUrl("https://secret@example.com/image"), "");
  assert.equal(
    imageUrl("https://i.scdn.co/image/test"),
    "https://i.scdn.co/image/test",
  );
});

test("formats absent and invalid player positions predictably", () => {
  assert.equal(formatTime(61000), "1:01");
  assert.equal(formatTime(-1), "0:00");
  assert.equal(formatTime(Number.NaN), "0:00");
});

test("playlist owner identifiers stay separate from display names", () => {
  const [card] = collectCards({
    uri: "spotify:playlist:example",
    name: "Playlist",
    ownerId: "technical-user-id",
    ownerV2: { data: { name: null } },
  });
  assert.equal(card.ownerId, "technical-user-id");
  assert.equal(card.subtitle, "Playlist");
  assert.ok(!card.subtitle.includes(card.ownerId!));
});
