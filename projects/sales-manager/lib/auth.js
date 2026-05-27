const tokenCache = new Map();
const POSITIVE_TTL_MS = 5 * 60 * 1000;
const NEGATIVE_TTL_MS = 30 * 1000;

async function verifyTokenViaParser(token, parserUrl) {
  try {
    const res = await fetch(`${parserUrl}/api/auth/verify`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok;
  } catch {
    return null;
  }
}

function extractToken(req) {
  const auth = req.headers.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (m) return m[1].trim();
  if (req.headers["x-auth-token"]) return String(req.headers["x-auth-token"]).trim();
  return null;
}

export function authMiddleware({ parserUrl }) {
  if (!parserUrl) throw new Error("parserUrl is required for sales-manager authMiddleware");
  return async (req, res, next) => {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: "unauthorized" });

    const now = Date.now();
    const cached = tokenCache.get(token);
    if (cached && cached.expiresAt > now) {
      if (cached.valid) return next();
      return res.status(401).json({ error: "unauthorized" });
    }

    const result = await verifyTokenViaParser(token, parserUrl);

    if (result === null && cached) {
      if (cached.valid) return next();
      return res.status(401).json({ error: "unauthorized" });
    }
    if (result === null) {
      return res.status(503).json({ error: "auth_unavailable" });
    }

    tokenCache.set(token, {
      valid: result,
      expiresAt: now + (result ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
    });

    if (result) return next();
    return res.status(401).json({ error: "unauthorized" });
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of tokenCache) {
    if (v.expiresAt < now) tokenCache.delete(k);
  }
}, 60 * 1000).unref?.();
