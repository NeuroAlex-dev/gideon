import { test } from "node:test";
import assert from "node:assert/strict";
import {
  openDb, getSetting, setSetting,
  createInterview, getInterview, getActiveInterview,
  addInterviewAnswer, addInterviewMaterial, finishInterview, reopenLatestInterview,
  createPost, getPost, updatePostDraft, setPostStatus, getRecentPostDrafts,
} from "../lib/db.js";

test("settings: set и get", () => {
  const db = openDb(":memory:");
  setSetting(db, "vk_token", "abc");
  assert.equal(getSetting(db, "vk_token"), "abc");
  assert.equal(getSetting(db, "missing"), null);
});

test("interview: создание, ответы, материалы, активная сессия", () => {
  const db = openDb(":memory:");
  const id = createInterview(db);
  const iv = getInterview(db, id);
  assert.equal(iv.status, "in_progress");
  assert.deepEqual(JSON.parse(iv.answers_json), []);

  addInterviewAnswer(db, id, "Вопрос 1", "Мой ответ");
  addInterviewMaterial(db, id, "transcript", "текст транскрипта");
  const iv2 = getInterview(db, id);
  assert.equal(JSON.parse(iv2.answers_json).length, 1);
  assert.equal(JSON.parse(iv2.answers_json)[0].transcript, "Мой ответ");
  assert.equal(JSON.parse(iv2.materials_json).length, 1);

  assert.equal(getActiveInterview(db).id, id);
  finishInterview(db, id);
  assert.equal(getInterview(db, id).status, "done");
  assert.equal(getActiveInterview(db), null);
});

test("posts: создание, обновление драфта, статус", () => {
  const db = openDb(":memory:");
  const id = createPost(db, { origin: "prompt", user_prompt: "про выбор нейросети" });
  assert.equal(getPost(db, id).status, "draft");
  updatePostDraft(db, id, "Готовый текст поста");
  assert.equal(getPost(db, id).draft_text, "Готовый текст поста");
  setPostStatus(db, id, "approved");
  const p = getPost(db, id);
  assert.equal(p.status, "approved");
  assert.ok(p.approved_at > 0);
});

test("getRecentPostDrafts: последние N с draft_text, новый-к-старому, exclude по id", () => {
  const db = openDb(":memory:");
  const id1 = createPost(db, { origin: "prompt", user_prompt: "1" });
  updatePostDraft(db, id1, "пост 1");
  const id2 = createPost(db, { origin: "prompt", user_prompt: "2" });
  updatePostDraft(db, id2, "пост 2");
  const id3 = createPost(db, { origin: "prompt", user_prompt: "3" }); // без draft_text
  const idNew = createPost(db, { origin: "prompt", user_prompt: "new" });

  const recent = getRecentPostDrafts(db, { limit: 5, excludeId: idNew });
  assert.deepEqual(recent, ["пост 2", "пост 1"]);
  assert.equal(getRecentPostDrafts(db, { limit: 1, excludeId: idNew })[0], "пост 2");
});

test("reopenLatestInterview: восстанавливает done → in_progress, сохраняет ответы", () => {
  const db = openDb(":memory:");
  const id = createInterview(db);
  addInterviewAnswer(db, id, "Q1", "A1");
  finishInterview(db, id);
  assert.equal(getInterview(db, id).status, "done");

  const reopened = reopenLatestInterview(db);
  assert.ok(reopened);
  assert.equal(reopened.status, "in_progress");
  assert.equal(JSON.parse(reopened.answers_json).length, 1);
  assert.equal(getActiveInterview(db).id, id);
});

test("reopenLatestInterview: null если нет done интервью", () => {
  const db = openDb(":memory:");
  assert.equal(reopenLatestInterview(db), null);
});
