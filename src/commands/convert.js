const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { arrivalModesForDate, dateInputExample, formatLocal, formatOffset, getEquivalentZones, parseDateTime, representativeCountries, resolveZone, timeInputExample } = require('../time');
const database = require('../database');
const panels = require('../panels');

const drafts = new Map();

function modal(field, label, title, userId) {
  const settings = database.getUser(userId);
  const placeholder = field === 'date' ? dateInputExample(settings) : field === 'time' ? timeInputExample(settings) : 'Europe/Paris';
  return new ModalBuilder().setCustomId(`convert:field:${field}`).setTitle(title).addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(field).setLabel(`${label} (ex: ${placeholder})`).setPlaceholder(placeholder).setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true)));
}

function getDraft(userId) { return drafts.get(userId) || { date: '', time: '', source: '', origin: null }; }
async function execute(interaction) {
  const draft = getDraft(interaction.user.id);
  const payload = panels.convertPayload(interaction, draft);
  if (interaction.isButton()) await interaction.update(payload);
  else await interaction.reply(payload);
  draft.origin = interaction;
  drafts.set(interaction.user.id, draft);
}
async function openField(interaction, field) {
  return interaction.showModal(modal(field, field === 'date' ? 'Date' : field === 'time' ? 'Heure' : 'Fuseau de départ', field === 'date' ? '📅 Définir la date' : field === 'time' ? '⏰ Définir l’heure' : '📍 Définir le fuseau de départ', interaction.user.id));
}
async function handleModal(interaction) {
  const field = interaction.customId.split(':')[2];
  const draft = getDraft(interaction.user.id);
  draft[field] = interaction.fields.getTextInputValue(field).trim();
  drafts.set(interaction.user.id, draft);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let updated = false;
  if (draft.origin) {
    try {
      await draft.origin.editReply(panels.convertPayload(interaction, draft));
      updated = true;
    } catch (error) {
      if (error.code !== 10008) throw error;
      draft.origin = null;
    }
  }
  if (!updated) return interaction.editReply({ content: 'Ce parcours a expiré. Relance l’outil depuis le tableau de bord.' });
  await interaction.deleteReply();
}
async function confirm(interaction) {
  const draft = getDraft(interaction.user.id);
  const parsed = parseDateTime(`${draft.date} ${draft.time}`, draft.source, database.getUser(interaction.user.id));
  if (parsed.error) return interaction.update({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('❌ Conversion invalide').setDescription(`${parsed.error}\n\nVérifie les champs et réessaie.`)], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`convert:date:${interaction.user.id}`).setLabel('📅 Corriger la date').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId(`convert:time:${interaction.user.id}`).setLabel('⏰ Corriger l’heure').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId(`convert:source:${interaction.user.id}`).setLabel('📍 Corriger le fuseau').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId(`tool:back:${interaction.user.id}`).setLabel('↩️ Outils temps').setStyle(ButtonStyle.Secondary))] });
  const modes = arrivalModesForDate(parsed.dateTime);
  if (modes.length > 1) {
    const buttons = modes.map(mode => new ButtonBuilder().setCustomId(`convert:arrival:${mode}:${interaction.user.id}`).setLabel(mode).setStyle(ButtonStyle.Primary));
    drafts.set(interaction.user.id, { ...draft, parsed: parsed.dateTime });
    return interaction.update({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle('⚠️ Choix autour du changement d’heure').setDescription('La date est proche d’une transition saisonnière. Choisis l’interprétation de l’arrivée.')], components: [new ActionRowBuilder().addComponents(buttons)] });
  }
  return renderConversion(interaction, parsed.dateTime, draft.source, modes[0]);
}
function renderConversion(interaction, source, sourceInput, arrival) {
  if (!source?.isValid) return interaction.update({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('❌ Conversion expirée').setDescription('Le brouillon de conversion a expiré. Recommence depuis le tableau de bord.')], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`tool:timezone:${interaction.user.id}`).setLabel('🔁 Recommencer').setStyle(ButtonStyle.Primary))] });
  const target = resolveZone(arrival);
  const converted = source.setZone(target.zone);
  const equivalents = getEquivalentZones(converted, target).slice(0, 20);
  if (interaction.guildId) database.addAudit(interaction.guildId, 'convert.create', interaction.user.id, `${sourceInput} -> ${arrival}`);
  drafts.delete(interaction.user.id);
  const seconds = Math.floor(converted.toUTC().toMillis() / 1000);
  return interaction.update({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('🔁 Conversion terminée').setDescription('La conversion conserve le même instant et applique le décalage valide à cette date.').addFields({ name: '📍 Départ', value: `${formatLocal(source)}\n\`${sourceInput}\``, inline: true }, { name: '🎯 Arrivée', value: `${formatLocal(converted)}\n\`${arrival}\``, inline: true }, { name: '🕰️ Décalage cible', value: `UTC${formatOffset(converted.offset)}`, inline: true }, { name: '🔢 Timestamp Unix', value: `\`${seconds}\``, inline: true }, { name: '🌍 Pays représentatifs', value: representativeCountries(converted.offset).join(' • '), inline: true }, { name: '🔁 Fuseaux au même décalage', value: equivalents.join(', ').slice(0, 1024) || 'Aucun', inline: false })], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`convert:again:${interaction.user.id}`).setLabel('🔁 Recommencer').setStyle(ButtonStyle.Primary))] });
}
async function handleArrival(interaction, arrival) {
  const draft = getDraft(interaction.user.id);
  return renderConversion(interaction, draft.parsed, draft.source, arrival);
}
module.exports = { execute, drafts, getDraft, handleModal, openField, confirm, handleArrival, async again(interaction) { return execute(interaction); } };
