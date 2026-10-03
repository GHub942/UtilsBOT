const assert = require('node:assert/strict');
const test = require('node:test');
const { PermissionFlagsBits } = require('discord.js');
const { PERMISSIONS, PERMISSION_LABELS, grantPermission, hasPermission } = require('../src/permissions');

test('exposes only explicit, assignable Utils permissions', () => {
  assert.equal(Object.hasOwn(PERMISSIONS, 'VIEW_WHITELIST'), false);
  assert.equal(Object.hasOwn(PERMISSIONS, 'MANAGE_WHITELIST'), false);
  assert.equal(Object.hasOwn(PERMISSION_LABELS, PERMISSIONS.MANAGE_PERMISSIONS), false);
  assert.throws(() => grantPermission('guild', 'member', PERMISSIONS.MANAGE_PERMISSIONS, 'admin'), /inconnue/i);
});

test('keeps server-owner and Manage Server administrative access', () => {
  const owner = {
    guild: { ownerId: 'owner' },
    guildId: 'guild',
    user: { id: 'owner' },
    memberPermissions: { has: () => false }
  };
  const administrator = {
    guild: { ownerId: 'different-user' },
    guildId: 'guild',
    user: { id: 'admin' },
    memberPermissions: { has: permission => permission === PermissionFlagsBits.ManageGuild }
  };

  assert.equal(hasPermission(owner, PERMISSIONS.RESET_DATA), true);
  assert.equal(hasPermission(administrator, PERMISSIONS.VIEW_STATS), true);
  assert.equal(hasPermission(administrator, PERMISSIONS.MANAGE_PERMISSIONS), true);
});
