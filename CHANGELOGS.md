# Changelog

## V1.01

- Reorganized personal preferences into themed categories with select-menu controls and added a French/English language preference.
- Restricted selectable time zones to fixed named abbreviations and IANA city zones.
- Reworked timestamp and time-zone conversion results; conversion now selects source and destination zones, defaulting the destination to the user's preference.
- Added daylight-saving gap/fold handling and regression coverage.
- Added audit-log retention and user-data privacy cleanup, interaction/permission tests, SQLite backup/restore tooling, an operational status panel, CI, and Dependabot configuration.
- Documented database operations and privacy handling; prepared the remaining English localization work.

## V1.02

- Made Language & Privacy the default preferences category and added separate Language and Privacy submenus.
- Added a French/English button-based language preview that reverts after 10 seconds unless confirmed.
- Limited the region menu to ten city-based IANA zones plus UTC/GMT, while allowing supported time zones and offsets through custom entry.
- Made the UTC/GMT preference display UTC in Central European winter and GMT in summer, with the reference fixed at +00:00.
- Added self-service data review and separate deletion for bot preferences and the user's Utils permissions on the current server.
- Normalized short timestamp dates and times, including two-digit years and omitted seconds; fixed the timestamp confirmation handler export.
- Moved Copilot project context into the ignored `.copilot/` directory and documented the database backup/restore operator script.

## V1.03

- Changed the default preferences page to show a localized description of the bot.
- Replaced duplicate category-button IDs used by Language and Privacy submenu back buttons with dedicated submenu navigation IDs.
- Added regression checks ensuring every preferences page has unique Discord component custom IDs.

## V1.04

### Security and permissions

- Restricted implicit full access to the server owner; Discord's Manage Server permission no longer grants Utils access.
- Made every Utils permission explicitly assignable, including permission management.
- Limited delegated permission managers to granting or revoking permissions they already hold. Only the server owner can delegate permission management.
- Added permission checks again at the point of destructive confirmation so revoked access cannot be used through an old prompt.

### Privacy and destructive actions

- Added a second confirmation step for personal preference deletion, current-server permission deletion, administrator-initiated user-data deletion, and server resets.
- The final confirmation expires after five seconds; the prompt displays a Discord relative timestamp and timeout cancels the operation.
- Replaced embeds with plain text throughout user privacy and user-data views, including selection, review, deletion, and export responses.
- Hid the standard preference-category row while browsing language and privacy submenus.

### Operations and localization

- Expanded the operational-status panel with readiness, uptime, gateway latency, aggregate guild/member counts, shard and command counts, Node.js version, process memory, and current-server audit size. No credentials, paths, or individual user data are exposed.
- Added a relative Discord timestamp to the temporary language preview's automatic-reset notice.
- Completed and aligned English and French translation keys for user-facing messages, administrative panels, time parsing errors, and slash-command descriptions.
- Marked T4 localization work complete and added automated coverage for translation parity and literal translation references.

### Verification

- Added coverage for owner-only implicit access, explicit permission grants, permission delegation limits, hidden submenu categories, plain-text privacy panels, operational metrics, and timed two-step deletion.

## V1.05

### Audit journal filters

- Added multi-select member and action filters to the server audit journal.
- Applied selected filters together in SQLite before pagination, and reset to the first page when a filter changes.
- Preserved active filters across journal pagination and JSON export.
- Added a clear-filters control and localized the new journal controls in French and English.
- Added tests for combined SQL filters, multi-value interaction routing, rendered selections, pagination results, and filtered exports.

## V1.06

### Permissions and safety

- Added a versioned SQLite migration and support for assigning Utils permissions to server roles alongside member-level grants.
- Permission checks now include the invoking member's assigned roles. Permission management and delegation limits apply equally to role-granted capabilities.
- Replaced the server-reset final button confirmation with a modal requiring the exact uppercase text `RESET`; invalid or expired submissions do not modify server data.

### Dashboard and preferences

- Changed the time-zone selector to a single `UTC/GMT` option while preserving its automatic seasonal label and fixed zero offset.
- Kept the custom time-zone entry available regardless of the current selection.
- Rendered the personal “View my data” privacy screen as an embed; administrator-facing user-data review remains plain text.
- Displayed process uptime as a Discord-relative timestamp, added emoji-led operational metrics, and added a refresh button.

### Verification

- Added tests for role permission persistence and resolution, exact reset phrase validation, privacy presentation, UTC/GMT option rendering, uptime timestamps, and refreshable status output.

## V1.07

### Permissions and interaction stability

- Resolved role-based permissions from both discord.js cached role collections and Discord's raw interaction-member role ID arrays.
- Added a one-second per-user cooldown to all Discord interactions and a separate three-second cooldown for operational-status refreshes. Cooldown notices are private embeds with relative retry times.

### Dashboard and response consistency

- Moved custom time-zone entry to a dedicated button so the time-zone select remains ready for repeat selections; the current region is displayed in the embed.
- Ensured time-zone selects do not preselect their previous value and show the selected zone in timestamp and conversion panels.
- Converted user-data review, exports, destructive-action prompts/results, expired flows, and generic errors to embeds.
- Updated deletion cancellation to return users to the preceding confirmation panel instead of ending the flow.
- Hid the standard preference category selector inside the language sub-menu.

### Verification

- Added regression coverage for raw role arrays, repeatable time-zone selectors, embed presentation, deletion cancellation, and general/status cooldowns.

## V1.08

### Interaction cooldowns and time-zone menus

- Confirmed and regression-tested a shared one-second per-user cooldown across slash commands, buttons, select menus, and modal submissions. The operational-status refresh retains its separate three-second cooldown.
- Removed the standalone custom time-zone buttons and restored “Other time zone...” as an option in the region, timestamp, and conversion select menus.
- Custom-zone selections now open the relevant modal without deferring the select interaction first. Select menus remain unselected after each choice, so users can reselect the custom option.

### Verification

- Added coverage for cooldown behavior across interaction types and for opening the custom-zone modal from the region selector.

## V1.09

### Guild presence monitor

- Added a server-owner/permission-manager configuration panel to select a text channel, up to five members or bots, and a refresh-button audience.
- Added one public embed for all selected accounts with online, idle, do-not-disturb, or offline state; detected activity; and an approximate Discord-relative online duration.
- Added scheduled refreshes aligned to five-minute boundaries, manual refresh authorization modes, and monitor disable/cleanup.
- Server reset now removes any published presence embed before clearing guild settings.
- Added a grantable `view_presence` Utils permission and persisted monitor settings and online start times in the guild database.
- Enabled Discord's privileged Presence Intent and documented the required Developer Portal toggle and channel visibility implications.

### Verification

- Added tests for status embeds, the five-member cap, persisted configuration, scheduled-message edits, permission modes, and configuration controls.

## V1.10

### Gateway intent recovery

- Made presence monitoring opt-in through `PRESENCE_MONITOR_ENABLED=true`; the default bot startup no longer requests Discord's privileged Presence Intent.
- Added automatic reconnect without presence monitoring when Discord rejects the privileged intent, including Discord's disallowed-intents close code. Other bot commands remain available instead of entering a launcher crash loop.
- Removed published presence messages when monitoring is disabled or the bot falls back, preventing stale public status data.
- Added setup instructions for enabling the Presence Intent and environment variable.

### Backend language

- Translated launcher prompts, startup/deployment errors, interaction logs, and server-reset audit details to English.
- Kept intentional French user-facing localization in the bilingual bot interface.

### Verification

- Added tests for disallowed-intent error detection and presence-monitor cleanup; all automated tests pass.

## V1.11

### Presence monitor status display

- Replaced raw member mention syntax in embed field titles with cached member display names or usernames, with a clear fallback when the member is not cached.
- Clarified that the online duration begins when Utils first observes a member online, rather than implying it knows the member's actual login time.
- Made the embed's last-updated label clearer in English and French.

### Verification

- Added coverage for readable member names, uncached-member fallback, and observed-online wording.

## V1.12

### Presence monitor improvements

- Added an explicit `manage_presence` permission for configuring monitored members, the publishing channel, and refresh access.
- Added distinct visual indicators for online, idle, do-not-disturb, offline, and unavailable statuses.
- Marked missing member/status cache information as unavailable instead of treating it as offline.
- Included the server name and showed last and next scheduled refresh times.
- Added a 15-second per-user and 5-second per-server manual refresh cooldown.

### Verification

- Added tests for status presentation, unavailable data, refresh timestamps, cooldown behavior, and role-based monitor permission.

## V1.13

### Presence monitor corrections

- Moved Discord relative timestamps from the embed footer into its description, where Discord renders them correctly.
- Added a non-notifying user mention and a code-formatted user ID to each member field.
- Made the refresh button visibly disable and show the five-second per-server wait; kept the 15-second per-user cooldown with a private retry deadline.
- Scoped refresh cooldown state to each guild so activity in one server does not block another.

### Verification

- Added assertions for description timestamps, member mention/ID fields, visible cooldown state, and independent guild cooldowns.

## V1.14

### Presence monitor channel permissions

- Check the bot's View Channel, Send Messages, and Embed Links permissions before replacing a monitor configuration.
- Preserve the existing configuration if Discord rejects publishing the new monitor.
- Show an actionable localized warning in the settings panel instead of allowing a missing-permissions error to surface as a generic interaction failure.
- Pause automatic publishing after a permission denial to avoid repeating failed API requests; owners can restore channel access and save settings to resume.

### Verification

- Added coverage for preflight channel-permission validation and preserving configuration when publication cannot proceed.
