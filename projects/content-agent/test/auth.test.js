import { test } from "node:test";
import assert from "node:assert/strict";
import { makeToken, authMiddleware } from "../lib/auth.js";

test("makeToken детерминирован и зависит от секрета и пароля", () => {
  const a = makeToken("s", "p");
  assert.equal(a, makeToken("s", "p"));
  assert.notEqual(a, makeToken("s2", "p"));
  assert.notEqual(a, makeToken("s", "p2"));
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("authMiddleware пускает с верным токеном, отбивает без", () => {
  const mw = authMiddleware({ password: "p", secret: "s" });
  const token = makeToken("s", "p");

  function run(headers) {
    let statusCode = null, nexted = false;
    const req = { headers };
    const res = { status(c) { statusCode = c; return { json() {} }; } };
    mw(req, res, () => { nexted = true; });
    return { statusCode, nexted };
  }

  assert.equal(run({ "x-auth-token": token }).nexted, true);
  assert.equal(run({}).statusCode, 401);
  assert.equal(run({ "x-auth-token": "wrong" }).statusCode, 401);
});
