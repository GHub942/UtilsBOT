const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const database = require('../src/database');
const timestamp = require('../src/commands/timestamp');
const { handleInteraction } = require('../src/interactions');

test('denies server statistics access without permission and responds ephemerally', async () => {
  const userId = `interaction-test-${randomUUID()}`;
  const guildId = `interaction-guild-${randomUUID()}`;
  const calls = [];
  const hasPermission = database.hasPermission;
  database.hasPermission = () => false;
  const interaction = {
    customId: `manage:stats:${userId}`,
    user: { id: userId },
    guildId,
    guild: { ownerId: 'different-owner' },
    memberPermissions: { has: () => false },
    isButton: () => true,
    isStringSelectMenu: () => false,
    isUserSelectMenu: () => false,
    isModalSubmit: () => false,
    isChatInputCommand: () => false,
    isRepliable: () => true,
    deferUpdate: async () => calls.push('deferUpdate'),
    reply: async payload => calls.push(['reply', payload]),
    followUp: async payload => calls.push(['followUp', payload])
  };

  try {
    await handleInteraction({ commands: new Map() }, interaction);
    assert.deepEqual(calls.map(call => Array.isArray(call) ? call[0] : call), ['deferUpdate', 'followUp']);
    assert.match(calls[1][1].content, /Permission statistiques requise/);
  } finally {
    database.hasPermission = hasPermission;
  }
});

test('dispatches modal submissions to their handler without a second generic reply', async () => {
  const userId = `modal-test-${randomUUID()}`;
  const calls = [];
  const interaction = {
    customId: 'timestamp:field:date',
    user: { id: userId },
    isChatInputCommand: () => false,
    fields: { getTextInputValue: () => '31/03/2026' },
    isModalSubmit: () => true,
    deferReply: async () => calls.push('deferReply'),
    editReply: async payload => calls.push(['editReply', payload]),
    reply: async () => calls.push('reply'),
    deleteReply: async () => calls.push('deleteReply')
  };

  try {
    await handleInteraction({ commands: new Map() }, interaction);
    assert.equal(calls.filter(call => call === 'deferReply').length, 1);
    assert.equal(calls.includes('reply'), false);
    assert.equal(calls[1][0], 'editReply');
  } finally {
    timestamp.drafts.delete(userId);
    database.deleteUserData(userId);
    database.closeAll();
  }
});
