const { MessageFlags } = require('discord.js');

function responseProxy(interaction, mode) {
  return new Proxy(interaction, {
    get(target, property) {
      if (mode === 'command' && property === 'reply') return target.editReply.bind(target);
      if (mode === 'component' && property === 'update') return target.editReply.bind(target);
      if (mode === 'component' && property === 'reply') return target.followUp.bind(target);
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

async function acknowledgeCommand(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  return responseProxy(interaction, 'command');
}

async function acknowledgeComponent(interaction) {
  await interaction.deferUpdate();
  return responseProxy(interaction, 'component');
}

module.exports = { acknowledgeCommand, acknowledgeComponent };
