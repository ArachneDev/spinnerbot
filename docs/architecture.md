# Architecture

## Goal

Hybrid with Apollo today, and **replacing Apollo completely in the long term**. Apollo is read by one parser in `packages/core/src/integrations/apollo/`. Nothing else in the system depends on Apollo's message layout, so a native event source can replace it. `EventSource` in `packages/core/src/events.ts` is the seam for that, and nothing implements it yet.

## Flow

1. **`/build-roster <link or ID>`** reads sign-ups from an Apollo event message and privately shows what it understood: title, start time and the Accepted, Declined and Tentative names. The leader presses **Continue** or **Cancel**.
2. **Continue** creates a roster and sends a private link, `PUBLIC_URL/r/<token>`, with a live preview and the buttons **Post roster**, **Refresh preview** and **Cancel**.
3. **On the web page** the leader puts each accepted player in one of 7 squads or on the bench, and can customise the answer buttons (see below). Changes save by themselves, and the preview in Discord follows.
4. **Post roster** publishes the roster in the channel with answer buttons, a `Confirmed N/M` counter and one **⚙️ Manage** button. Everyone sees it, but it only opens for the roster's creator, privately, with **Edit roster**, **Ping pending** and **Delete**. Rosters posted before this keep their separate Edit roster and Delete buttons until they are updated.
5. **Players** press an answer. Each listed player is shown with their answer, and the counter updates.
6. **Manage**, then **Ping pending** reminds listed players who haven't answered. It asks first, naming them and how many can't be pinged because they weren't matched to a Discord user. The mentions go in a "Roster pings" thread on the roster, as plain text because mentions in embeds don't notify, and only those users may be notified. A thread started from a message has that message's ID, so the bot finds it again without storing it, and unarchives it if needed. Without the thread permissions it replies to the roster instead. Each roster can be pinged once every 10 minutes, kept in memory, so a restart allows one early ping.
7. **Manage**, then **Edit roster** (for dropouts) reopens the link and preview privately. The public message stays as it is until **Update roster**, and **Discard changes** drops the edit.
8. **`/readycheck <link>`** is not built yet. It would show who is ready, list who is missing by squad, and offer a ping button.

A leader's steps stay in one private message: the Manage panel becomes the editor or the delete prompt, and the draft becomes the result. Results (posted, updated, cancelled, deleted, discarded, withdrawn, kept, pinged) show for 5 seconds and then delete themselves. Cancel and Keep delete at once. An error from a private message appears at its top, keeping its buttons and builder link. An error from the public roster is a private notice that deletes itself after 15 seconds.

Only the person who started a roster can edit, delete or post it. The link is the web page's only credential, so it is a random 24-byte token. An unknown or expired token looks the same as a wrong one: 404.

## Join lobby

`/join-lobby` posts a public embed of everyone in the voice channels the person running it can see, one field per channel in Discord's order, with a **Join** button for each player in an open Steam lobby.

- **Mapping:** `steam_profiles` holds one Steam account per Discord user. Everything is stored as the SteamID64, so a friend code is converted and a vanity link is resolved through Steam.
- **Who may use it:** someone without a link gets a modal asking for their profile when they run the command, and the list is posted once it's saved. A press on a **Join** button asks too, privately, and also offers **Skip for now**, which gets them the link and saves nothing. `/link-steam` changes a link, and `/steam-links` shows the whole mapping privately. All three commands follow `apps/bot/src/command-access.ts`, so they start out for admins and WEB WEAVER, while a press on a posted **Join** button works for everyone.
- **Refresh and Delete:** every list message has both. Anyone can refresh, but it always shows the channels the person who posted it can see, so nobody can reveal a hidden channel. A refresh updates that one message, so on a list of several messages the others stay as they were. Only that person, an admin or a staff role can delete.
- **Why the button doesn't link straight to Steam:** Discord only allows http and https on link buttons, and a link button runs no code, so the check above couldn't happen. A press answers privately with a link button to `PUBLIC_URL/api/join-lobby/<app>/<lobby>/<steam>`, a small page that hands over to `steam://joinlobby/...`. It accepts only digits, so it can't redirect anywhere else. It needs no database: the numbers are public on the Steam profile.
- **Reading Steam:** there's no API for the join link, so the bot reads the public profile page. Steam answers 429 after a short burst (about 15 quick requests in testing, clearing after about 15 seconds). All requests go through one queue in `features/join-lobby/steam.ts`, a second apart, and a result is kept for 30 seconds. On 429 it waits and retries once, and if that's refused too, players show as not checked rather than making everyone wait. A press checks again.
- **Privacy:** a private profile can't show a lobby. A member can claim any Steam profile, since nothing proves ownership, but each can be linked only once.
- **Not captured yet:** nobody was in a joinable lobby when the parser was written, so `parseSteamProfilePage`'s lobby and game-name reading follow the known page layout and the `steam://joinlobby/` pattern, not a saved page. Offline and private pages were checked against real ones, and the command has since found a real lobby in dev, in Wardogs (Steam app 1867240).
- **Not known yet:** a lobby ID also shows while the player is only in the game's menu, and it belongs to the Steam user, not a server. So **Join** means Steam offers a link, not that they are in a match. Joining another player, and whether a link outlives the host's game, are untested.

### Importing the mapping

`pnpm --filter @scrimbot/bot steam:import <file> <server ID>` reads a Discord channel copied as text. The copy has display names and no user IDs, so each name is looked up in that server, as written and then without a leading `[TAG]`, and counts only when exactly one member matches. Anyone else is asked for their profile when they next use the command. An existing link is never replaced. It reports without saving until given `--apply`. In dev, run it as the bot's role with `DATABASE_URL="$(pnpm --silent --filter @scrimbot/bot role-url scrimbot_bot)"`. The copied channel holds members' accounts, so keep it in `data/` and never commit it.

## Containers

```
Internet -> Cloudflare Tunnel -> scrimbot (web + API, no internet, no bot token)
                                     |  net-scrimbot-db (internal)
                                 scrimbot-db (Postgres)
                                     |
Discord <- gateway, outbound 443 - scrimbot-bot (holds the token, no inbound)
```

The bot is outbound-only. `PUBLIC_URL` is not an address for the bot: it is the web app's address, which the bot writes into the private link it sends the leader.

## How the bot and web communicate

Through Postgres:

- **Shared data:** the same tables, with separate database roles (below).
- **Web asks the bot to act:** a row in `bot_jobs`, written in the same transaction as the data change. The bot claims rows with `FOR UPDATE SKIP LOCKED`, wakes on `LISTEN/NOTIFY`, and polls every 5 seconds so a missed signal only causes a delay.
- **Job types:** a fixed list in `packages/core/src/jobs.ts`, validated on both sides, with handlers that are safe to repeat.

  | Type               | Sent when                                  | The bot                                                  |
  | ------------------ | ------------------------------------------ | -------------------------------------------------------- |
  | `system.heartbeat` | Proving the queue works                    | Logs it                                                  |
  | `roster.preview`   | The leader saved squads or answer buttons  | Redraws the private preview (throttled, see below)       |
  | `roster.emojis`    | The leader opened the answer-button editor | Lists the server's emoji and saves them for the web page |

- **Internal HTTP:** not built. Add a small endpoint with a shared secret only when a web user must wait on a live Discord answer.

## Database and roles

The bot and web connect as their own roles, so a compromised web container can't run jobs or rewrite history. In production the bot runs the migrations as the owner on start (`prepareDatabase`) and sets each role's password from its secret. In dev, `pnpm dev` (or `pnpm db:dev-roles`) gives the roles a local password, so dev runs under the same grants.

| Table                   | Holds                                               | Web role                                                                                                                                                                                                                                                                                                            | Bot role             |
| ----------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `guilds`                | Servers                                             | read                                                                                                                                                                                                                                                                                                                | read, write          |
| `audit_log`             | Who did what                                        | add                                                                                                                                                                                                                                                                                                                 | add                  |
| `bot_jobs`              | The queue from web to bot                           | add `type` and `payload`, read `id`                                                                                                                                                                                                                                                                                 | read, update, delete |
| `roster_instances`      | One run of `/build-roster`                          | read `id, token, guild_id, snapshot, assignments, answer_options, emoji_options, squad_names, squad_leaders, show_banner, show_bench, embed_style, status, expires_at, revision`; update `assignments`, `answer_options`, `squad_names`, `squad_leaders`, `show_banner`, `show_bench`, `embed_style` and `revision` | everything           |
| `guild_roster_defaults` | The squad names a server's new rosters start with   | read, add, update                                                                                                                                                                                                                                                                                                   | read                 |
| `roster_responses`      | One row per player: their answer to a posted roster | none                                                                                                                                                                                                                                                                                                                | everything           |
| `steam_profiles`        | Which Steam account a Discord user is               | none                                                                                                                                                                                                                                                                                                                | everything           |
| `staff_roles`           | The roles that may use every command, per server    | none                                                                                                                                                                                                                                                                                                                | read, add, delete    |

Postgres checks every column an `INSERT` names, even ones left to a default, so `enqueueJob` writes plain SQL naming only `type` and `payload`. An ORM insert would be refused for the web role. Grants are per column, so a column added later to a web-readable table needs its own grant.

## Roster lifecycle

`roster_instances.status` is `draft`, `posted` or `editing`.

```
draft --Post roster--> posted --Edit roster--> editing --Update roster--> posted
  |                      |                        |
  Cancel/expiry          Delete (asks twice)      Discard changes --> posted (as it was)
  v                      v
  removed                removed
```

- **Expiry:** a draft or an edit lasts 24 hours and a posted roster 7 days. Once an hour the bot deletes expired rosters and, with them, their answers. A deleted roster's Discord message stays, and its buttons then say it is no longer active.
- **While editing:** the public message and its counter keep using what was posted (`posted_assignments`, `posted_answer_options`, and the `posted_*` squad names, leaders and options). The draft values apply only at **Update roster**, which redraws the same message and keeps everyone's answers.
- **Web page:** the page can change a roster in `draft` or `editing`, and refuses a `posted` one.

## Squads

- A roster has seven squads, which start with the clan's names, or with the server's saved default if there is one. The leader can rename them on the web page, and **Save names as server default** applies to that server's future rosters. Any roster leader can overwrite the default. Rosters already started keep their names.
- A squad's colour on the page belongs to its slot, and stays when it is renamed. Its type shows only while it carries a clan name.
- Leaders can add squads, up to 12, and remove them. A removed squad's players return to the pool, and later squads move up a number.
- Each squad can have one squad leader, listed first with an emblem. A leader moved out of the squad stops being its leader. The others stay in sign-up order.
- The leader chooses per roster whether the posted roster shows the bench and the banner. Hiding the bench changes only the message.

## Embed design

- The page's designer stores its choices in `embed_style`: heading, title, description, footer, colour, banner and corner image, squad layout, bench name, whether to show the time and the bar, and icons for pending, squad leader and each squad. Anything left out uses the Arachne default. **Save as server default** keeps the squads and the design for that server's new rosters.
- Icons can be standard emoji or this server's. As with answer buttons, a server emoji must be one the bot listed for the server, never an arbitrary id.
- Reading an event always asks Discord for the message. The bot gets no message events, so its cached copy would keep the sign-ups from the first read.
- The crest and the Arachne banner are attached to the message from the `ASSETS_DIR` folder, so they work on any address. A missing file is left out. A redraw names the files already on the message instead of uploading them again. It must not use Discord's links to them, because that shows them as separate images above the embed. A leader's own image is a plain `https` link.
- The **Roster image** banner draws a deployment poster in `build-roster/roster-image.ts`, with Satori and resvg: the crest, title, start time, the leader's optional opponents, map and faction, then a card per squad with players. Squads use the design system's unit shields until the real crests are added. Nothing there depends on answers, so it is drawn when the squads change. The fonts have no emoji, so those are left out of names.

## Answer buttons

- A roster has 1 to 5 answer buttons, and the leader can rename them and pick icons (standard emoji or this server's) on the web page. The default is "Confirm" and "Can’t make it".
- **The first button is always the Confirm one.** Only it counts toward `Confirmed N/M`, where M is everyone placed in a squad. Other answers show next to the player and as a count line.
- Answers are stored by a stable key, so renaming a button keeps earlier answers. Removing a button makes its answers show as waiting again. Buttons from before customising used `yes` and `no`, and still work.
- Only players placed in a squad and matched to a Discord user can answer. Someone else gets a private notice.
- Pressing a different answer switches to it. Pressing the same one again asks before withdrawing.
- The editor and the server's emoji list load only when the leader opens it. The page asks the bot with a `roster.emojis` job, and a server emoji is accepted only if the bot listed it.

## Editing together

Everyone with a roster's link edits the same board, live. The server's copy is the true one.

- **Changes, not boards:** the page sends small changes (`POST /api/roster/:token/ops`): move a player, set or clear a leader, rename, add or remove a squad, set one style field or squad emoji, a toggle, or the answer buttons. The server locks the row, applies them in order with `applyOp` from `packages/core`, raises `revision` by one per change, and saves. A change to a player or squad someone has since removed does nothing, so the later change wins.
- **Same code on both sides:** the page shows the server's board with its own unconfirmed changes applied on top, using the same `applyOp`. A change shows at once and then stays, and every page ends up with the server's board. A random test in `packages/core/test/roster-ops.test.ts` checks this with several editors and changes arriving in any order.
- **Live updates:** `GET .../events` is a server-sent event stream. It starts with `hello` and the current revision, then sends each change with its revision and who made it, and who is on the page. A page that sees a gap in revisions, or a `reset`, loads the whole board again. The page sends at most 20 changes per request, and the server takes 20 a second per link, in bursts of 40.
- **Fallback:** if the stream drops, the browser reconnects by itself, and the page polls `GET /api/roster/:token` every 5 seconds until it does.
- **The bot's changes:** Post, Edit, Discard, Cancel and Delete happen in the bot, which then sends `pg_notify('roster_changed', id)`. The web app listens, from the first stream on, and either tells the pages to reload or ends their streams if the roster was posted, deleted or has expired. No table or grant is involved.
- **Presence:** each page picks a name, kept in its browser, and its open stream counts as being on the page. `POST .../presence` marks the player it is dragging, which is shown to the others and never stored. Presence and the streams live in the web app's memory, which assumes one web process, as it runs.
- **Through Cloudflare:** a quiet connection is dropped after about 100 seconds, so the stream sends a comment every 25. It is sent with `Cache-Control: no-cache, no-transform` so it isn't held back by compression.
- **Previews:** the web app queues a `roster.preview` job at most every 2 seconds per roster, at once for the first change and once more after a burst, instead of one per change.
- **Roster picture:** drawn only when the roster-image banner is on, one at a time across all rosters, and reusing the cache. A live preview waits until changes have stopped for 1.5 seconds and shows the last finished picture in the meantime, then redraws once the new one is ready. Post and Update always wait for a fresh one.

## Matching Apollo names to Discord users

Apollo lists display names, never user IDs. After Continue, the bot searches the server for each accepted name. A name counts only when exactly one member matches it, ignoring case, by display name, nickname, global name or username. Anything else is left as plain text, can't answer, and still counts in `M`. The roster says so in its footer.

## Discord limits

- **Edits:** a message is edited at most once every 2 seconds. A burst of saves or answers is merged into one edit, with a last one after the burst so the final state always shows. `discord.js` also waits out any rate limit that Discord reports.
- **Live preview:** it edits the leader's private message through the interaction token, which Discord honours for 15 minutes. The bot stops a minute early, and **Refresh preview** starts another 15 minutes. If Discord rejects the token, the bot stops editing until the next refresh, and doesn't keep sending failing requests.
- **One bot process:** the throttles are in memory, so they assume one bot container, which is how it runs. An edit still waiting during a restart is lost until the next change.
- **Intents:** `Guilds`, and `GuildVoiceStates` for `/join-lobby`, because Discord has no API that lists who is in a voice channel. Neither is privileged. Reading the Apollo embed with the API needs the Message Content intent switched on for the app in the Developer Portal. Looking up members and listing emoji use plain API calls.
- **Bot permissions:** View Channel and Read Message History where Apollo posts, Send Messages and Embed Links where rosters are posted, and the `applications.commands` scope. Emoji from the same server need nothing extra.

## Apollo's message format

Captured from real messages, with fixtures in `packages/core/test/fixtures/apollo`:

- Everything is in the first embed. Its title is the event title, and `content` is empty.
- The `Time` field holds `<t:UNIX:F>`, the start time.
- Each answer is a field named `<emoji> Accepted`, `Declined` or `Tentative`, followed by ` (N)` when the list isn't empty.
- The field's value is `>>> ` and then one display name per line. An empty list is `-`.
- A header count that doesn't match the number of names marks the snapshot incomplete.

Not yet captured, so not handled specially: 70+ sign-ups, unusual names, `show_attendees` off, and a description containing `<@id>`. Capture them with `pnpm --filter @scrimbot/bot capture:message <message link> <file>` before relying on them.

## Testing

The tiers, from `pnpm dev` to a release, and how to set up TesterBot for the end-to-end scripts, are in the [README](../README.md#test). The scripts live in `apps/bot/dev/`, which is never built or copied into the production image. They send stand-in interactions into the real command and button code, because a bot account can't run commands or press buttons. They run as the restricted database roles, as production does, so a missing permission shows up there.

## Milestones

1. **Foundation.** Done.
2. **Hosting.** The bot needs outbound access, and the web app doesn't. Done.
3. **Capture Apollo's format.** Done for a normal event. Still to capture are the cases listed above.
4. **Roster.** `/build-roster`, the web page, answer buttons, editing and deleting. Done.
5. **Ready check.** `/readycheck` and the ping button.
6. **Hardening.** Ops docs and Postgres backups.
7. **Join lobby.** `/join-lobby` and `/link-steam`. Done, apart from the unknowns listed above.
