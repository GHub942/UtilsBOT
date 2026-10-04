const assert = require('node:assert/strict');
const test = require('node:test');
const database = require('../src/database');
const { PERMISSIONS, PERMISSION_LABELS, canManagePermission, canOpenServerDashboard, grantPermission, hasPermission } = require('../src/permissions');

test('exposes all Utils permissions, including explicit permission management', () => {
  assert.equal(Object.hasOwn(PERMISSIONS, 'VIEW_WHITELIST'), false);
  assert.equal(Object.hasOwn(PERMISSIONS, 'MANAGE_WHITELIST'), false);
  for (const permission of Object.values(PERMISSIONS)) {
    assert.ok(Object.hasOwn(PERMISSION_LABELS, permission));
  }
});

test('only the server owner receives implicit full access', () => {
  const owner = {
    guild: { ownerId: 'owner' },
    guildId: 'guild',
    user: { id: 'owner' },
    memberPermissions: { has: () => true }
  };
  const discordAdministrator = {
    guild: { ownerId: 'different-user' },
    guildId: 'guild',
    user: { id: 'admin' },
    memberPermissions: { has: () => true }
  };
  const storedHasPermission = database.hasPermission;
  database.hasPermission = () => false;

  try {
    assert.equal(hasPermission(owner, PERMISSIONS.RESET_DATA), true);
    assert.equal(canOpenServerDashboard(owner), true);
    assert.equal(hasPermission(discordAdministrator, PERMISSIONS.VIEW_STATS), false);
    assert.equal(hasPermission(discordAdministrator, PERMISSIONS.MANAGE_PERMISSIONS), false);
    assert.equal(canOpenServerDashboard(discordAdministrator), false);
    assert.equal(canManagePermission(discordAdministrator, PERMISSIONS.VIEW_STATS), false);
  } finally {
    database.hasPermission = storedHasPermission;
  }
});

test('requires each non-owner Utils permission explicitly and allows granting the permission manager role', () => {
  const interaction = {
    guild: { ownerId: 'owner' },
    guildId: 'guild',
    user: { id: 'member' }
  };
  const storedHasPermission = database.hasPermission;
  const storedGrantPermission = database.grantPermission;
  const grants = [];
  database.hasPermission = (_guildId, _userId, permission) => permission === PERMISSIONS.VIEW_DATA;
  database.grantPermission = (...args) => grants.push(args);

  try {
    assert.equal(hasPermission(interaction, PERMISSIONS.VIEW_DATA), true);
    assert.equal(hasPermission(interaction, PERMISSIONS.EXPORT_DATA), false);
    assert.equal(canOpenServerDashboard(interaction), true);
    assert.equal(canManagePermission(interaction, PERMISSIONS.VIEW_DATA), true);
    assert.equal(canManagePermission(interaction, PERMISSIONS.EXPORT_DATA), false);
    assert.equal(canManagePermission(interaction, PERMISSIONS.MANAGE_PERMISSIONS), false);
    grantPermission('guild', 'delegate', PERMISSIONS.MANAGE_PERMISSIONS, 'owner');
    assert.deepEqual(grants, [['guild', 'delegate', PERMISSIONS.MANAGE_PERMISSIONS, 'owner']]);
    assert.throws(() => grantPermission('guild', 'owner', PERMISSIONS.MANAGE_PERMISSIONS, 'owner'), /yourself/);
  } finally {
    database.hasPermission = storedHasPermission;
    database.grantPermission = storedGrantPermission;
  }
});

test('recognizes explicitly assigned permissions through member roles', () => {
  const storedHasPermission = database.hasPermission;
  const seenRoles = [];
  database.hasPermission = (_guildId, _userId, permission, roles) => {
    seenRoles.push(roles);
    return permission === PERMISSIONS.VIEW_STATS && roles.includes('role-b');
  };

  try {
    for (const roles of [
      { cache: new Map([['role-a', {}], ['role-b', {}]]) },
      ['role-a', 'role-b']
    ]) {
      const interaction = {
        guild: { ownerId: 'owner' },
        guildId: 'guild',
        user: { id: 'member' },
        member: { roles }
      };
      assert.equal(hasPermission(interaction, PERMISSIONS.VIEW_STATS), true);
      assert.equal(hasPermission(interaction, PERMISSIONS.EXPORT_DATA), false);
    }
    assert.deepEqual(seenRoles.filter(roles => roles.length), [
      ['role-a', 'role-b'],
      ['role-a', 'role-b'],
      ['role-a', 'role-b'],
      ['role-a', 'role-b']
    ]);
  } finally {
    database.hasPermission = storedHasPermission;
  }
});
