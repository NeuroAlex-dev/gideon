import crypto from "node:crypto";

export function makeToken(secret, password) {
  return crypto.createHmac("sha256", secret).update(password).digest("hex");
}

export function authMiddleware({ secret, password }) {
  const valid = makeToken(secret, password);
  return (req, res, next) => {
    const t = req.headers["x-auth-token"] || (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!t || t !== valid) return res.status(401).json({ error: "unauthorized" });
    next();
  };
}
