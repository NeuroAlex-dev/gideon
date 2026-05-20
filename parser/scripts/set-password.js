import { readFileSync, existsSync, writeFileSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword } from "../lib/password.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env");

const password = process.argv[2];
if (!password) {
  console.error("Usage: node parser/scripts/set-password.js <password>");
  console.error("Example: node parser/scripts/set-password.js MySecretPassword123");
  process.exit(1);
}

if (password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

const hash = hashPassword(password);
const line = `LOGIN_PASSWORD_HASH=${hash}`;

if (existsSync(envPath)) {
  const txt = readFileSync(envPath, "utf8");
  if (/^LOGIN_PASSWORD_HASH=/m.test(txt)) {
    writeFileSync(envPath, txt.replace(/^LOGIN_PASSWORD_HASH=.*$/m, line), "utf8");
    console.log("LOGIN_PASSWORD_HASH updated in parser/.env");
  } else {
    appendFileSync(envPath, `\n${line}\n`, "utf8");
    console.log("LOGIN_PASSWORD_HASH appended to parser/.env");
  }
} else {
  writeFileSync(envPath, `${line}\n`, "utf8");
  console.log("parser/.env created with LOGIN_PASSWORD_HASH");
}

console.log("Restart the parser: pm2 restart agent-parser");
