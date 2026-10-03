# Contributing

## Development setup

1. Install Node.js 22.5 or newer.
2. Copy `.env.example` to `.env` and set the Discord credentials for a development application.
3. Set `GUILD_ID` to a test server to make command registration available sooner.
4. Run `npm ci`.
5. Run `npm test` before submitting a change.

Do not use production credentials or production databases for development. Keep `.env`, SQLite files, exported data, and other sensitive material out of commits.

## Changes

- Keep changes focused and follow the existing CommonJS and Node.js patterns.
- Preserve IANA time-zone and daylight-saving behavior when modifying date handling.
- Keep authorization checks on server-data actions and test both allowed and denied access.
- Update the README and security guidance when behavior, configuration, storage, or permissions change.
- Add focused tests for bug fixes and new behavior. Use Node's built-in `node:test` runner.
- Check that documentation intended for users is clear and accurate.

## Pull requests

Describe the behavior changed, the reason for the change, and the validation performed. Include any migration or permission changes that affect existing installations. Do not include tokens, private server data, or database exports in the pull request.
