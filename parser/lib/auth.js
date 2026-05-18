import { Api } from "telegram";
import { computeCheck } from "telegram/Password.js";
import { ensureConnected, persistSession, getClient, resetClient } from "./telegram.js";

export async function sendCode(phone) {
  const c = await ensureConnected();
  const result = await c.invoke(
    new Api.auth.SendCode({
      phoneNumber: phone,
      apiId: c.apiId,
      apiHash: c.apiHash,
      settings: new Api.CodeSettings({}),
    })
  );
  return {
    phoneCodeHash: result.phoneCodeHash,
    timeout: result.timeout ?? 60,
  };
}

export async function signIn({ phone, phoneCodeHash, code, password }) {
  const c = await ensureConnected();

  try {
    const res = await c.invoke(
      new Api.auth.SignIn({
        phoneNumber: phone,
        phoneCodeHash,
        phoneCode: code,
      })
    );
    await persistSession();
    return { ok: true, user: extractUser(res.user) };
  } catch (e) {
    if (e?.errorMessage === "SESSION_PASSWORD_NEEDED") {
      if (!password) {
        const err = new Error("2FA password required");
        err.code = "2fa_required";
        throw err;
      }
      return await checkPassword(password);
    }
    throw e;
  }
}

async function checkPassword(password) {
  const c = getClient();
  const pwd = await c.invoke(new Api.account.GetPassword());
  const check = await computeCheck(pwd, password);
  const res = await c.invoke(new Api.auth.CheckPassword({ password: check }));
  await persistSession();
  return { ok: true, user: extractUser(res.user) };
}

export async function logout(sessionStore) {
  const c = getClient();
  try {
    if (c.connected) {
      await c.invoke(new Api.auth.LogOut());
      await c.disconnect();
    }
  } catch {}
  sessionStore.clear();
  resetClient();
}

function extractUser(u) {
  if (!u) return null;
  return {
    id: String(u.id),
    username: u.username || null,
    firstName: u.firstName || null,
  };
}
