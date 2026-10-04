const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { dateInputExample, discordTimestampFormats, formatLocal, parseDateTime, resolveZone, timeInputExample } = require('../time');
const database = require('../database');
const panels = require('../panels');

const drafts = new Map();

function modal(field, label, title) {
  const placeholder = field === 'date' ? dateInputExample() : timeInputExample();
  return new ModalBuilder().setCustomId(`timestamp:field:${field}`).setTitle(title).addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(field).setLabel(`${label} (ex: ${placeholder})`).setPlaceholder(placeholder).setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true)));
}

function getDraft(userId) {
  return drafts.get(userId) || { zone: database.getUser(userId).timezone || 'UTC', date: '', time: '', origin: null };
}

async function execute(interaction) {
  const draft = getDraft(interaction.user.id);
  const payload = panels.timestampPayload(interaction, draft);
  if (interaction.isButton()) await interaction.update(payload);
  else await interaction.reply(payload);
  draft.origin = interaction;
  drafts.set(interaction.user.id, draft);
}

async function openField(interaction, field) {
  return interaction.showModal(modal(field, field === 'date' ? 'Date' : 'Heure', field === 'date' ? '📅 Définir la date' : '⏰ Définir l’heure'));
}

async function openZoneField(interaction) {
  const input = new TextInputBuilder().setCustomId('zone').setLabel('Fuseau IANA ou décalage UTC').setPlaceholder('Europe/Paris ou UTC+01:00').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true);
  const zoneModal = new ModalBuilder().setCustomId('timestamp:zone:modal').setTitle('🌍 Fuseau personnalisé').addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(zoneModal);
}

async function updateDraftMessage(userId, payload) {
  const draft = drafts.get(userId);
  if (!draft?.origin) return false;
  try {
    await draft.origin.editReply(payload);
    return true;
  } catch (error) {
    if (error.code !== 10008) throw error;
    draft.origin = null;
    return false;
  }
}

async function handleModal(interaction) {
  const field = interaction.customId.split(':')[2];
  const draft = getDraft(interaction.user.id);
  draft[field] = interaction.fields.getTextInputValue(field).trim();
  drafts.set(interaction.user.id, draft);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const updated = await updateDraftMessage(interaction.user.id, panels.timestampPayload(interaction, draft));
  if (!updated) return interaction.editReply({ content: 'Ce parcours a expiré. Relance l’outil depuis le tableau de bord.' });
  await interaction.deleteReply();
}

async function handleZoneModal(interaction) {
  const value = interaction.fields.getTextInputValue('zone').trim();
  if (!resolveZone(value)) return interaction.reply({ content: '❌ Fuseau inconnu. Saisis un nom IANA valide ou un décalage UTC entre UTC-14:00 et UTC+14:00.', flags: MessageFlags.Ephemeral });
  const draft = getDraft(interaction.user.id);
  draft.zone = value;
  drafts.set(interaction.user.id, draft);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const updated = await updateDraftMessage(interaction.user.id, panels.timestampPayload(interaction, draft));
  if (!updated) return interaction.editReply({ content: 'Ce parcours a expiré. Relance l’outil depuis le tableau de bord.' });
  await interaction.deleteReply();
}

async function handleZone(interaction) {
  const draft = getDraft(interaction.user.id);
  draft.zone = interaction.values[0];
  drafts.set(interaction.user.id, draft);
  return interaction.update(panels.timestampPayload(interaction, draft));
}

async function confirm(interaction) {
  const draft = getDraft(interaction.user.id);
  const parsed = parseDateTime(`${draft.date} ${draft.time}`, draft.zone, database.getUser(interaction.user.id));
  if (parsed.error) return interaction.update({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('❌ Timestamp invalide').setDescription(`${parsed.error}\n\nVérifie les champs et réessaie.`)], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`timestamp:date:${interaction.user.id}`).setLabel('📅 Corriger la date').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId(`timestamp:time:${interaction.user.id}`).setLabel('⏰ Corriger l’heure').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId(`timestamp:zone:${interaction.user.id}`).setLabel('🌍 Modifier le fuseau').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId(`tool:back:${interaction.user.id}`).setLabel('↩️ Outils temps').setStyle(ButtonStyle.Secondary))] });
  const seconds = Math.floor(parsed.dateTime.toUTC().toMillis() / 1000);
  const formats = discordTimestampFormats(seconds);
  if (interaction.guildId) database.addAudit(interaction.guildId, 'timestamp.create', interaction.user.id, draft.zone);
  const labels = { d: 'Short date', D: 'Long date', t: 'Short time', T: 'Long time', f: 'Date and time', F: 'Full date and time', R: 'Relative time' };
  const lines = Object.entries(formats).map(([type, formula]) => `**${labels[type]}** (\`:${type}\`) \`${formula}\``).join('\n');
  drafts.delete(interaction.user.id);
  const offset = parsed.dateTime.offset;
  return interaction.update({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('🕒 Timestamp prêt').setDescription(`Le timestamp représente le même instant pour tous les membres ; Discord l’affiche dans le fuseau local de chacun.\n\n**Date saisie**\n${formatLocal(parsed.dateTime)} • \`${draft.zone}\` (UTC${offset >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')}:${String(Math.abs(offset) % 60).padStart(2, '0')})\n\n**Aperçu Discord**\n<t:${seconds}:F>\n\n**Timestamp Unix**\n\`${seconds}\`\n\n**Formats à copier**\n${lines}`)], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`timestamp:again:${interaction.user.id}`).setLabel('🔁 Créer un autre timestamp').setStyle(ButtonStyle.Primary))] });
}

module.exports = {
  execute,
  drafts,
  getDraft,
  handleModal,
  handleZoneModal,
  handleZone,
  confirm,
  openField,
  updateDraftMessage,
  openZoneField,
  async again(interaction) { return execute(interaction); }
};
