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
      env: { NODE_ENV: "production" },
    },
  ],
};
