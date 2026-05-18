import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionStore } from "../lib/session.js";

let dir, store;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "parser-session-"));
  store = createSessionStore(join(dir, "session.txt"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("load returns empty string when file missing", () => {
  assert.equal(store.load(), "");
});

test("save then load returns the saved value", () => {
  store.save("abc123");
  assert.equal(store.load(), "abc123");
});

test("save overwrites existing", () => {
  store.save("first");
  store.save("second");
  assert.equal(store.load(), "second");
});

test("clear deletes the file", () => {
  store.save("abc");
  store.clear();
  assert.equal(store.load(), "");
  assert.equal(existsSync(join(dir, "session.txt")), false);
});

test("clear is idempotent when file missing", () => {
  store.clear();
  store.clear();
});

test("isAuthorized true after save", () => {
  store.save("abc");
  assert.equal(store.isAuthorized(), true);
});

test("isAuthorized false after clear", () => {
  store.save("abc");
  store.clear();
  assert.equal(store.isAuthorized(), false);
});
