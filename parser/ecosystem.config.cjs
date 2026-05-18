module.exports = {
  apps: [
    {
      name: "agent-parser",
      script: "./server.js",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      watch: false,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
