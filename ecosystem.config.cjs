module.exports = {
  apps: [{
    name: 'syncpad',
    script: 'server/src/index.js',
    env: { NODE_ENV: 'production', PORT: 3000 }, // put SITE_URL, DATABASE_URL, JWT_SECRET in the shell env or server/.env
    max_memory_restart: '500M',
  }],
};
