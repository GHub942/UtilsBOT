const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const convert = require('../src/commands/convert');

test('offers and accepts daylight-saving disambiguation in the conversion flow', async () => {
  const userId = `convert-test-${randomUUID()}`;
  const updates = [];
  const interaction = {
    user: { id: userId },
    guildId: null,
    update: async payload => updates.push(payload)
  };

  try {
    convert.drafts.set(userId, {
      date: '25/10/2026',
      time: '02:30',
      source: 'Europe/Paris',
      target: 'Europe/London',
      language: 'en',
      origin: null
    });

    await convert.confirm(interaction);
    const choices = updates[0].components[0].components;
    assert.equal(choices.length, 2);
    assert.ok(choices.every(choice => choice.data.custom_id.startsWith(`convert:disambiguation:`)));

    await convert.handleDisambiguation(interaction, 1);
    assert.match(updates[1].embeds[0].data.title, /conversion complete/i);
    assert.match(updates[1].embeds[0].data.fields[0].value, /02:30/);
  } finally {
    convert.drafts.delete(userId);
  }
});
