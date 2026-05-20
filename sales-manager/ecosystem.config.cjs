module.exports = {
  apps: [
    {
      name: "agent-sales-manager-server",
      script: "./server.js",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      watch: false,
      env: { NODE_ENV: "production" },
    },
    {
      name: "agent-sales-manager-worker",
      script: "./worker.js",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      watch: false,
      env: { NODE_ENV: "production" },
    },
  ],
};
