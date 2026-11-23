# Discord permissions

What Spinner Bot needs from Discord, why, and what to add for planned features. `pnpm --filter @scrimbot/bot tester:smoke <link>` checks the test server against this.

## Install settings

- **Scopes:** `bot` and `applications.commands`.
- **Permission integer:** `309237763072` (View Channel, Send Messages, Embed Links, Attach Files, Read Message History, Create Public Threads, Send Messages in Threads). The thread permissions are for roster pings and for posting rosters in threads.
- **Role:** keep the bot role low. It never manages roles or members, and never needs Administrator.
- **Portal toggle:** turn on **Message Content Intent**. Discord returns `embeds` empty on messages from other bots without it, even over REST, so `/build-roster` would report "is not an Apollo event". The toggle is what matters. The bot does not send the intent bit.
- **Gateway intents the bot sends:** `Guilds` and `GuildVoiceStates`. Don't enable Server Members or Presence.

## Per channel

Give these as allow overrides on the Apollo channel and every channel rosters are posted in (or their category). A deny on a category or `@everyone` beats a server-wide grant.

| Permission               | Why                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------ |
| View Channel             | Read Apollo's message, post the roster                                               |
| Read Message History     | Fetch a message by ID: Apollo's, and the bot's own roster when redrawing the counter |
| Send Messages            | Post the roster                                                                      |
| Embed Links              | The roster is an embed. Without it the embed does not show                           |
| Attach Files             | The crest, banner and roster image are uploaded with the roster                      |
| Create Public Threads    | **Ping pending** starts a "Roster pings" thread on the roster                        |
| Send Messages in Threads | Ping in that thread, and post rosters if scrims are organised in threads             |

For `/join-lobby`, also View Channel on the voice channels it should list. No REST list of occupants exists, so it reads voice state events, and it needs no Connect or Speak because it never joins audio. Discord doesn't allow `steam://` on link buttons, so they go through a page on the web app.

Not needed: slash command replies, live preview edits and button updates (interaction responses), editing or deleting the bot's own messages, same-server custom emoji, pinging users with `<@id>`, and `members.search` (works without the Server Members intent).

Members need **Use Application Commands** in the channels where they run commands. Server Settings, Integrations can hide a command, and `requiredPermissions` is checked on every use.

`/build-roster` checks these when the leader presses **Continue** and again on **Post roster**, and names whichever are missing. Without the two thread permissions, **Ping pending** still works: it says so in its confirmation and replies to the roster in the channel instead.

## Who may use commands

`apps/bot/src/command-access.ts` decides this. Commands are for server admins and the server's staff roles, unless named in `PUBLIC_COMMANDS`. The staff roles are in the database, one list per server. An admin changes them with `/staff-roles`, which only members with the Administrator permission can use, checked on every use. A fresh database has no staff roles, so only admins can use the commands until one is added. Add a name there and deploy to open a command to everyone. The bot checks on every use, so changing Server Settings, Integrations can't grant access to a restricted command. The bot's token can't set per-role overrides, so restricted commands are hidden with the `STAFF_VISIBILITY` permission (Moderate Members). On ARACHNE, BLOOD WARDEN and PACK COMMANDER also hold it, so they see these commands and are refused.

## Planned features

| Feature               | Intent                              | Permission                                                       | Notes                                                                                                                                                             |
| --------------------- | ----------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DM reminders          | none to send                        | none                                                             | Use `client.users.send(id, ...)`. Error 50007 when a member blocks DMs. Make it opt-in and rate-limited, bulk DMs get bots flagged                                |
| Voice channel status  | `Guilds`                            | View Channel to read, Set Voice Channel Status (bit 48) to write | Gateway event `VOICE_CHANNEL_STATUS_UPDATE`. discord.js 14.27 has no handler, listen to the raw event. Writing without being connected also needs Manage Channels |
| Server activity stats | `GuildMessages`, `GuildVoiceStates` | View Channel, Read Message History to backfill                   | Counting authors needs no Message Content. Join and leave stats need the privileged Server Members intent. Skip Presence                                          |

Integer with voice status as well: `281784214473728`.

## Known gap

Redrawing the answer counter fetches the posted message first, so removing Read Message History from a roster channel silently stops updates. Editing by ID with `client.rest.patch(Routes.channelMessage(...))` would remove that dependency.
