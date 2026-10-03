const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, StringSelectMenuBuilder, UserSelectMenuBuilder } = require('discord.js');
const database = require('./database');
const { ZONES } = require('./components');
const { PERMISSIONS, PERMISSION_LABELS, canOpenServerDashboard, hasPermission } = require('./permissions');

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
  return { embeds: [embed('🧰 Utils • Outils temps', 'Choisis un outil. Chaque parcours reste privé et utilise tes préférences personnelles.', COLORS.main).addFields({ name: '🕒 Timestamp', value: 'Génère un timestamp Discord et ses formats prêts à copier.', inline: true }, { name: '🌍 Conversion de fuseau', value: 'Convertit une date entre fuseaux en tenant compte des transitions saisonnières.', inline: true })], components: [row(button(`tool:timestamp:${id}`, '🕒 Timestamp', ButtonStyle.Primary), button(`tool:timezone:${id}`, '🌍 Convertir un fuseau', ButtonStyle.Primary)), back(`dashboard:home:${id}`)], flags: MessageFlags.Ephemeral };
}

function managementPayload(interaction) {
  const canStats = hasPermission(interaction, PERMISSIONS.VIEW_STATS);
  const stats = canStats ? database.getStats(interaction.guildId) : null;
  return { embeds: [embed('🛡️ Utils • Gestion serveur', 'Les données et permissions concernent uniquement ce serveur.\n\n`Gérer le serveur` permet de consulter les statistiques. Les autres actions nécessitent une permission Utils explicite attribuée par un administrateur.').addFields({ name: '📊 Actions journalisées', value: canStats ? String(stats.audit) : 'Accès requis', inline: true }, { name: '🔐 Permissions', value: 'Gérées par le propriétaire ou un administrateur du serveur.', inline: true })], components: [row(button(`manage:database:${owner(interaction)}`, '🗄️ Base de données', ButtonStyle.Primary), button(`manage:stats:${owner(interaction)}`, '📊 Stats').setDisabled(!canStats)), row(button(`dashboard:home:${owner(interaction)}`, '↩️ Retour'))], flags: MessageFlags.Ephemeral };
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

function userPayload(interaction, notice = '', page = 1) {
  const settings = database.getUser(interaction.user.id);
  const id = owner(interaction);
  const preferenceRows = page === 1
    ? [
        new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`user:timezone-select:${id}`).setPlaceholder(`🌍 Fuseau : ${settings.timezone}`).addOptions([
          ...ZONES.map(([value, description]) => ({ label: value, value, description, default: value === settings.timezone })),
          { label: 'Autre fuseau IANA…', value: 'custom', description: 'Saisir un nom de fuseau valide' }
        ])),
        preferenceSelect(`user:date-mode:${id}`, '🗓️ Format de date', ['DMY', 'MDY', 'YMD'], settings.dateFormats[0], { DMY: 'Jour / mois / année', MDY: 'Mois / jour / année', YMD: 'Année / mois / jour' }),
        preferenceSelect(`user:time-mode:${id}`, '🕒 Format de l’heure', ['HMS', 'HM', 'TEXT'], settings.timeFormats[0], { HMS: 'Heures, minutes et secondes', HM: 'Heures et minutes', TEXT: 'Texte (14h 30m)' }),
        preferenceSelect(`user:date-sep:${id}`, '🗓️ Séparateur de date', ['/', '.', '-', ','], settings.dateSeparator)
      ]
    : [
        preferenceSelect(`user:time-sep:${id}`, '🕒 Séparateur d’heure', [':', '.', '-', ',', 'h'], settings.timeSeparator),
        preferenceSelect(`user:seconds:${id}`, '⏱️ Afficher les secondes', ['true', 'false'], String(settings.showSeconds), { true: 'Oui, afficher', false: 'Non, masquer' }),
        preferenceSelect(`user:iso:${id}`, '🔤 Dates ISO 8601', ['true', 'false'], String(settings.isoDates), { true: 'Activer ISO 8601', false: 'Désactiver ISO 8601' })
      ];
  const navigation = page === 1
    ? row(button(`user:page:2:${id}`, 'Autres préférences ▶️', ButtonStyle.Primary), button(`dashboard:home:${id}`, '↩️ Retour'))
    : row(button(`user:page:1:${id}`, '◀️ Préférences précédentes'), button(`user:delete:${id}`, '🗑️ Supprimer mes données', ButtonStyle.Danger), button(`dashboard:home:${id}`, '↩️ Retour'));
  const description = page === 1
    ? 'Choisis un fuseau, un format de date et un format d’heure. Les sélections s’appliquent immédiatement.'
    : 'Personnalise les séparateurs et options de format. Les sélections s’appliquent immédiatement.';
  return { embeds: [embed(`⚙️ Utils • Mes préférences (${page}/2)`, `${notice}${notice ? '\n\n' : ''}${description}`).addFields({ name: '🌍 Fuseau', value: settings.timezone, inline: true }, { name: '🗓️ Date', value: `${settings.dateFormats.join(' → ')} • ${settings.dateSeparator}`, inline: true }, { name: '🕒 Heure', value: `${settings.timeFormats.join(' → ')} • ${settings.timeSeparator}`, inline: true }, { name: '⏱️ Secondes / ISO', value: `${settings.showSeconds ? 'Secondes activées' : 'Secondes masquées'} • ISO ${settings.isoDates ? 'activé' : 'désactivé'}`, inline: false })], components: [...preferenceRows, navigation], flags: MessageFlags.Ephemeral };
}

function userDangerPayload(interaction) { return { embeds: [embed('⚠️ Supprimer mes données', 'Cette action supprime tes préférences personnelles et est définitive.', COLORS.danger)], components: [row(button(`user:delete-confirm:${owner(interaction)}`, '🗑️ Confirmer', ButtonStyle.Danger), button(`user:page:2:${owner(interaction)}`, '↩️ Annuler'))], flags: MessageFlags.Ephemeral }; }

function timestampPayload(interaction, state) {
  const id = owner(interaction);
  const settings = database.getUser(id);
  const current = state || { zone: settings.timezone || 'UTC', date: '', time: '' };
  return { embeds: [embed('🕒 Utils • Timestamp', 'Saisis la date et l’heure dans le fuseau choisi. Le résultat inclura l’heure locale, le timestamp Unix et les formats Discord prêts à copier.').addFields({ name: '🌍 Fuseau source', value: current.zone || 'Non défini', inline: true }, { name: '📅 Date', value: current.date || 'Non définie', inline: true }, { name: '⏰ Heure', value: current.time || 'Non définie', inline: true })], components: [row(button(`timestamp:zone:${id}`, '🌍 Fuseau horaire', ButtonStyle.Secondary), button(`timestamp:date:${id}`, '📅 Définir la date'), button(`timestamp:time:${id}`, '⏰ Définir l’heure')), row(button(`timestamp:confirm:${id}`, '✅ Générer le timestamp', ButtonStyle.Success).setDisabled(!current.date || !current.time), button(`tool:back:${id}`, '↩️ Outils temps'))], flags: MessageFlags.Ephemeral };
}

function timestampZonePayload(interaction, selected = 'UTC') {
  const options = [
    ...ZONES.map(([value, description]) => ({ label: value, value, description, default: value === selected })),
    { label: 'Autre fuseau IANA…', value: 'custom', description: 'Saisir un fuseau ou un décalage UTC' }
  ];
  return { embeds: [embed('🌍 Utils • Fuseau du timestamp', 'Choisis un fuseau de la liste ou saisis un nom IANA ou un décalage UTC personnalisé.')], components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`timestamp:zone-select:${owner(interaction)}`).setPlaceholder(`🌍 Fuseau : ${selected}`).addOptions(options)), back(`tool:back:${owner(interaction)}`)], flags: MessageFlags.Ephemeral };
}

function convertPayload(interaction, state) {
  const id = owner(interaction);
  const current = state || { date: '', time: '', source: '' };
  return { embeds: [embed('🔁 Utils • Conversion de fuseau', 'Saisis une date et une heure dans le fuseau source. La conversion vers le fuseau de destination tient compte de la date et des changements saisonniers.').addFields({ name: '📅 Date', value: current.date || 'Non définie', inline: true }, { name: '⏰ Heure', value: current.time || 'Non définie', inline: true }, { name: '📍 Fuseau source', value: current.source || 'Non défini', inline: true }, { name: '🎯 Fuseau de destination', value: 'UTC en hiver / GMT en été', inline: false })], components: [row(button(`convert:date:${id}`, '📅 Définir la date'), button(`convert:time:${id}`, '⏰ Définir l’heure'), button(`convert:source:${id}`, '📍 Définir le fuseau source')), row(button(`convert:confirm:${id}`, '✅ Convertir', ButtonStyle.Success).setDisabled(!current.date || !current.time || !current.source), button(`tool:back:${id}`, '↩️ Outils temps'))], flags: MessageFlags.Ephemeral };
}

module.exports = { convertPayload, dashboardPayload, databasePayload, journalPayload, managementPayload, permissionsPayload, timestampPayload, timestampZonePayload, toolsPayload, userDataPayload, userDangerPayload, userPayload };
