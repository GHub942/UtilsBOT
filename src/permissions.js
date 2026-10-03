const { PermissionFlagsBits } = require('discord.js');
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
  view_stats: '📊 Voir les statistiques',
  view_data: '🗄️ Voir la base de données',
  export_data: '📦 Exporter les données',
  manage_user_data: '🧑 Gérer les données utilisateur',
  reset_data: '♻️ Réinitialiser les données'
});

function isServerManager(interaction) {
  return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
}

function isGuildOwner(interaction) {
  return Boolean(interaction.guild?.ownerId === interaction.user?.id);
}

function hasPermission(interaction, permission) {
  if (isGuildOwner(interaction)) return true;
  if (permission === PERMISSIONS.VIEW_DATA && (hasStoredPermission(interaction, PERMISSIONS.MANAGE_USER_DATA) || hasStoredPermission(interaction, PERMISSIONS.EXPORT_DATA))) return true;
  if (permission === PERMISSIONS.EXPORT_DATA && hasStoredPermission(interaction, PERMISSIONS.MANAGE_USER_DATA)) return true;
  if (permission === PERMISSIONS.VIEW_STATS) return isServerManager(interaction) || hasStoredPermission(interaction, permission);
  if (permission === PERMISSIONS.MANAGE_PERMISSIONS) return isServerManager(interaction) || isGuildOwner(interaction);
  return hasStoredPermission(interaction, permission);
}

function hasStoredPermission(interaction, permission) {
  return Boolean(interaction.guildId && database.hasPermission(interaction.guildId, interaction.user.id, permission));
}

function canOpenServerDashboard(interaction) {
  return Object.values(PERMISSIONS).some(permission => hasPermission(interaction, permission));
}

function grantPermission(guildId, userId, permission, actorId) {
  if (!Object.hasOwn(PERMISSION_LABELS, permission)) throw new Error('Permission inconnue ou réservée à un administrateur');
  database.grantPermission(guildId, userId, permission, actorId);
}

function revokePermission(guildId, userId, permission, actorId) {
  if (!Object.hasOwn(PERMISSION_LABELS, permission)) throw new Error('Permission inconnue ou réservée à un administrateur');
  database.revokePermission(guildId, userId, permission, actorId);
}

module.exports = { PERMISSIONS, PERMISSION_LABELS, canOpenServerDashboard, grantPermission, hasPermission, isGuildOwner, isServerManager, revokePermission };
