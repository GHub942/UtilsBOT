const assert = require('node:assert/strict');
const test = require('node:test');
const { isDisallowedIntentsError } = require('../src/gateway');

test('recognizes Discord disallowed-intents errors across common error wrappers', () => {
  assert.equal(isDisallowedIntentsError(new Error('Used disallowed intents')), true);
  assert.equal(isDisallowedIntentsError(Object.assign(new Error('WebSocket closed'), { code: 4014 })), true);
  assert.equal(isDisallowedIntentsError(new AggregateError([new Error('Used disallowed intents')], 'Gateway error')), true);
  assert.equal(isDisallowedIntentsError(new Error('Invalid token')), false);
  assert.equal(isDisallowedIntentsError(null), false);
});
