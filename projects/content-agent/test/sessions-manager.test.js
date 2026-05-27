import { test } from "node:test";
import assert from "node:assert/strict";
import { listAccounts, getActiveAccountId } from "../lib/sessions-manager.js";

test("listAccounts возвращает массив (из parser/data или пусто)", () => {
  const acc = listAccounts();
  assert.ok(Array.isArray(acc));
});

test("getActiveAccountId возвращает строку или null", () => {
  const id = getActiveAccountId();
  assert.ok(id === null || typeof id === "string");
});
