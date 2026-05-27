import { test } from "node:test";
import assert from "node:assert/strict";
import {
  openDb, addSource, listSources, removeSource,
  addKeyword, listKeywords, removeKeyword,
  createDigest, addDigestItems, getDigest, listDigestItems, getDigestItem, saveDigest,
} from "../lib/db.js";

test("sources CRUD", () => {
  const db = openDb(":memory:");
  const id = addSource(db, { platform: "telegram", ref: "@durov", title: "Durov" });
  assert.equal(listSources(db).length, 1);
  assert.equal(listSources(db, { platform: "telegram" })[0].ref, "@durov");
  removeSource(db, id);
  assert.equal(listSources(db).length, 0);
});

test("keywords CRUD", () => {
  const db = openDb(":memory:");
  const id = addKeyword(db, { term: "gpt", scope: "include" });
  assert.equal(listKeywords(db).length, 1);
  removeKeyword(db, id);
  assert.equal(listKeywords(db).length, 0);
});

test("digest + items + save + getItem", () => {
  const db = openDb(":memory:");
  const dId = createDigest(db, { period: "week", keywords: ["gpt"], platforms: ["telegram"] });
  addDigestItems(db, dId, [
    { platform: "telegram", url: "https://t.me/x/1", title: "T1", summary: "S1", text: "full1", metrics: { views: 10 } },
    { platform: "telegram", url: "https://t.me/x/2", title: "T2", summary: "S2", text: "full2", metrics: { views: 20 } },
  ]);
  assert.equal(listDigestItems(db, dId).length, 2);
  const item = listDigestItems(db, dId)[0];
  assert.equal(getDigestItem(db, item.id).title, "T1");
  assert.equal(getDigest(db, dId).saved, 0);
  saveDigest(db, dId);
  assert.equal(getDigest(db, dId).saved, 1);
});
