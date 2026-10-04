const database = require('./database');

const PERMISSIONS = Object.freeze({
  VIEW_STATS: 'view_stats',
  VIEW_DATA: 'view_data',
  EXPORT_DATA: 'export_data',
  MANAGE_USER_DATA: 'manage_user_data',
  RESET_DATA: 'reset_data',
  MANAGE_PERMISSIONS: 'manage_permissions'
});

const PERMISSION_LABELS = Object.freeze({
  view_stats: 'permission_view_stats',
  view_data: 'permission_view_data',
  export_data: 'permission_export_data',
  manage_user_data: 'permission_manage_user_data',
  reset_data: 'permission_reset_data',
  manage_permissions: 'permission_manage_permissions'
});

function isGuildOwner(interaction) {
  return Boolean(interaction.guild?.ownerId === interaction.user?.id);
}

function hasPermission(interaction, permission) {
  if (isGuildOwner(interaction)) return true;
  return hasStoredPermission(interaction, permission);
}

function hasStoredPermission(interaction, permission) {
  const roleIds = interaction.member?.roles?.cache
    ? [...interaction.member.roles.cache.keys()]
    : [];
  return Boolean(interaction.guildId && database.hasPermission(interaction.guildId, interaction.user.id, permission, roleIds));
}

function canOpenServerDashboard(interaction) {
  return Object.values(PERMISSIONS).some(permission => hasPermission(interaction, permission));
}

function canManagePermission(interaction, permission) {
  if (isGuildOwner(interaction)) return true;
  return permission !== PERMISSIONS.MANAGE_PERMISSIONS && hasPermission(interaction, permission);
}

function grantPermission(guildId, userId, permission, actorId) {
  if (!Object.hasOwn(PERMISSION_LABELS, permission)) throw new Error('Unknown or administrator-reserved permission.');
  if (userId === actorId && permission === PERMISSIONS.MANAGE_PERMISSIONS) throw new Error('Cannot grant permission management to yourself.');
  database.grantPermission(guildId, userId, permission, actorId);
}

function grantRolePermission(guildId, roleId, permission, actorId) {
  if (!Object.hasOwn(PERMISSION_LABELS, permission)) throw new Error('Unknown or administrator-reserved permission.');
  database.grantRolePermission(guildId, roleId, permission, actorId);
}

function revokePermission(guildId, userId, permission, actorId) {
  if (!Object.hasOwn(PERMISSION_LABELS, permission)) throw new Error('Unknown or administrator-reserved permission.');
  database.revokePermission(guildId, userId, permission, actorId);
}

function revokeRolePermission(guildId, roleId, permission, actorId) {
  if (!Object.hasOwn(PERMISSION_LABELS, permission)) throw new Error('Unknown or administrator-reserved permission.');
  database.revokeRolePermission(guildId, roleId, permission, actorId);
}

module.exports = { PERMISSIONS, PERMISSION_LABELS, canManagePermission, canOpenServerDashboard, grantPermission, grantRolePermission, hasPermission, isGuildOwner, revokePermission, revokeRolePermission };
