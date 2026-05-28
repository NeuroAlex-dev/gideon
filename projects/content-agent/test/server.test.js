import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { createServer } from "../server.js";
import { openDb } from "../lib/db.js";
import { makeToken } from "../lib/auth.js";

function setup() {
  const db = openDb(":memory:");
  const password = "p", secret = "s";
  const styleDir = fs.mkdtempSync(path.join(os.tmpdir(), "srv-style-"));
  const runner = async (_args, payload) => JSON.stringify({ result: `OUT:${payload.slice(0, 20)}` });
  // permissive валидаторы — чтобы тесты Phase 1 не дёргали реальные VK/YouTube API
  const vkValidate = async () => true;
  const ytValidate = async () => true;
  const app = createServer({ db, password, secret, styleDir, runner, model: "sonnet", vkValidate, ytValidate });
  const server = app.listen(0);
  const port = server.address().port;
  const token = makeToken(secret, password);
  const req = (method, p, body, opts = {}) => fetch(`http://127.0.0.1:${port}${p}`, {
    method,
    headers: { "content-type": "application/json", ...(opts.noAuth ? {} : { "x-auth-token": token }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { req, close: () => server.close(), db, styleDir };
}

test("GET /api/health без авторизации", async () => {
  const { req, close } = setup();
  const res = await req("GET", "/api/health", null, { noAuth: true });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
  close();
});

test("защищённый эндпоинт без токена → 401", async () => {
  const { req, close } = setup();
  const res = await req("GET", "/api/style/status", null, { noAuth: true });
  assert.equal(res.status, 401);
  close();
});

test("POST /api/auth с верным паролем → токен", async () => {
  const { req, close } = setup();
  const r = await req("POST", "/api/auth", { password: "p" }, { noAuth: true });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).token, makeToken("s", "p"));
  close();
});

test("интервью: start → 10 ответов → finish пишет 5 файлов", async () => {
  const { req, close, styleDir } = setup();
  const start = await (await req("POST", "/api/style/interview/start")).json();
  assert.equal(start.step, 0);
  assert.ok(start.question.length > 0);
  assert.equal(start.total, 10);

  let last;
  for (let i = 0; i < 10; i++) {
    last = await (await req("POST", "/api/style/interview/answer", { transcript: `ответ ${i}` })).json();
  }
  assert.equal(last.questions_done, true);

  const fin = await (await req("POST", "/api/style/interview/finish")).json();
  assert.equal(fin.files.length, 5);
  assert.ok(fs.existsSync(path.join(styleDir, "tone-of-voice.md")));

  const status = await (await req("GET", "/api/style/status")).json();
  assert.equal(status.present, true);
  close();
});

test("посты: создать драфт, вариант, одобрить", async () => {
  const { req, close } = setup();
  const created = await (await req("POST", "/api/posts", { user_prompt: "про RAG" })).json();
  assert.ok(created.id);
  assert.ok(created.draft_text.startsWith("OUT:"));

  const variant = await (await req("POST", `/api/posts/${created.id}/variant`, { mode: "humor" })).json();
  assert.ok(variant.draft_text.startsWith("OUT:"));

  const appr = await (await req("POST", `/api/posts/${created.id}/approve`)).json();
  assert.equal(appr.ok, true);
  close();
});

test("settings: PUT и GET", async () => {
  const { req, close } = setup();
  await req("PUT", "/api/settings", { key: "vk_token", value: "xyz" });
  const got = await (await req("GET", "/api/settings")).json();
  assert.equal(got.vk_token, "xyz");
  close();
});
