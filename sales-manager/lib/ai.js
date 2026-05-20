import { spawn } from "node:child_process";

const CLAUDE_PATH = process.env.CLAUDE_CLI_PATH || "claude";

export async function askClaude({ systemPrompt, history = [], userMessage, runner = defaultRunner, model = "sonnet" }) {
  const payload = buildPayload({ systemPrompt, history, userMessage });
  const stdout = await runner(["-p", "--output-format", "json", "--model", model], payload);
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (e) {
    throw new Error(`AI: парсинг ответа CLI провален: ${e.message}; raw: ${stdout.slice(0, 200)}`);
  }
  return {
    text: parsed.text ?? parsed.result ?? "",
    tokensIn: parsed.usage?.input_tokens ?? null,
    tokensOut: parsed.usage?.output_tokens ?? null,
    raw: parsed,
  };
}

function buildPayload({ systemPrompt, history, userMessage }) {
  const lines = [systemPrompt, "", "## История диалога:"];
  for (const m of history) {
    lines.push(`### ${m.role === "user" ? "Лид" : "Я"}:`);
    lines.push(m.content);
    lines.push("");
  }
  lines.push("## Новое сообщение от лида:");
  lines.push(userMessage);
  lines.push("");
  lines.push("Ответь как описано в системном промпте.");
  return lines.join("\n");
}

function defaultRunner(args, stdinPayload) {
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_PATH, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`claude CLI exit ${code}: ${stderr}`));
      resolve(stdout);
    });
    child.stdin.write(stdinPayload);
    child.stdin.end();
  });
}
