const assert = require('node:assert/strict');
const test = require('node:test');
const { acknowledgeCommand, acknowledgeComponent } = require('../src/interaction-responses');

test('acknowledges commands before work and sends their response as an edit', async () => {
  const calls = [];
  const interaction = {
    deferReply: async options => calls.push(['deferReply', options]),
    editReply: async payload => calls.push(['editReply', payload]),
    reply: async () => assert.fail('A deferred command must edit its initial response.')
  };

  const acknowledged = await acknowledgeCommand(interaction);
  await acknowledged.reply({ content: 'Done' });

  assert.equal(calls[0][0], 'deferReply');
  assert.deepEqual(calls[0][1], { flags: 64 });
  assert.deepEqual(calls[1], ['editReply', { content: 'Done' }]);
});

test('acknowledges components before work and edits or follows up appropriately', async () => {
  const calls = [];
  const interaction = {
    deferUpdate: async () => calls.push(['deferUpdate']),
    editReply: async payload => calls.push(['editReply', payload]),
    followUp: async payload => calls.push(['followUp', payload]),
    update: async () => assert.fail('A deferred component must edit its original response.'),
    reply: async () => assert.fail('A deferred component error must use a follow-up.')
  };

  const acknowledged = await acknowledgeComponent(interaction);
  await acknowledged.update({ content: 'Updated' });
  await acknowledged.reply({ content: 'Denied' });

  assert.deepEqual(calls, [
    ['deferUpdate'],
    ['editReply', { content: 'Updated' }],
    ['followUp', { content: 'Denied' }]
  ]);
});
