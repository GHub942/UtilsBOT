const { SlashCommandBuilder } = require('discord.js');
const { dashboardPayload, userPayload } = require('../panels');
const { canOpenServerDashboard } = require('../permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dashboard')
    .setDescription('Open the Utils dashboard')
    .setDescriptionLocalizations({ fr: 'Ouvre le tableau de bord de Utils' })
    .addSubcommand(subcommand => subcommand
      .setName('utils')
      .setDescription('Manage Utils for this server or your account')
      .setDescriptionLocalizations({ fr: 'Gère Utils pour ce serveur ou ton compte' })),

  async execute(interaction) {
    await interaction.reply(canOpenServerDashboard(interaction) ? dashboardPayload(interaction) : userPayload(interaction));
  }
};
