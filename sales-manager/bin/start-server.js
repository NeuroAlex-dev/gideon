import dotenv from "dotenv";
dotenv.config();
import { openDb } from "../lib/db.js";
import { createServer } from "../server.js";

const db = openDb(process.env.SM_DB_PATH || "./data/sales-manager.db");
const password = process.env.SM_PASSWORD || "change-me";
const secret = process.env.SM_SECRET || "change-me-secret";
const port = Number(process.env.SM_PORT || 3001);
const app = createServer({ db, password, secret });
app.listen(port, () => console.log(`sales-manager server on :${port}`));
