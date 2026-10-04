function isDisallowedIntentsError(error) {
  const pending = [error];
  const visited = new Set();
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== 'object' || visited.has(current)) continue;
    visited.add(current);
    if (current.code === 4014 || current.closeCode === 4014 || /disallowed intents/i.test(String(current.message || ''))) return true;
    pending.push(current.cause, current.rawError, ...(Array.isArray(current.errors) ? current.errors : []));
  }
  return false;
}

module.exports = { isDisallowedIntentsError };
