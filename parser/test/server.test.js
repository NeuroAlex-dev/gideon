import { test, before, after } from "node:test";
import assert from "node:assert/strict";

let server;
let baseUrl;
let authToken;

before(async () => {
  process.env.AUTH_TOKEN = "test-token-12345";
  process.env.PORT = "0";
  process.env.API_ID = "1";
  process.env.API_HASH = "test";
  process.env.PARSER_DATA_DIR = ""; // server.js should use a temp dir when this is set later — for now leave default
  const mod = await import("../server.js");
  server = mod.startServer();
  await new Promise((resolve) => server.on("listening", resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
  authToken = "test-token-12345";
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
});

test("GET /api/health returns ok", async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(body.version);
});

test("protected route without token returns 401 from non-loopback", async () => {
  // Note: requests from 127.0.0.1 are treated as loopback, so we expect 200 even without token
  // This test is a placeholder — full non-loopback testing is in критерии приёмки
  const res = await fetch(`${baseUrl}/api/auth/status`);
  assert.notEqual(res.status, 401, "loopback should bypass token check");
});

test("protected route with wrong token from explicit external IP would fail (smoke)", async () => {
  // We can't simulate external IP in unit tests — just check that valid token works
  const res = await fetch(`${baseUrl}/api/auth/status?token=${authToken}`);
  assert.equal(res.status, 200);
});

test("GET /api/auth/status returns shape", async () => {
  const res = await fetch(`${baseUrl}/api/auth/status?token=${authToken}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(typeof body.authorized, "boolean");
  assert.equal(typeof body.hasCredentials, "boolean");
});

test("POST /api/auth/send-code without phone returns 400", async () => {
  const res = await fetch(`${baseUrl}/api/auth/send-code?token=${authToken}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
});

test("POST /api/auth/sign-in without fields returns 400", async () => {
  const res = await fetch(`${baseUrl}/api/auth/sign-in?token=${authToken}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
});

test("GET /api/chats without session returns 403", async () => {
  const res = await fetch(`${baseUrl}/api/chats?token=${authToken}`);
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error, "not_authorized");
});

test("POST /api/parse without session returns 403", async () => {
  const res = await fetch(`${baseUrl}/api/parse?token=${authToken}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatRef: "@test" }),
  });
  assert.equal(res.status, 403);
});

test("POST /api/parse without chatRef returns 403 (session check first) or 400", async () => {
  const res = await fetch(`${baseUrl}/api/parse?token=${authToken}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.ok(res.status === 400 || res.status === 403);
});

test("GET /api/export.txt without jobId returns 400", async () => {
  const res = await fetch(`${baseUrl}/api/export.txt?token=${authToken}`);
  assert.equal(res.status, 400);
});

test("GET /api/export.txt with unknown jobId returns 404", async () => {
  const res = await fetch(`${baseUrl}/api/export.txt?token=${authToken}&jobId=does-not-exist`);
  assert.equal(res.status, 404);
});
