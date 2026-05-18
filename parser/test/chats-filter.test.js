import { test } from "node:test";
import assert from "node:assert/strict";
import { filterAndSortGroups } from "../lib/chats.js";

const dialog = (overrides) => ({
  isGroup: false, isChannel: false, isUser: false,
  entity: { participantsCount: 0, id: 1, title: "", username: null, megagroup: false },
  ...overrides,
  entity: { participantsCount: 0, id: 1, title: "", username: null, megagroup: false, ...overrides.entity },
});

test("excludes private chats", () => {
  const result = filterAndSortGroups([
    dialog({ isUser: true, entity: { id: 1, title: "User", participantsCount: 0 } }),
  ]);
  assert.equal(result.length, 0);
});

test("excludes channels (non-megagroup)", () => {
  const result = filterAndSortGroups([
    dialog({ isChannel: true, entity: { id: 1, title: "News", participantsCount: 1000, megagroup: false } }),
  ]);
  assert.equal(result.length, 0);
});

test("includes basic groups", () => {
  const result = filterAndSortGroups([
    dialog({ isGroup: true, entity: { id: 1, title: "Friends", participantsCount: 5 } }),
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].title, "Friends");
  assert.equal(result[0].type, "group");
});

test("includes supergroups (megagroup channels)", () => {
  const result = filterAndSortGroups([
    dialog({ isChannel: true, entity: { id: 1, title: "Course", participantsCount: 1247, megagroup: true, username: "course" } }),
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].type, "supergroup");
  assert.equal(result[0].username, "course");
});

test("sorts by participants desc", () => {
  const result = filterAndSortGroups([
    dialog({ isGroup: true, entity: { id: 1, title: "Small", participantsCount: 5 } }),
    dialog({ isChannel: true, entity: { id: 2, title: "Big", participantsCount: 1000, megagroup: true } }),
    dialog({ isGroup: true, entity: { id: 3, title: "Mid", participantsCount: 100 } }),
  ]);
  assert.deepEqual(result.map(c => c.title), ["Big", "Mid", "Small"]);
});

test("missing participantsCount treated as 0", () => {
  const result = filterAndSortGroups([
    dialog({ isGroup: true, entity: { id: 1, title: "Unknown", participantsCount: undefined } }),
  ]);
  assert.equal(result[0].membersCount, 0);
});
