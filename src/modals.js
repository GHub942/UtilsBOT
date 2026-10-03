const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

function field(id, label, value = '') {
  return new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setMaxLength(100).setValue(value).setRequired(true));
}

function timezone(value) {
  return new ModalBuilder().setCustomId('user:timezone:modal').setTitle('🌍 Fuseau par défaut').addComponents(field('timezone', 'Europe/Paris, UTC+1...', value));
}

module.exports = { timezone };
