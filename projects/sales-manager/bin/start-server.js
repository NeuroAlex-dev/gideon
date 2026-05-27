import dotenv from "dotenv";
dotenv.config();
import { openDb } from "../lib/db.js";
import { createServer } from "../server.js";

const db = openDb(process.env.SM_DB_PATH || "./data/sales-manager.db");
const parserUrl = process.env.PARSER_URL || "http://127.0.0.1:3000";
const port = Number(process.env.SM_PORT || 3001);
const app = createServer({ db, parserUrl });
app.listen(port, () => console.log(`sales-manager server on :${port} (auth via ${parserUrl})`));
