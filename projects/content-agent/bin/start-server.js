import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
dotenv.config();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { openDb } = await import("../lib/db.js");
const { createServer } = await import("../server.js");

const dbPath = process.env.CA_DB_PATH || path.join(root, "data", "content-agent.db");
const styleDir = process.env.CA_STYLE_DIR || path.join(root, "data", "style");
// better-sqlite3 не создаёт родительскую директорию — гарантируем её существование.
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
fs.mkdirSync(styleDir, { recursive: true });

const db = openDb(dbPath);
const port = Number(process.env.CA_PORT || 3002);
const password = process.env.CA_PASSWORD || "change-me";
const secret = process.env.CA_SECRET || "change-me-secret";
const model = process.env.CA_MODEL || "sonnet";

const app = createServer({ db, password, secret, styleDir, model });
app.listen(port, () => console.log(`content-agent server on :${port} (styleDir=${styleDir}, model=${model})`));
