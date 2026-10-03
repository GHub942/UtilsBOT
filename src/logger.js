const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;

function write(level, message, details) {
  if (LEVELS[level] > currentLevel) return;
  const output = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`;
  (level === 'error' ? console.error : console.log)(details ? `${output} ${details}` : output);
}

module.exports = { error: (message, details) => write('error', message, details), warn: (message, details) => write('warn', message, details), info: (message, details) => write('info', message, details), debug: (message, details) => write('debug', message, details) };
