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
        CLAUDE_CLI_PATH: "C:\\Users\\Administrator\\.agent\\bot\\claude.cmd",
      },
    },
  ],
};
