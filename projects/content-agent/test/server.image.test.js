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
  const styleDir = fs.mkdtempSync(path.join(os.tmpdir(), "img-style-"));
  const imagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "img-out-"));
  const runner = async () => JSON.stringify({ result: "EN: cyber business prompt no text" });
  const imageGen = async () => ({ buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]), url: "https://fake-pollinations/img", contentType: "image/png" });
  const app = createServer({ db, password, secret, styleDir, runner, model: "sonnet", imageGen, imagesDir, vkValidate: async () => true, ytValidate: async () => true });
  const server = app.listen(0);
  const port = server.address().port;
  const token = makeToken(secret, password);
  const req = (m, p, b) => fetch(`http://127.0.0.1:${port}${p}`, { method: m, headers: { "content-type": "application/json", "x-auth-token": token }, body: b ? JSON.stringify(b) : undefined });
  return { req, close: () => server.close(), db, imagesDir };
}

test("POST /api/posts/:id/image: 404 на несуществующий пост", async () => {
  const { req, close } = setup();
  const r = await req("POST", "/api/posts/9999/image", {});
  assert.equal(r.status, 404);
  close();
});

test("POST /api/posts/:id/image: 400 если у поста нет draft_text", async () => {
  const { req, close, db } = setup();
  // создаём пост без draft_text
  db.prepare("INSERT INTO posts (origin, user_prompt, status, created_at) VALUES (?, ?, 'draft', ?)").run("prompt", "x", Date.now());
  const id = db.prepare("SELECT id FROM posts").get().id;
  const r = await req("POST", `/api/posts/${id}/image`, {});
  assert.equal(r.status, 400);
  close();
});

test("POST /api/posts/:id/image: создаёт файл, возвращает path + prompt + seed", async () => {
  const { req, close, imagesDir } = setup();
  // Создаём пост через API
  const p = await (await req("POST", "/api/posts", { user_prompt: "тест" })).json();
  const r = await (await req("POST", `/api/posts/${p.id}/image`, { seed: 12345 })).json();
  assert.equal(r.post_id, p.id);
  assert.equal(r.seed, 12345);
  assert.match(r.prompt, /cyber|business|prompt/);
  assert.ok(fs.existsSync(r.path));
  // PNG magic bytes
  const buf = fs.readFileSync(r.path);
  assert.equal(buf[0], 0x89);
  assert.equal(buf[1], 0x50);
  close();
});

test("POST /api/posts/:id/image: разный seed каждый раз если не задан", async () => {
  const { req, close } = setup();
  const p = await (await req("POST", "/api/posts", { user_prompt: "тест" })).json();
  const r1 = await (await req("POST", `/api/posts/${p.id}/image`, {})).json();
  const r2 = await (await req("POST", `/api/posts/${p.id}/image`, {})).json();
  assert.notEqual(r1.seed, r2.seed);
  close();
});
