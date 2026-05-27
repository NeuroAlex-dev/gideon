const fs = require("node:fs");
const path = require("node:path");

// Находим самый свежий claude.exe среди установленных VS Code расширений.
// Шим claude.cmd хардкодит конкретную версию и ломается при обновлении —
// поэтому ищем актуальный бинарь динамически. Node спавнит .exe без shell (нет EINVAL).
function findClaudeExe() {
  if (process.env.CLAUDE_CLI_PATH && fs.existsSync(process.env.CLAUDE_CLI_PATH)) {
    return process.env.CLAUDE_CLI_PATH;
  }
  const home = process.env.USERPROFILE || "C:\\Users\\Administrator";
  const extDir = path.join(home, ".vscode", "extensions");
  try {
    const cands = fs.readdirSync(extDir)
      .filter((d) => /^anthropic\.claude-code-.*-win32-x64$/.test(d))
      .map((d) => {
        const m = d.match(/claude-code-(\d+)\.(\d+)\.(\d+)/);
        const ver = m ? Number(m[1]) * 1e6 + Number(m[2]) * 1e3 + Number(m[3]) : 0;
        return { exe: path.join(extDir, d, "resources", "native-binary", "claude.exe"), ver };
      })
      .filter((c) => fs.existsSync(c.exe))
      .sort((a, b) => b.ver - a.ver);
    if (cands.length) return cands[0].exe;
  } catch {}
  return "claude";
}

module.exports = {
  apps: [
    {
      name: "agent-content-server",
      script: "./bin/start-server.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      watch: false,
      env: {
        NODE_ENV: "production",
        CA_PORT: "3002",
        CA_MODEL: "sonnet",
        AGENT_HOME: "C:\\Users\\Administrator",
        CLAUDE_CLI_PATH: findClaudeExe(),
      },
    },
  ],
};
