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
  throw new Error('DISCORD_TOKEN et CLIENT_ID sont requis dans le fichier .env');
}

const commandsPath = path.join(__dirname, 'src', 'commands');
const commands = fs.readdirSync(commandsPath)
  .filter(file => file.endsWith('.js'))
  .map(file => require(path.join(commandsPath, file)))
  .filter(command => command.data)
  .map(command => command.data.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
const route = process.env.GUILD_ID
  ? Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID)
  : Routes.applicationCommands(process.env.CLIENT_ID);

(async () => {
  const deployed = await rest.put(route, { body: commands });
  const scope = process.env.GUILD_ID ? `le serveur ${process.env.GUILD_ID}` : 'globalement';
  console.log(`${deployed.length} commande(s) deployee(s) ${scope}.`);
})().catch(error => {
  console.error('Echec du deploiement:', error.message);
  process.exitCode = 1;
});
