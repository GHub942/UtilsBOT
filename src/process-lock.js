const fs = require('fs');
const path = require('path');

function isProcessRunning(processId) {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true;
    throw error;
  }
}

function acquireProcessLock(lockPath, processId = process.pid) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const descriptor = fs.openSync(lockPath, 'wx', 0o600);
      try {
        fs.writeFileSync(descriptor, `${processId}\n`);
      } finally {
        fs.closeSync(descriptor);
      }
      return () => {
        try {
          if (Number(fs.readFileSync(lockPath, 'utf8').trim()) === processId) fs.unlinkSync(lockPath);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const contents = fs.readFileSync(lockPath, 'utf8').trim();
      const existingProcessId = Number(contents);
      if (!Number.isSafeInteger(existingProcessId) || existingProcessId <= 0) {
        throw new Error(`The bot lock at ${lockPath} is empty or invalid. Confirm no bot instance is running, then remove the stale lock.`);
      }
      if (isProcessRunning(existingProcessId)) {
        throw new Error(`Another bot instance is already running (PID ${existingProcessId}). Stop it before starting another instance.`);
      }
      fs.unlinkSync(lockPath);
    }
  }

  throw new Error(`Could not acquire the bot lock at ${lockPath}.`);
}

module.exports = { acquireProcessLock };
