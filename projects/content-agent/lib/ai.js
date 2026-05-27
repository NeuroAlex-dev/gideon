import { spawn } from "node:child_process";

function getClaudePath() {
  return process.env.CLAUDE_CLI_PATH || process.env.CLAUDE_CODE_EXECPATH || "claude";
}

export function extractJson(text) {
  if (!text) return text;
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenced) return fenced[1].trim();
  return text.trim();
}

export async function generate({ systemPrompt, userMessage, runner = defaultRunner, model = process.env.CA_MODEL || "sonnet" }) {
  const payload = `${systemPrompt}\n\n${userMessage}`;
  const stdout = await runner(["-p", "--output-format", "json", "--model", model], payload);
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (e) {
    throw new Error(`AI: парсинг ответа CLI провален: ${e.message}; raw: ${String(stdout).slice(0, 200)}`);
  }
  return { text: parsed.result ?? parsed.text ?? "", raw: parsed };
}

function defaultRunner(args, stdinPayload) {
  return new Promise((resolve, reject) => {
    const claudePath = getClaudePath();
    const child = spawn(claudePath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, HOME: process.env.AGENT_HOME || process.env.HOME },
      timeout: 300000,
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => reject(new Error(`claude CLI spawn failed (path=${claudePath}): ${err.message}`)));
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`claude CLI exit ${code}: ${stderr.slice(0, 500)}`));
      resolve(stdout);
    });
    child.stdin.write(stdinPayload);
    child.stdin.end();
  });
}
