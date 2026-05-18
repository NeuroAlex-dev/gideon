import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeChatRef } from "../lib/chatref.js";

test("username with @", () => {
  assert.deepEqual(normalizeChatRef("@vibe_course"), { type: "username", value: "vibe_course" });
});

test("plain username without @", () => {
  assert.deepEqual(normalizeChatRef("vibe_course"), { type: "username", value: "vibe_course" });
});

test("t.me link", () => {
  assert.deepEqual(normalizeChatRef("https://t.me/vibe_course"), { type: "username", value: "vibe_course" });
});

test("t.me/joinchat invite link", () => {
  assert.deepEqual(normalizeChatRef("https://t.me/joinchat/AbCdEf"), { type: "invite", value: "AbCdEf" });
});

test("t.me/+ invite link", () => {
  assert.deepEqual(normalizeChatRef("https://t.me/+AbCdEf"), { type: "invite", value: "AbCdEf" });
});

test("numeric chat id", () => {
  assert.deepEqual(normalizeChatRef("-1001234567890"), { type: "id", value: "-1001234567890" });
});

test("trims whitespace", () => {
  assert.deepEqual(normalizeChatRef("  @vibe_course  "), { type: "username", value: "vibe_course" });
});

test("throws on empty", () => {
  assert.throws(() => normalizeChatRef(""), /empty/i);
});

test("throws on invalid", () => {
  assert.throws(() => normalizeChatRef("not a ref!"), /invalid/i);
});

test("throws on null", () => {
  assert.throws(() => normalizeChatRef(null), /empty/i);
});
