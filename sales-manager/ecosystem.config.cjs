module.exports = {
  apps: [
    {
      name: "agent-sales-manager-server",
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
    {
      name: "agent-sales-manager-worker",
      script: "./bin/start-worker.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      watch: false,
      env: { NODE_ENV: "production" },
    },
  ],
};
