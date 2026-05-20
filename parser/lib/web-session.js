import { createHmac, timingSafeEqual } from "node:crypto";

function base64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

function fromBase64url(str) {
  return Buffer.from(str, "base64url");
}

export function signToken(payload, secret) {
  if (!secret) throw new Error("SESSION_SECRET is required");
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = base64url(payloadJson);
  const sig = createHmac("sha256", secret).update(payloadB64).digest();
  const sigB64 = base64url(sig);
  return `${payloadB64}.${sigB64}`;
}

export function verifyToken(token, secret) {
  if (!token || typeof token !== "string") return null;
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;

  const expectedSig = createHmac("sha256", secret).update(payloadB64).digest();
  let actualSig;
  try {
    actualSig = fromBase64url(sigB64);
  } catch {
    return null;
  }
  if (actualSig.length !== expectedSig.length) return null;
  if (!timingSafeEqual(actualSig, expectedSig)) return null;

  try {
    const payload = JSON.parse(fromBase64url(payloadB64).toString("utf8"));
    return payload;
  } catch {
    return null;
  }
}

export function issueSession(secret) {
  return signToken({ iat: Math.floor(Date.now() / 1000) }, secret);
}
