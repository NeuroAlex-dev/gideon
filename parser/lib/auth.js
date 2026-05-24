import { Api } from "telegram";
import { computeCheck } from "telegram/Password.js";
import { ensureConnected, persistSession, getClient, resetClient } from "./telegram.js";

export async function sendCode(phone) {
  const c = await ensureConnected();
  return sendCodeOnClient(c, phone);
}

export async function sendCodeOnClient(client, phone) {
  if (!client.connected) {
    await client.connect();
  }
  const result = await client.invoke(
    new Api.auth.SendCode({
      phoneNumber: phone,
      apiId: client.apiId,
      apiHash: client.apiHash,
      settings: new Api.CodeSettings({
        allowFlashcall: true,
        currentNumber: false,
        allowAppHash: true,
        allowMissedCall: true,
        allowFirebase: false,
      }),
    })
  );
  return {
    phoneCodeHash: result.phoneCodeHash,
    timeout: result.timeout ?? 60,
    type: result.type?.className || null,
    nextType: result.nextType?.className || null,
  };
}

export async function resendCodeOnClient(client, { phone, phoneCodeHash }) {
  if (!client.connected) {
    await client.connect();
  }
  const result = await client.invoke(
    new Api.auth.ResendCode({
      phoneNumber: phone,
      phoneCodeHash: phoneCodeHash,
    })
  );
  return {
    phoneCodeHash: result.phoneCodeHash,
    timeout: result.timeout ?? 60,
    type: result.type?.className || null,
    nextType: result.nextType?.className || null,
  };
}

export async function signIn({ phone, phoneCodeHash, code, password }) {
  const c = await ensureConnected();
  return signInOnClient(c, { phone, phoneCodeHash, code, password, persistTo: "active" });
}

export async function signInOnClient(client, { phone, phoneCodeHash, code, password, persistTo }) {
  if (!client.connected) {
    await client.connect();
  }
  try {
    const res = await client.invoke(
      new Api.auth.SignIn({
        phoneNumber: phone,
        phoneCodeHash,
        phoneCode: code,
      })
    );
    if (persistTo === "active") await persistSession();
    return { ok: true, user: extractUser(res.user) };
  } catch (e) {
    if (e?.errorMessage === "SESSION_PASSWORD_NEEDED") {
      if (!password) {
        const err = new Error("2FA password required");
        err.code = "2fa_required";
        throw err;
      }
      return await checkPasswordOnClient(client, password, persistTo);
    }
    throw e;
  }
}

async function checkPasswordOnClient(client, password, persistTo) {
  const pwd = await client.invoke(new Api.account.GetPassword());
  const check = await computeCheck(pwd, password);
  const res = await client.invoke(new Api.auth.CheckPassword({ password: check }));
  if (persistTo === "active") await persistSession();
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

export { extractUser };
