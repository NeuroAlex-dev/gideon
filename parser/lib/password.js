import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

const SALT_LEN = 16;
const KEY_LEN = 64;
const N = 16384;
const r = 8;
const p = 1;

export function hashPassword(password) {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("password must be a non-empty string");
  }
  const salt = randomBytes(SALT_LEN);
  const key = scryptSync(password, salt, KEY_LEN, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export function verifyPassword(password, stored) {
  if (typeof password !== "string" || typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N_ = Number(parts[1]);
  const r_ = Number(parts[2]);
  const p_ = Number(parts[3]);
  let salt, key;
  try {
    salt = Buffer.from(parts[4], "base64");
    key = Buffer.from(parts[5], "base64");
  } catch {
    return false;
  }
  let derived;
  try {
    derived = scryptSync(password, salt, key.length, { N: N_, r: r_, p: p_ });
  } catch {
    return false;
  }
  if (derived.length !== key.length) return false;
  return timingSafeEqual(derived, key);
}
