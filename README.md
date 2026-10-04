# UtilsBOT

UtilsBOT is a Discord utility bot for timestamp creation and time-zone conversion. Its user-facing tools are available privately through `/dashboard utils`.

## Requirements

- Node.js 22.5 or newer
- A Discord application and bot token
- A Discord server where the bot can use application commands

## Setup

1. Copy `.env.example` to `.env`.
2. Set `DISCORD_TOKEN` and `CLIENT_ID` in `.env`. Optionally set `GUILD_ID` to deploy commands to one development server.
3. Install dependencies with `npm ci`.
4. Register the slash command with `npm run deploy`.
5. Start the bot with `npm start`.

The global command registration can take time to appear in Discord. Setting `GUILD_ID` deploys to that server for development and removes the bot's managed global command copies, avoiding duplicate global and server-specific entries. Other global commands registered for the application are preserved. When changing back to global deployment, unset `GUILD_ID` and run `npm run deploy` again.

The `start.bat` and `start.sh` launchers perform dependency installation when needed, deploy the application command, and ask whether to enable DEBUG logs for that run. They restart the bot after a crash, up to five times. The bot uses `data/bot.pid` to prevent multiple instances from using the same SQLite databases; stop an existing instance before starting another. The launchers create `.env` from `.env.example` if it does not exist; configure the file and run the launcher again.

Environment variables:

| Variable | Required | Description |
| --- | --- | --- |
| `DISCORD_TOKEN` | Yes | Bot token from the Discord Developer Portal |
| `CLIENT_ID` | Yes | Application ID from the Discord Developer Portal |
| `GUILD_ID` | No | Development server ID; omit for global command registration |
| `LOG_LEVEL` | No | `error`, `warn`, `info` (default), or `debug`; launchers override it for the current run |

## Features

- `/dashboard utils` opens personal preferences, timestamp creation, time-zone conversion, and—when authorized—server management.
- Timestamp creation displays a Discord preview, Unix timestamp, and copy-ready Discord formats.
- Time-zone conversion handles IANA time zones, fixed UTC offsets, seasonal offsets, and daylight-saving transitions.
- Preference controls use select menus. Date/time formats, separators, seconds, ISO 8601, and the default time zone are stored per user.
- Server management is permission-based. The guild owner and members with Discord's `Manage Server` permission have administrative access; other access is granted explicitly with Utils permissions.
- Data exports and the audit journal are available only to members with the corresponding Utils permission.

The removed `/timezone` and `/timestamp` application commands are not registered. Use the corresponding tools under `/dashboard utils`.

## Permissions

Only explicit Utils permissions are used for delegated access; there is no whitelist. Existing whitelist records are removed the first time a guild database is opened after this update. Whitelist-derived access is not migrated: grant any required access again through the permissions panel.

The guild owner has all Utils permissions. Members with `Manage Server` can view server statistics and assign/revoke Utils permissions. Other grantable permissions control statistics, database viewing, exports, user-data deletion, and server reset. Permission administration itself remains restricted to the guild owner and `Manage Server` members.

## Storage and privacy

The bot stores guild data in `data/guilds/<guild-id>/data.sqlite` and personal preferences in `data/users/<user-id>/data.sqlite`. Guild databases include explicit permissions, server settings, and an audit log. User databases contain preferences. SQLite uses write-ahead logging.

User-data deletion removes that user's preferences. Server administrators can export or delete user data only when assigned the corresponding permission. Keep `.env` and the `data/` directory private, restrict access to backups, and never commit tokens or database files.

## Development and tests

```sh
npm ci
npm test
```

Tests use Node's built-in test runner. See [CONTRIBUTING.md](./CONTRIBUTING.md) for development guidance and [SECURITY.md](./SECURITY.md) for reporting vulnerabilities.
