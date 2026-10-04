const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch (error) {
  if (error.code === 'ENOENT') {
    console.error('The .env file was not found. Copy .env.example to .env and configure the bot.');
    process.exit(1);
  }
  throw error;
}

if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID) {
  throw new Error('DISCORD_TOKEN and CLIENT_ID are required in the .env file.');
}

const commandsPath = path.join(__dirname, 'src', 'commands');
const commands = fs.readdirSync(commandsPath)
  .filter(file => file.endsWith('.js'))
  .map(file => require(path.join(commandsPath, file)))
  .filter(command => command.data)
  .map(command => command.data.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
const globalRoute = Routes.applicationCommands(process.env.CLIENT_ID);

(async () => {
  if (process.env.GUILD_ID) {
    const managedNames = new Set([...commands.map(command => command.name), 'timestamp', 'timezone']);
    const currentGlobalCommands = await rest.get(globalRoute);
    const retainedGlobalCommands = currentGlobalCommands.filter(command => !managedNames.has(command.name));

    if (retainedGlobalCommands.length !== currentGlobalCommands.length) {
      await rest.put(globalRoute, { body: retainedGlobalCommands });
      console.log('Removed stale global Utils commands to avoid duplicate server registrations.');
    }

    const guildRoute = Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID);
    const deployed = await rest.put(guildRoute, { body: commands });
    console.log(`${deployed.length} command(s) registered for the configured development server.`);
    return;
  }

  const deployed = await rest.put(globalRoute, { body: commands });
  console.log(`${deployed.length} command(s) registered globally.`);
})().catch(error => {
  console.error('Command deployment failed:', error.message);
  process.exitCode = 1;
});
