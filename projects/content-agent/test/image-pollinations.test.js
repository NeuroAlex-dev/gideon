import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPollinationsUrl, generateImage } from "../lib/image-gen/pollinations.js";

test("buildPollinationsUrl: prompt URL-encoded, параметры заданы", () => {
  const url = buildPollinationsUrl({ prompt: "businessman with AI", width: 1024, height: 1024, model: "flux", seed: 42 });
  assert.match(url, /^https:\/\/image\.pollinations\.ai\/prompt\//);
  assert.match(url, /businessman/);
  assert.match(url, /width=1024/);
  assert.match(url, /height=1024/);
  assert.match(url, /model=flux/);
  assert.match(url, /seed=42/);
  assert.match(url, /nologo=true/);
});

test("buildPollinationsUrl: кириллица кодируется", () => {
  const url = buildPollinationsUrl({ prompt: "робот в офисе" });
  // %D1 — стартовый байт кириллицы в URL-кодировании
  assert.match(url, /%D1|%D0/);
});

test("generateImage: возвращает Buffer + url + contentType", async () => {
  const fakeBuffer = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: (k) => k.toLowerCase() === "content-type" ? "image/png" : null },
    arrayBuffer: async () => fakeBuffer.buffer,
  });
  const r = await generateImage({ prompt: "test", fetch: fakeFetch });
  assert.ok(Buffer.isBuffer(r.buffer));
  assert.equal(r.contentType, "image/png");
  assert.equal(r.buffer[0], 0x89);
  assert.match(r.url, /pollinations/);
});

test("generateImage: HTTP-ошибка → бросает", async () => {
  const fakeFetch = async () => ({ ok: false, status: 500, statusText: "boom" });
  await assert.rejects(() => generateImage({ prompt: "x", fetch: fakeFetch }), /pollinations/i);
});

test("generateImage: не-image content-type → бросает (anti-bot / HTML вместо картинки)", async () => {
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => "text/html" },
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  await assert.rejects(() => generateImage({ prompt: "x", fetch: fakeFetch }), /image/i);
});
