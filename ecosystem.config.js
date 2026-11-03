module.exports = {
  apps: [{ name: "morina-lens", script: "server.js", cwd: __dirname, instances: 1, exec_mode: "fork", max_memory_restart: "350M", time: true, env_production: { NODE_ENV: "production" } }]
};
