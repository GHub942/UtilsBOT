# UtilsBOT project context

- Use `/dashboard utils` as the only user-facing entry point for preferences and time tools.
- A component must be acknowledged promptly. Modal handlers acknowledge and complete their own submissions; do not send a generic second reply.
- Preferences are stored in per-user SQLite databases; server permissions and audit records use per-guild databases.
- The region menu should stay curated to city-based IANA zones plus UTC/GMT. Custom input accepts supported IANA zones, fixed abbreviations, and UTC/GMT offsets.
- UTC/GMT preference mode displays UTC during Central European winter and GMT during summer while remaining fixed at +00:00.
- Self-service permission removal is scoped to the current server. Preference deletion does not remove server permissions.
- `scripts/database.js` is an operator-only online backup/restore CLI; restore takes the bot process lock. It is not loaded by the bot at runtime.
- Put English update notes under `update_logs/Vx.xx.md`.
- Supported Node.js runtime is >=22.5. Run `npm test` before completing changes.
