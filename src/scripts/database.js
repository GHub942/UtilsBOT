const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync, backup } = require('node:sqlite');
const { acquireProcessLock } = require('../process-lock');

async function copyDatabaseTree(sourceRoot, destinationRoot) {
  if (!fs.existsSync(sourceRoot)) throw new Error(`Database source does not exist: ${sourceRoot}`);
  fs.mkdirSync(destinationRoot, { recursive: true });
  let copied = 0;

  for (const scope of ['guilds', 'users']) {
    const sourceScope = path.join(sourceRoot, scope);
    if (!fs.existsSync(sourceScope)) continue;
    for (const entry of fs.readdirSync(sourceScope, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const sourcePath = path.join(sourceScope, entry.name, 'data.sqlite');
      if (!fs.existsSync(sourcePath)) continue;
      const destinationDirectory = path.join(destinationRoot, scope, entry.name);
      fs.mkdirSync(destinationDirectory, { recursive: true });
      const sourceDatabase = new DatabaseSync(sourcePath, { readOnly: true });
      try {
        sourceDatabase.exec('PRAGMA busy_timeout = 5000;');
        await backup(sourceDatabase, path.join(destinationDirectory, 'data.sqlite'));
      } finally {
        sourceDatabase.close();
      }
      copied += 1;
    }
  }
  return copied;
}

async function run() {
  const [action, target] = process.argv.slice(2);
  if (!['backup', 'restore'].includes(action) || !target) {
    throw new Error('Usage: node src/scripts/database.js <backup|restore> <directory>');
  }

  const root = path.resolve(__dirname, '../..');
  const dataRoot = path.join(root, 'data');
  const targetRoot = path.resolve(target);
  if (targetRoot === dataRoot || targetRoot.startsWith(`${dataRoot}${path.sep}`)) {
    throw new Error('Backup and restore directories must be outside the live data directory.');
  }

  let releaseLock;
  if (action === 'restore') {
    releaseLock = acquireProcessLock(path.join(dataRoot, 'bot.pid'));
  } else if (fs.existsSync(targetRoot)) {
    throw new Error(`Backup destination already exists: ${targetRoot}`);
  }

  try {
    const count = action === 'backup'
      ? await copyDatabaseTree(dataRoot, targetRoot)
      : await copyDatabaseTree(targetRoot, dataRoot);
    console.log(`${action === 'backup' ? 'Backed up' : 'Restored'} ${count} SQLite database(s).`);
  } finally {
    if (releaseLock) releaseLock();
  }
}

if (require.main === module) {
  run().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { copyDatabaseTree };
