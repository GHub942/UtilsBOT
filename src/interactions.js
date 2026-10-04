const { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, UserSelectMenuBuilder } = require('discord.js');
const dashboard = require('./commands/dashboard');
const timestamp = require('./commands/timestamp');
const convert = require('./commands/convert');
const panels = require('./panels');
const database = require('./database');
const { isSelectableZone } = require('./time');
const { ZONES } = require('./components');
const { PERMISSIONS, canOpenServerDashboard, grantPermission, hasPermission, revokePermission } = require('./permissions');
const { acknowledgeCommand, acknowledgeComponent } = require('./interaction-responses');

const selections = new Map();

function owns(customId, userId) { return customId.split(':').at(-1) === userId; }
function selectionKey(interaction) { return `${interaction.guildId || 'dm'}:${interaction.user.id}`; }
function manager(interaction, permission) { return hasPermission(interaction, permission); }
function updateSettings(userId, update) { return database.setUserPreferences(userId, update); }
function ephemeralError(message) { return { content: `❌ ${message}`, flags: MessageFlags.Ephemeral }; }

async function handleInteraction(client, interaction) {
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    const acknowledged = await acknowledgeCommand(interaction);
    if (command) return command.execute(acknowledged);
    return acknowledged.reply(ephemeralError('Commande indisponible. Relance le déploiement des commandes.'));
  }
  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('timestamp:field:')) return timestamp.handleModal(interaction);
    if (interaction.customId === 'timestamp:zone:modal') return timestamp.handleZoneModal(interaction);
    if (interaction.customId.startsWith('convert:field:')) return convert.handleModal(interaction);
    if (interaction.customId.startsWith('convert:zone:modal:')) return convert.handleZoneModal(interaction);
    if (interaction.customId === 'user:timezone:modal') return handleTimezoneModal(interaction);
    return interaction.reply(ephemeralError('Formulaire expiré ou indisponible.'));
  }
  const opensModal = interaction.isButton() && /^(timestamp:(date|time)|convert:(date|time|source):)/.test(interaction.customId);
  const selectsCustomZone = interaction.isStringSelectMenu()
    && (interaction.customId === `timestamp:zone-select:${interaction.user.id}` || interaction.customId === `user:timezone-select:${interaction.user.id}` || interaction.customId.startsWith(`convert:zone-select:`))
    && interaction.values[0] === 'custom';
  if ((interaction.isButton() || interaction.isStringSelectMenu() || interaction.isUserSelectMenu()) && !opensModal && !selectsCustomZone) {
    interaction = await acknowledgeComponent(interaction);
  }
  if (!interaction.customId || owns(interaction.customId, interaction.user.id)) {
    if (interaction.isButton()) return handleButton(interaction);
    if (interaction.isStringSelectMenu() || interaction.isUserSelectMenu()) return handleSelect(interaction);
  } else if (interaction.isRepliable()) return interaction.reply(ephemeralError('Ce panneau appartient à un autre utilisateur.'));
  if (interaction.isRepliable()) return interaction.reply(ephemeralError('Action inconnue ou expirée. Relance le parcours depuis le tableau de bord.'));
}

async function handleButton(interaction) {
  const [area, action] = interaction.customId.split(':');
  if (area === 'dashboard') {
    if (action === 'home') return interaction.update(panels.dashboardPayload(interaction));
    if (action === 'manage') return canOpenServerDashboard(interaction) ? interaction.update(panels.managementPayload(interaction)) : interaction.reply(ephemeralError('Aucune permission de gestion serveur.'));
    if (action === 'user') return interaction.update(panels.userPayload(interaction));
    if (action === 'tools') return interaction.update(panels.toolsPayload(interaction));
  }
  if (area === 'manage') {
    if (action === 'database') return canOpenServerDashboard(interaction) ? interaction.update(panels.databasePayload(interaction)) : interaction.reply(ephemeralError('Aucune permission de gestion serveur.'));
    if (action === 'stats') return manager(interaction, PERMISSIONS.VIEW_STATS) ? showStats(interaction) : interaction.reply(ephemeralError('Permission statistiques requise.'));
    if (action === 'health') return canOpenServerDashboard(interaction) ? interaction.update(panels.healthPayload(interaction)) : interaction.reply(ephemeralError('Aucune permission de gestion serveur.'));
  }
  if (area === 'db') {
    if (action === 'users') return manager(interaction, PERMISSIONS.VIEW_DATA) ? interaction.update(panels.userDataPayload(interaction)) : interaction.reply(ephemeralError('Permission données requise.'));
    if (action === 'permissions') return manager(interaction, PERMISSIONS.MANAGE_PERMISSIONS) ? interaction.update(panels.permissionsPayload(interaction)) : interaction.reply(ephemeralError('Permission administration requise.'));
    if (action === 'export') return manager(interaction, PERMISSIONS.EXPORT_DATA) ? exportGuild(interaction) : interaction.reply(ephemeralError('Permission export requise.'));
    if (action === 'reset') return manager(interaction, PERMISSIONS.RESET_DATA) ? confirmReset(interaction) : interaction.reply(ephemeralError('Permission reset requise.'));
    if (action === 'journal') return manager(interaction, PERMISSIONS.VIEW_STATS) ? interaction.update(panels.journalPayload(interaction)) : interaction.reply(ephemeralError('Permission journal requise.'));
  }
  if (area === 'journal') {
    if (action === 'export') {
      if (!manager(interaction, PERMISSIONS.VIEW_STATS)) return interaction.reply(ephemeralError('Permission journal requise.'));
      const file = new AttachmentBuilder(Buffer.from(JSON.stringify(database.exportAudit(interaction.guildId), null, 2)), { name: `utils_journal_${interaction.guildId}.json` });
      database.addAudit(interaction.guildId, 'journal.export', interaction.user.id);
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('🧾 Journal exporté').setDescription('Le journal JSON est joint à ce message éphémère.')], files: [file], flags: MessageFlags.Ephemeral });
    }
    if (action === 'prev' || action === 'next') {
      if (!manager(interaction, PERMISSIONS.VIEW_STATS)) return interaction.reply(ephemeralError('Permission journal requise.'));
      const currentPage = Number(interaction.customId.split(':')[2]) || 0;
      const page = action === 'prev' ? currentPage - 1 : currentPage + 1;
      return interaction.update(panels.journalPayload(interaction, page));
    }
  }
  if (area === 'tool') {
    if (action === 'timestamp') return timestamp.execute(interaction);
    if (action === 'timezone') return convert.execute(interaction);
    if (action === 'back') return interaction.update(panels.toolsPayload(interaction));
  }
  if (area === 'data') {
    const state = selections.get(selectionKey(interaction));
    if (!state?.memberId) return interaction.reply(ephemeralError('Sélectionne un membre.'));
    if (action === 'export') {
      if (!manager(interaction, PERMISSIONS.EXPORT_DATA)) return interaction.reply(ephemeralError('Permission export requise.'));
      const file = new AttachmentBuilder(Buffer.from(JSON.stringify(database.getUserData(interaction.guildId, state.memberId), null, 2)), { name: `utils_user_${state.memberId}.json` });
      database.addAudit(interaction.guildId, 'user.export', interaction.user.id, state.memberId);
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('📦 Export utilisateur').setDescription(`Les données de <@${state.memberId}> sont jointes en JSON.`)], files: [file], flags: MessageFlags.Ephemeral });
    }
    if (action === 'delete') {
      if (!manager(interaction, PERMISSIONS.MANAGE_USER_DATA)) return interaction.reply(ephemeralError('Permission gestion utilisateur requise.'));
      return interaction.update({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('⚠️ Suppression utilisateur').setDescription(`Supprimer les données de <@${state.memberId}> ?`)], content: '', components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`data:delete-confirm:${interaction.user.id}`).setLabel('🗑️ Confirmer').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(`db:users:${interaction.user.id}`).setLabel('↩️ Annuler').setStyle(ButtonStyle.Secondary))] });
    }
    if (action === 'delete-confirm') {
      if (!manager(interaction, PERMISSIONS.MANAGE_USER_DATA)) return interaction.reply(ephemeralError('Permission gestion utilisateur requise.'));
      database.addAudit(interaction.guildId, 'user.delete', interaction.user.id, state.memberId);
      database.deleteUserData(state.memberId);
      selections.delete(selectionKey(interaction));
      return interaction.update({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('✅ Données supprimées').setDescription(`Les données de <@${state.memberId}> ont été supprimées.`)], content: '', components: [] });
    }
  }
  if (area === 'perm') {
    if (!manager(interaction, PERMISSIONS.MANAGE_PERMISSIONS)) return interaction.reply(ephemeralError('Seul un administrateur peut modifier les permissions.'));
    if (action === 'enable' || action === 'disable') {
      const selection = selections.get(selectionKey(interaction));
      if (!selection?.memberId || !selection.permission) return interaction.reply(ephemeralError('Sélectionne un membre et une permission.'));
      if (action === 'enable') grantPermission(interaction.guildId, selection.memberId, selection.permission, interaction.user.id);
      else revokePermission(interaction.guildId, selection.memberId, selection.permission, interaction.user.id);
      return interaction.update(panels.permissionsPayload(interaction, selection.memberId, selection.permission));
    }
  }
  if (area === 'db' && action === 'reset-confirm') {
    if (!manager(interaction, PERMISSIONS.RESET_DATA)) return interaction.reply(ephemeralError('Permission reset requise.'));
    database.resetGuild(interaction.guildId, interaction.user.id);
    return interaction.update({ content: '✅ Base de données serveur réinitialisée.', embeds: [], components: [] });
  }
  if (area === 'user') {
    if (action === 'category') return interaction.update(panels.userPayload(interaction, '', interaction.customId.split(':')[2]));
    if (action === 'delete') return interaction.update(panels.userDangerPayload(interaction));
    if (action === 'delete-confirm') {
      if (interaction.guildId) database.addAudit(interaction.guildId, 'user.delete', interaction.user.id, interaction.user.id);
      database.deleteUserData(interaction.user.id);
      return interaction.update({ content: '✅ Tes données Utils ont été supprimées.', embeds: [], components: [] });
    }
  }
  if (area === 'timestamp') {
    if (action === 'zone') return interaction.update(panels.timestampZonePayload(interaction, timestamp.getDraft(interaction.user.id).zone));
    if (action === 'date' || action === 'time') return timestamp.openField(interaction, action);
    if (action === 'confirm') return timestamp.confirm(interaction);
    if (action === 'disambiguation') return timestamp.handleDisambiguation(interaction, Number(interaction.customId.split(':')[2]));
    if (action === 'back') return interaction.update(panels.timestampPayload(interaction, timestamp.getDraft(interaction.user.id)));
    if (action === 'again') return timestamp.again(interaction);
  }
  if (area === 'convert') {
    if (action === 'zone-back') return interaction.update(panels.convertPayload(interaction, convert.getDraft(interaction.user.id)));
    if (action === 'zone') return interaction.update(panels.convertZonePayload(interaction, interaction.customId.split(':')[2], convert.getDraft(interaction.user.id)));
    if (action === 'date' || action === 'time') return convert.openField(interaction, action);
    if (action === 'confirm') return convert.confirm(interaction);
    if (action === 'back') return interaction.update(panels.convertPayload(interaction, convert.getDraft(interaction.user.id)));
    if (action === 'again') return convert.again(interaction);
    if (action === 'disambiguation') return convert.handleDisambiguation(interaction, Number(interaction.customId.split(':')[2]));
  }
}

async function handleSelect(interaction) {
  const [area, action] = interaction.customId.split(':');
  if (area === 'convert' && action === 'zone-select') {
    const role = interaction.customId.split(':')[2];
    const value = interaction.values[0];
    if (value === 'custom') return convert.openZoneField(interaction, role);
    if (!isSelectableZone(value)) return interaction.reply(ephemeralError('Fuseau invalide. Choisis une abréviation fixe ou un nom de ville IANA.'));
    const draft = convert.getDraft(interaction.user.id);
    draft[role] = value;
    convert.drafts.set(interaction.user.id, draft);
    return interaction.update(panels.convertPayload(interaction, draft));
  }
  if (area === 'timestamp' && action === 'zone-select') {
    const value = interaction.values[0];
    if (value === 'custom') return timestamp.openZoneField(interaction);
    if (!isSelectableZone(value)) return interaction.reply(ephemeralError('Fuseau invalide. Choisis une abréviation fixe ou un nom de ville IANA.'));
    const draft = timestamp.getDraft(interaction.user.id);
    draft.zone = value;
    timestamp.drafts.set(interaction.user.id, draft);
    return interaction.update(panels.timestampPayload(interaction, draft));
  }
  if (area === 'user' && action === 'timezone-select') {
    const value = interaction.values[0];
    if (value === 'custom') return interaction.showModal(require('./modals').timezone('Europe/Paris'));
    if (!isSelectableZone(value)) return interaction.reply(ephemeralError('Fuseau invalide. Choisis une abréviation fixe ou un nom de ville IANA.'));
    updateSettings(interaction.user.id, { timezone: value });
    return interaction.update(panels.userPayload(interaction, `🌍 Fuseau mis à jour : **${value}**.`, 'region'));
  }
  if (area === 'user') {
    const preferences = {
      'date-mode': { key: 'dateFormats', values: ['DMY', 'MDY', 'YMD'], array: true },
      'time-mode': { key: 'timeFormats', values: ['HMS', 'HM', 'TEXT'], array: true },
      'date-sep': { key: 'dateSeparator', values: ['/', '.', '-', ','] },
      'time-sep': { key: 'timeSeparator', values: [':', '.', '-', ',', 'h'] },
      seconds: { key: 'showSeconds', values: ['true', 'false'], parse: value => value === 'true' },
      iso: { key: 'isoDates', values: ['true', 'false'], parse: value => value === 'true' },
      language: { key: 'language', values: ['fr', 'en'] }
    };
    const preference = Object.hasOwn(preferences, action) ? preferences[action] : null;
    if (!preference || !preference.values.includes(interaction.values[0])) return interaction.reply(ephemeralError('Option de préférence invalide.'));
    const value = preference.parse ? preference.parse(interaction.values[0]) : interaction.values[0];
    updateSettings(interaction.user.id, { [preference.key]: preference.array ? [value] : value });
    const category = { 'date-mode': 'dates', 'date-sep': 'dates', iso: 'dates', 'time-mode': 'times', 'time-sep': 'times', seconds: 'times', language: 'language' }[action] || 'home';
    return interaction.update(panels.userPayload(interaction, '✅ Préférence mise à jour.', category));
  }
  if (area === 'perm' && action === 'user') { const key = selectionKey(interaction); const state = selections.get(key) || {}; state.memberId = interaction.values[0]; selections.set(key, state); return interaction.update(panels.permissionsPayload(interaction, state.memberId, state.permission)); }
  if (area === 'perm' && action === 'type') { const key = selectionKey(interaction); const state = selections.get(key) || {}; state.permission = interaction.values[0]; selections.set(key, state); return interaction.update(panels.permissionsPayload(interaction, state.memberId, state.permission)); }
  if (area === 'data' && action === 'user') { const key = selectionKey(interaction); const state = selections.get(key) || {}; state.memberId = interaction.values[0]; selections.set(key, state); return showUserData(interaction, state.memberId); }
}

async function handleTimezoneModal(interaction) {
  const value = interaction.fields.getTextInputValue('timezone').trim();
  if (!isSelectableZone(value)) return interaction.reply(ephemeralError('Fuseau invalide. Utilise une abréviation fixe reconnue ou un nom de ville IANA, comme `Europe/Paris`.'));
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  updateSettings(interaction.user.id, { timezone: value });
  return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('🌍 Fuseau enregistré').setDescription(`Ton fuseau par défaut est maintenant **${value}**.`)] });
}

function userSelect(customId, placeholder) { return new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).setMinValues(1).setMaxValues(1)); }
function showStats(interaction) { const stats = database.getStats(interaction.guildId); return interaction.update({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('📊 Statistiques serveur').addFields({ name: '🧾 Actions journalisées', value: String(stats.audit), inline: true })], content: '', components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`manage:database:${interaction.user.id}`).setLabel('↩️ Base de données').setStyle(ButtonStyle.Secondary))] }); }
function exportGuild(interaction) { const file = new AttachmentBuilder(Buffer.from(JSON.stringify(database.exportGuild(interaction.guildId), null, 2)), { name: `utils_${interaction.guildId}.json` }); database.addAudit(interaction.guildId, 'guild.export', interaction.user.id); return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('📦 Export serveur').setDescription('Les données du serveur sont jointes en JSON.')], files: [file], flags: MessageFlags.Ephemeral }); }
function confirmReset(interaction) { return interaction.update({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('⚠️ Réinitialisation serveur').setDescription('Cette action supprime les données serveur et les permissions Utils. Confirmer ?')], content: '', components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`db:reset-confirm:${interaction.user.id}`).setLabel('🗑️ Confirmer').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(`manage:database:${interaction.user.id}`).setLabel('↩️ Annuler').setStyle(ButtonStyle.Secondary))] }); }
function showUserData(interaction, userId) { if (!manager(interaction, PERMISSIONS.VIEW_DATA)) return interaction.reply(ephemeralError('Permission lecture données requise.')); const data = database.getUserData(interaction.guildId, userId); return interaction.update({ content: `🧑 Données de <@${userId}>\nFuseau : **${data.preferences.timezone}**\nActions liées : **${data.audit.length}**`, embeds: [], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`data:export:${interaction.user.id}`).setLabel('📦 Exporter').setStyle(ButtonStyle.Secondary).setDisabled(!manager(interaction, PERMISSIONS.EXPORT_DATA)), new ButtonBuilder().setCustomId(`data:delete:${interaction.user.id}`).setLabel('🗑️ Supprimer').setStyle(ButtonStyle.Danger).setDisabled(!manager(interaction, PERMISSIONS.MANAGE_USER_DATA))), new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`db:users:${interaction.user.id}`).setLabel('↩️ Retour').setStyle(ButtonStyle.Secondary))] }); }

module.exports = { handleInteraction };
