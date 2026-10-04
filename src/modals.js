const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { t } = require('./i18n');

function field(id, label, value = '') {
  return new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setMaxLength(100).setValue(value).setRequired(true));
}

function timezone(value, language = 'fr') {
  return new ModalBuilder()
    .setCustomId('user:timezone:modal')
    .setTitle(t(language, 'timezone_modal_title'))
    .addComponents(field('timezone', t(language, 'timezone_modal_label'), value));
}

module.exports = { timezone };
