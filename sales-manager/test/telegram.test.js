import { test } from "node:test";
import assert from "node:assert/strict";
import { createTelegramAdapter } from "../lib/telegram.js";

test("createTelegramAdapter не подключается пока не вызван connect()", async () => {
  let connected = false;
  const fakeClient = {
    connect: async () => { connected = true; },
    sendMessage: async () => ({ id: 123 }),
    invoke: async () => null,
  };
  const adapter = createTelegramAdapter({
    sessionLoader: () => "fake-session-string",
    clientFactory: () => fakeClient,
  });
  assert.equal(connected, false);
  await adapter.connect();
  assert.equal(connected, true);
});

test("sendMessage прокидывает typing и вернёт id", async () => {
  const calls = [];
  const fakeClient = {
    connect: async () => {},
    sendMessage: async (peer, opts) => { calls.push({ peer, opts }); return { id: 999 }; },
    invoke: async (req) => { calls.push({ invoke: req.className }); return null; },
  };
  const adapter = createTelegramAdapter({
    sessionLoader: () => "x",
    clientFactory: () => fakeClient,
  });
  await adapter.connect();
  const id = await adapter.sendMessage({ peer: "vasya", text: "hello", typingMs: 0 });
  assert.equal(id, 999);
  assert.equal(calls.some((c) => c.opts?.message === "hello"), true);
});

test("sendMessage кидает classified ошибку при FLOOD_WAIT", async () => {
  const fakeClient = {
    connect: async () => {},
    sendMessage: async () => { const e = new Error(); e.errorMessage = "FLOOD_WAIT_60"; throw e; },
    invoke: async () => null,
  };
  const adapter = createTelegramAdapter({ sessionLoader: () => "x", clientFactory: () => fakeClient });
  await adapter.connect();
  await assert.rejects(() => adapter.sendMessage({ peer: "x", text: "y", typingMs: 0 }), (e) => e.errorMessage === "FLOOD_WAIT_60");
});
