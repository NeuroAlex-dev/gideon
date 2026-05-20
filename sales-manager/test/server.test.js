import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../server.js";
import { openDb, addMessage, getOrCreateConversation, createDraft } from "../lib/db.js";
import { makeToken } from "../lib/auth.js";

async function setup() {
  const db = openDb(":memory:");
  const password = "p", secret = "s";
  const app = createServer({ db, password, secret });
  const server = app.listen(0);
  const port = server.address().port;
  const token = makeToken(secret, password);
  const req = (method, path, body, opts = {}) => fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(opts.noAuth ? {} : { "x-auth-token": token }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const close = () => server.close();
  return { req, close, db };
}

test("GET /api/health возвращает ok без авторизации", async () => {
  const { req, close } = await setup();
  const res = await req("GET", "/api/health", null, { noAuth: true });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
  close();
});

test("защищённый эндпоинт без токена даёт 401", async () => {
  const { req, close } = await setup();
  const res = await req("GET", "/api/campaigns", null, { noAuth: true });
  assert.equal(res.status, 401);
  close();
});

test("POST /api/auth с правильным паролем возвращает токен", async () => {
  const { req, close } = await setup();
  const res = await fetch(`http://127.0.0.1:${0}`, { method: "HEAD" }).catch(() => null); // not used
  const r2 = await req("POST", "/api/auth", { password: "p" }, { noAuth: true });
  assert.equal(r2.status, 200);
  const j = await r2.json();
  assert.equal(j.token, makeToken("s", "p"));
  close();
});

test("POST /api/auth с неправильным паролем → 401", async () => {
  const { req, close } = await setup();
  const r = await req("POST", "/api/auth", { password: "wrong" }, { noAuth: true });
  assert.equal(r.status, 401);
  close();
});

test("POST /api/campaigns создаёт и возвращает", async () => {
  const { req, close } = await setup();
  const res = await req("POST", "/api/campaigns", { name: "Test", offer_text: "X" });
  assert.equal(res.status, 201);
  const c = await res.json();
  assert.equal(c.name, "Test");
  assert.equal(c.status, "draft");
  close();
});

test("PUT /api/campaigns/:id правит поля", async () => {
  const { req, close } = await setup();
  const created = await (await req("POST", "/api/campaigns", { name: "T" })).json();
  const res = await req("PUT", `/api/campaigns/${created.id}`, { tone: "формально" });
  assert.equal(res.status, 200);
  const got = await (await req("GET", `/api/campaigns/${created.id}`)).json();
  assert.equal(got.tone, "формально");
  close();
});

test("DELETE архивирует, не удаляет физически", async () => {
  const { req, close } = await setup();
  const c = await (await req("POST", "/api/campaigns", { name: "T" })).json();
  const del = await req("DELETE", `/api/campaigns/${c.id}`);
  assert.equal(del.status, 204);
  const list = await (await req("GET", "/api/campaigns")).json();
  assert.equal(list.length, 0);
  close();
});

test("POST /api/campaigns/:id/leads добавляет лидов", async () => {
  const { req, close } = await setup();
  const c = await (await req("POST", "/api/campaigns", { name: "C" })).json();
  const res = await req("POST", `/api/campaigns/${c.id}/leads`, { leads: [{ tg_username: "v1" }, { tg_username: "v2" }] });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.inserted, 2);
  const list = await (await req("GET", `/api/campaigns/${c.id}/leads`)).json();
  assert.equal(list.length, 2);
  close();
});

test("POST start/pause меняет status", async () => {
  const { req, close } = await setup();
  const c = await (await req("POST", "/api/campaigns", { name: "C" })).json();
  await req("POST", `/api/campaigns/${c.id}/start`);
  let got = await (await req("GET", `/api/campaigns/${c.id}`)).json();
  assert.equal(got.status, "running");
  await req("POST", `/api/campaigns/${c.id}/pause`);
  got = await (await req("GET", `/api/campaigns/${c.id}`)).json();
  assert.equal(got.status, "paused");
  close();
});

test("GET /api/campaigns/:id/stats", async () => {
  const { req, close } = await setup();
  const c = await (await req("POST", "/api/campaigns", { name: "C" })).json();
  await req("POST", `/api/campaigns/${c.id}/leads`, { leads: [{ tg_username: "v" }] });
  const res = await req("GET", `/api/campaigns/${c.id}/stats`);
  assert.equal(res.status, 200);
  const s = await res.json();
  assert.equal(s.leads_total, 1);
  close();
});

test("POST /api/drafts/:id/approve меняет статус", async () => {
  const { req, close, db } = await setup();
  const c = await (await req("POST", "/api/campaigns", { name: "C" })).json();
  await req("POST", `/api/campaigns/${c.id}/leads`, { leads: [{ tg_user_id: 1, tg_username: "v" }] });
  const lead = db.prepare("SELECT id FROM leads").get();
  const conv = getOrCreateConversation(db, lead.id, c.id);
  const mid = addMessage(db, { conversation_id: conv.id, role: "outbound", body: "draft", status: "pending_approval" });
  const did = createDraft(db, mid);
  const res = await req("POST", `/api/drafts/${did}/approve`);
  assert.equal(res.status, 200);
  const fresh = db.prepare("SELECT status FROM drafts WHERE id = ?").get(did);
  assert.equal(fresh.status, "approved");
  close();
});

test("GET /api/conversations/:lead_id возвращает сообщения", async () => {
  const { req, close, db } = await setup();
  const c = await (await req("POST", "/api/campaigns", { name: "C" })).json();
  await req("POST", `/api/campaigns/${c.id}/leads`, { leads: [{ tg_username: "v" }] });
  const lead = db.prepare("SELECT id FROM leads").get();
  const conv = getOrCreateConversation(db, lead.id, c.id);
  addMessage(db, { conversation_id: conv.id, role: "outbound", body: "hi", status: "sent" });
  const res = await req("GET", `/api/conversations/${lead.id}`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.messages.length, 1);
  assert.equal(data.lead.id, lead.id);
  close();
});
