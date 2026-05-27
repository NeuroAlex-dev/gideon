import { createHmac, timingSafeEqual } from "node:crypto";

export function makeToken(secret, password) {
  return createHmac("sha256", secret).update(password).digest("hex");
}

function extractToken(req) {
  const auth = req.headers.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (m) return m[1].trim();
  if (req.headers["x-auth-token"]) return String(req.headers["x-auth-token"]).trim();
  return null;
}

function safeEqual(a, b) {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function authMiddleware({ password, secret }) {
  const expected = makeToken(secret, password);
  return (req, res, next) => {
    const token = extractToken(req);
    if (token && safeEqual(token, expected)) return next();
    return res.status(401).json({ error: "unauthorized" });
  };
}
