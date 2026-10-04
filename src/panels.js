const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, StringSelectMenuBuilder, UserSelectMenuBuilder } = require('discord.js');
const database = require('./database');
const { ZONES } = require('./components');
const { PERMISSIONS, PERMISSION_LABELS, canOpenServerDashboard, hasPermission } = require('./permissions');
const { t } = require('./i18n');

const COLORS = { main: 0x5865f2, success: 0x57f287, warning: 0xfee75c, danger: 0xed4245 };

function button(id, label, style = ButtonStyle.Secondary) {
  return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
}

function owner(interaction) { return interaction.user.id; }
function row(...buttons) { return new ActionRowBuilder().addComponents(buttons); }
function back(id) { return row(button(id, '↩️ Retour')); }
function embed(title, description, color = COLORS.main) { return new EmbedBuilder().setColor(color).setTitle(title).setDescription(description); }
function userSelect(customId, placeholder) { return new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).setMinValues(1).setMaxValues(1)); }
function permissionSelect(customId, selected) {
  return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder('🔐 Choisir une permission').addOptions(Object.entries(PERMISSION_LABELS).map(([value, label]) => ({ label: label.replace(/^\S+\s/, ''), value, description: value, default: value === selected }))));
}
function preferenceSelect(customId, placeholder, values, selected, labels = {}) {
  return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).addOptions(values.map(value => ({
    label: labels[value] || value,
    value,
    default: value === selected
  }))));
}

function dashboardPayload(interaction) {
  const canManage = canOpenServerDashboard(interaction);
  const title = interaction.guild?.name || 'Messages privés';
  const description = canManage
    ? 'Bienvenue dans le centre de contrôle de **Utils**.\n\nUtilise les boutons ci-dessous pour accéder à tes préférences, aux outils et aux permissions serveur.'
    : 'Bienvenue dans **Utils**.\n\nTon espace personnel est prêt : configure tes formats une fois, puis les commandes utiliseront automatiquement tes choix.';
  const buttons = [button(`dashboard:user:${owner(interaction)}`, '⚙️ Mes préférences', ButtonStyle.Primary), button(`dashboard:tools:${owner(interaction)}`, '🧰 Outils temps')];
  if (canManage) buttons.unshift(button(`dashboard:manage:${owner(interaction)}`, '🛡️ Gestion serveur', ButtonStyle.Secondary));
  return { embeds: [embed(`🧭 Utils • Dashboard • ${title}`, description).addFields({ name: '🌍 Ton profil', value: 'Fuseau et formats personnels', inline: true }, { name: '🛠️ Outils', value: 'Timestamp Discord et conversion de fuseau', inline: true })], components: [row(...buttons)], flags: MessageFlags.Ephemeral };
}

function toolsPayload(interaction) {
  const id = owner(interaction);
  const language = database.getUser(id).language;
  return { embeds: [embed(t(language, 'tools_title'), t(language, 'tools_intro'), COLORS.main).addFields({ name: t(language, 'timestamp_title'), value: t(language, 'timestamp_intro'), inline: true }, { name: t(language, 'conversion_title'), value: t(language, 'conversion_intro'), inline: true })], components: [row(button(`tool:timestamp:${id}`, t(language, 'timestamp_title'), ButtonStyle.Primary), button(`tool:timezone:${id}`, t(language, 'conversion_title'), ButtonStyle.Primary)), row(button(`dashboard:home:${id}`, t(language, 'back_dashboard')))], flags: MessageFlags.Ephemeral };
}

function managementPayload(interaction) {
  const canStats = hasPermission(interaction, PERMISSIONS.VIEW_STATS);
  const stats = canStats ? database.getStats(interaction.guildId) : null;
  return { embeds: [embed('🛡️ Utils • Gestion serveur', 'Les données et permissions concernent uniquement ce serveur.\n\n`Gérer le serveur` permet de consulter les statistiques. Les autres actions nécessitent une permission Utils explicite attribuée par un administrateur.').addFields({ name: '📊 Actions journalisées', value: canStats ? String(stats.audit) : 'Accès requis', inline: true }, { name: '🔐 Permissions', value: 'Gérées par le propriétaire ou un administrateur du serveur.', inline: true })], components: [row(button(`manage:database:${owner(interaction)}`, '🗄️ Base de données', ButtonStyle.Primary), button(`manage:stats:${owner(interaction)}`, '📊 Stats').setDisabled(!canStats)), row(button(`manage:health:${owner(interaction)}`, '🩺 État opérationnel'), button(`dashboard:home:${owner(interaction)}`, '↩️ Retour'))], flags: MessageFlags.Ephemeral };
}

function healthPayload(interaction) {
  const uptime = Math.floor(process.uptime());
  const duration = `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`;
  const ping = Number.isFinite(interaction.client.ws.ping) ? `${Math.round(interaction.client.ws.ping)} ms` : 'Unavailable';
  return { embeds: [embed('🩺 Utils • État opérationnel', 'Runtime and gateway status for this bot process.').addFields({ name: 'Process uptime', value: duration, inline: true }, { name: 'Gateway latency', value: ping, inline: true }, { name: 'Guild audit entries', value: String(database.getStats(interaction.guildId).audit), inline: true })], components: [back(`dashboard:manage:${owner(interaction)}`)], flags: MessageFlags.Ephemeral };
}

function databasePayload(interaction) {
  const id = owner(interaction);
  const canData = hasPermission(interaction, PERMISSIONS.VIEW_DATA);
  const canExport = hasPermission(interaction, PERMISSIONS.EXPORT_DATA);
  const canReset = hasPermission(interaction, PERMISSIONS.RESET_DATA);
  const canStats = hasPermission(interaction, PERMISSIONS.VIEW_STATS);
  return { embeds: [embed('🗄️ Utils • Gestion des données', 'Choisis une section. Les boutons indisponibles correspondent à des permissions non attribuées.').addFields({ name: '🔐 Permissions', value: 'Attribuer les permissions Utils aux membres.', inline: true }, { name: '🧑 Données utilisateurs', value: 'Consulter, exporter ou supprimer.', inline: true }, { name: '🧾 Journal', value: 'Consulter les actions et exporter le JSON.', inline: true })], components: [row(button(`db:permissions:${id}`, '🔐 Permissions', ButtonStyle.Primary).setDisabled(!hasPermission(interaction, PERMISSIONS.MANAGE_PERMISSIONS)), button(`db:users:${id}`, '🧑 Données utilisateurs').setDisabled(!canData), button(`db:journal:${id}`, '🧾 Journal').setDisabled(!canStats)), row(button(`db:export:${id}`, '📦 Export DB').setDisabled(!canExport), button(`db:reset:${id}`, '♻️ Reset serveur', ButtonStyle.Danger).setDisabled(!canReset), button(`dashboard:manage:${id}`, '↩️ Retour'))], flags: MessageFlags.Ephemeral };
}

function journalPayload(interaction, page = 0) {
  const id = owner(interaction);
  const journal = database.getAuditPage(interaction.guildId, page);
  const description = journal.entries.length ? journal.entries.map(entry => `**${entry.action}** • <@${entry.actorId}> • <t:${Math.floor(entry.timestamp / 1000)}:R>${entry.details ? `\n> ${entry.details}` : ''}`).join('\n\n') : 'Aucune action journalisée.';
  const navigation = [button(`journal:prev:${journal.page}:${id}`, '◀️ Précédent').setDisabled(journal.page <= 0), button(`journal:next:${journal.page}:${id}`, 'Suivant ▶️').setDisabled(journal.page >= journal.totalPages - 1), button(`journal:export:${id}`, '📦 Export JSON')];
  return { embeds: [embed('🧾 Utils • Journal serveur', `Page **${journal.page + 1}/${journal.totalPages}** • ${journal.total} action(s)\n\n${description}`)], components: [row(...navigation), back(`manage:database:${id}`)], flags: MessageFlags.Ephemeral };
}

function permissionsPayload(interaction, selectedUser, selectedPermission) {
  const id = owner(interaction);
  const entries = database.getPermissions(interaction.guildId).filter(entry => !selectedUser || entry.userId === selectedUser);
  const summary = entries.length ? entries.map(entry => `<@${entry.userId}> • **${entry.permission}**`).join('\n').slice(0, 1024) : 'Aucune permission sélectionnée.';
  return { embeds: [embed('🔐 Utils • Permissions', 'Sélectionne un membre et une permission, puis active ou désactive cet accès explicite.').addFields({ name: 'Permissions actuelles', value: summary, inline: false })], components: [userSelect(`perm:user:${id}`, '👤 Sélectionner un membre'), permissionSelect(`perm:type:${id}`, selectedPermission), row(button(`perm:enable:${id}`, '✅ Activer', ButtonStyle.Success).setDisabled(!selectedUser || !selectedPermission), button(`perm:disable:${id}`, '❌ Désactiver', ButtonStyle.Danger).setDisabled(!selectedUser || !selectedPermission)), back(`manage:database:${id}`)], flags: MessageFlags.Ephemeral };
}

function userDataPayload(interaction) {
  const id = owner(interaction);
  return { embeds: [embed('🧑 Utils • Données utilisateur', 'Sélectionne un membre pour consulter ses données sur ce serveur. Les actions de modification et de suppression sont réservées à la permission dédiée.')], components: [userSelect(`data:user:${id}`, '👤 Sélectionner un membre'), back(`manage:database:${id}`)], flags: MessageFlags.Ephemeral };
}

function userPayload(interaction, notice = '', category = 'home') {
  const settings = database.getUser(interaction.user.id);
  const id = owner(interaction);
  const categories = ['region', 'dates', 'times', 'language'];
  const categoryButtons = row(
    ...categories.map(value => button(`user:category:${value}:${id}`, t(settings.language, `category_${value === 'region' ? 'region' : value === 'dates' ? 'date' : value === 'times' ? 'time' : 'language'}`), value === category ? ButtonStyle.Primary : ButtonStyle.Secondary))
  );
  const categoryTitle = {
    home: t(settings.language, 'choose_category'),
    region: t(settings.language, 'region_help'),
    dates: t(settings.language, 'date_help'),
    times: t(settings.language, 'time_help'),
    language: t(settings.language, 'language_help')
  }[category] || t(settings.language, 'choose_category');
  const categoryName = {
    home: 'category_language',
    region: 'category_region',
    dates: 'category_date',
    times: 'category_time',
    language: 'category_language'
  }[category] || 'category_language';
  let preferenceRows = [];

  if (category === 'region') {
    preferenceRows = [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
      .setCustomId(`user:timezone-select:${id}`)
      .setPlaceholder(`${t(settings.language, 'timezone')}: ${settings.timezone}`)
      .addOptions([
        ...ZONES.map(([value, description]) => ({ label: value, value, description, default: value === settings.timezone })),
        { label: t(settings.language, 'custom_zone'), value: 'custom', description: t(settings.language, 'custom_zone_help') }
      ]))];
  } else if (category === 'dates') {
    preferenceRows = [
      preferenceSelect(`user:date-mode:${id}`, t(settings.language, 'date_format'), ['DMY', 'MDY', 'YMD'], settings.dateFormats[0], { DMY: t(settings.language, 'date_format_desc'), MDY: t(settings.language, 'date_format_us'), YMD: t(settings.language, 'date_format_iso') }),
      preferenceSelect(`user:date-sep:${id}`, t(settings.language, 'date_separator'), ['/', '.', '-', ','], settings.dateSeparator),
      preferenceSelect(`user:iso:${id}`, t(settings.language, 'iso'), ['true', 'false'], String(settings.isoDates), { true: t(settings.language, 'iso_on'), false: t(settings.language, 'iso_off') })
    ];
  } else if (category === 'times') {
    preferenceRows = [
      preferenceSelect(`user:time-mode:${id}`, t(settings.language, 'time_format'), ['HMS', 'HM', 'TEXT'], settings.timeFormats[0], { HMS: t(settings.language, 'time_hms'), HM: t(settings.language, 'time_hm'), TEXT: t(settings.language, 'time_text') }),
      preferenceSelect(`user:time-sep:${id}`, t(settings.language, 'time_separator'), [':', '.', '-', ',', 'h'], settings.timeSeparator),
      preferenceSelect(`user:seconds:${id}`, t(settings.language, 'seconds'), ['true', 'false'], String(settings.showSeconds), { true: t(settings.language, 'yes_seconds'), false: t(settings.language, 'no_seconds') })
    ];
  } else if (category === 'language') {
    preferenceRows = [
      preferenceSelect(`user:language:${id}`, t(settings.language, 'language'), ['fr', 'en'], settings.language, { fr: t(settings.language, 'french'), en: t(settings.language, 'english') }),
      row(button(`user:delete:${id}`, t(settings.language, 'delete_data'), ButtonStyle.Danger))
    ];
  }

  const footer = row(button(`dashboard:home:${id}`, t(settings.language, 'back_dashboard')));
  const current = `${t(settings.language, 'selected')}: ${settings.timezone} • ${settings.dateFormats[0]} • ${settings.timeFormats[0]} • ${settings.language.toUpperCase()}`;
  const description = `${notice}${notice ? '\n\n' : ''}${categoryTitle}${category === 'home' ? `\n\n${current}` : ''}`;
  return { embeds: [embed(`⚙️ Utils • ${t(settings.language, categoryName)}`, description).addFields({ name: t(settings.language, 'selected'), value: `${settings.timezone} • ${settings.dateFormats[0]} • ${settings.timeFormats[0]} • ${settings.language.toUpperCase()}`, inline: false })], components: [categoryButtons, ...preferenceRows, footer], flags: MessageFlags.Ephemeral };
}

function userDangerPayload(interaction) { return { embeds: [embed('⚠️ Supprimer mes données', 'Cette action supprime tes préférences personnelles et est définitive.', COLORS.danger)], components: [row(button(`user:delete-confirm:${owner(interaction)}`, '🗑️ Confirmer', ButtonStyle.Danger), button(`user:category:language:${owner(interaction)}`, '↩️ Annuler'))], flags: MessageFlags.Ephemeral }; }

function timestampPayload(interaction, state) {
  const id = owner(interaction);
  const settings = database.getUser(id);
  const language = settings.language;
  const current = state || { zone: settings.timezone, date: '', time: '' };
  return { embeds: [embed(t(language, 'timestamp_title'), t(language, 'timestamp_intro')).addFields({ name: t(language, 'region_zone_result'), value: current.zone || '—', inline: true }, { name: t(language, 'local_date'), value: current.date || '—', inline: true }, { name: t(language, 'local_time'), value: current.time || '—', inline: true })], components: [row(button(`timestamp:zone:${id}`, t(language, 'choose_zone'), ButtonStyle.Secondary), button(`timestamp:date:${id}`, t(language, 'choose_date')), button(`timestamp:time:${id}`, t(language, 'choose_time'))), row(button(`timestamp:confirm:${id}`, t(language, 'run_timestamp'), ButtonStyle.Success).setDisabled(!current.date || !current.time), button(`tool:back:${id}`, t(language, 'back_dashboard')))], flags: MessageFlags.Ephemeral };
}

function timestampZonePayload(interaction, selected = 'UTC') {
  const language = database.getUser(owner(interaction)).language;
  const options = [
    ...ZONES.map(([value, description]) => ({ label: value, value, description, default: value === selected })),
    { label: t(language, 'custom_zone'), value: 'custom', description: t(language, 'custom_zone_help') }
  ];
  return { embeds: [embed(t(language, 'timezone'), t(language, 'region_help'))], components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`timestamp:zone-select:${owner(interaction)}`).setPlaceholder(`${t(language, 'timezone')}: ${selected}`).addOptions(options)), back(`tool:back:${owner(interaction)}`)], flags: MessageFlags.Ephemeral };
}

function convertPayload(interaction, state) {
  const id = owner(interaction);
  const current = state || { date: '', time: '', source: 'Europe/Paris', target: database.getUser(id).timezone };
  const language = database.getUser(id).language;
  const options = selected => [
    ...ZONES.map(([value, description]) => ({ label: value, value, description, default: value === selected })),
    { label: t(language, 'custom_zone'), value: 'custom', description: t(language, 'custom_zone_help') }
  ];
  const sourceSelect = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`convert:zone-select:source:${id}`).setPlaceholder(`${t(language, 'source_zone')}: ${current.source}`).addOptions(options(current.source)));
  const targetSelect = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`convert:zone-select:target:${id}`).setPlaceholder(`${t(language, 'destination_zone')}: ${current.target}`).addOptions(options(current.target)));
  const description = `${t(language, 'conversion_intro')}\n\n${t(language, 'source_zone')}: **${current.source || '—'}**\n${t(language, 'destination_zone')}: **${current.target || '—'}**${current.target === database.getUser(id).timezone ? ` (${t(language, 'destination_default')})` : ''}\n${t(language, 'local_date')}: **${current.date || '—'}**\n${t(language, 'local_time')}: **${current.time || '—'}**`;
  return { embeds: [embed(t(language, 'conversion_title'), description)], components: [sourceSelect, targetSelect, row(button(`convert:date:${id}`, t(language, 'choose_date')), button(`convert:time:${id}`, t(language, 'choose_time'))), row(button(`convert:confirm:${id}`, t(language, 'run_conversion'), ButtonStyle.Success).setDisabled(!current.date || !current.time || !current.source || !current.target), button(`tool:back:${id}`, t(language, 'back_dashboard')))], flags: MessageFlags.Ephemeral };
}

function convertZonePayload(interaction, role, state) {
  const id = owner(interaction);
  const language = database.getUser(id).language;
  const selected = state[role];
  const options = [
    ...ZONES.map(([value, description]) => ({ label: value, value, description, default: value === selected })),
    { label: t(language, 'custom_zone'), value: 'custom', description: t(language, 'custom_zone_help') }
  ];
  const key = role === 'source' ? 'source_zone' : 'destination_zone';
  return { embeds: [embed(t(language, 'conversion_title'), role === 'source' ? t(language, 'select_source') : t(language, 'select_destination'))], components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`convert:zone-select:${role}:${id}`).setPlaceholder(`${t(language, key)}: ${selected}`).addOptions(options)), row(button(`convert:zone-back:${id}`, t(language, 'back_categories')))], flags: MessageFlags.Ephemeral };
}

module.exports = { convertPayload, convertZonePayload, dashboardPayload, databasePayload, healthPayload, journalPayload, managementPayload, permissionsPayload, timestampPayload, timestampZonePayload, toolsPayload, userDataPayload, userDangerPayload, userPayload };
