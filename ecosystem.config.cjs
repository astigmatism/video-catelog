const path = require('node:path');

const repoRoot = __dirname;

module.exports = {
  apps: [
    {
      name: 'video-catalog',
      cwd: repoRoot,
      script: path.join(repoRoot, 'apps/server/dist/index.js'),
      exec_mode: 'fork',
      instances: 1,
      node_args: ['--enable-source-maps'],
      watch: false,
      autorestart: true,
      min_uptime: '10s',
      max_restarts: 20,
      exp_backoff_restart_delay: 100,
      max_memory_restart: '1G',
      kill_timeout: 30000,
      time: true,
      env: {
        NODE_ENV: 'production'
      },
      env_production: {
        NODE_ENV: 'production'
      }
    }
  ]
};
