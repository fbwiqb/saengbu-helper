const { open } = require('./db');
const { createApp } = require('./server');

const PORT = process.env.PORT || 5870;
const HOST = process.env.HOST || '127.0.0.1';
const db = open(process.env.DB_FILE || 'saengbu.db');
createApp(db).listen(PORT, HOST, () => {
  console.log(`saengbu-local → http://localhost:${PORT}`);
});
