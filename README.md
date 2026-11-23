# Spinner Bot

Formerly Scrimbot. The code and database roles keep the `scrimbot` name.

A Discord bot and web app for Wardogs scrims: from Apollo sign-up to a ready roster, without the spreadsheet.

**Status:** `/build-roster` works end to end: it reads an Apollo event, lets the leader build squads on a web page with a live preview in Discord, posts the roster with answer buttons, and supports editing and deleting it. `/join-lobby` lists who is in voice, with buttons to join their Steam game. `/ping` and `/roll` are example commands. `/readycheck` comes later.

**Access:** slash commands are for server admins and the staff roles, which are kept in the database. An admin sets them with `/staff-roles`: `add`, `remove` or `list` with a role. After the first release, an admin runs `/staff-roles add` for the staff role, because a fresh database has none and only admins can use the commands until then. To open a command to every member, add its name to `PUBLIC_COMMANDS` in [apps/bot/src/command-access.ts](apps/bot/src/command-access.ts) and deploy.

The design and milestones are in [docs/architecture.md](docs/architecture.md). To add a feature, see [docs/adding-a-feature.md](docs/adding-a-feature.md).

## Layout

| Path              | What it is                                                          |
| ----------------- | ------------------------------------------------------------------- |
| `packages/core`   | Pure logic and shared types, with no I/O                            |
| `packages/db`     | Database schema, migrations and the bot job queue                   |
| `apps/bot`        | The Discord bot: `framework/` is the base, `features/` the commands |
| `python`          | Command logic written in Python                                     |
| `apps/web/server` | The API, which also serves the built page                           |
| `apps/web/src`    | The React page                                                      |
| `scripts`         | `dev.sh`, which `pnpm dev` runs. Not part of the image              |

## Set up

Needs Node 22.12 or later, pnpm 12, Python 3.12 or later and Podman.

```bash
pnpm install
```

```bash
pnpm py:setup
```

```bash
cp .env.example .env
```

The art (banner, crests, emblems, backgrounds) is not in the repo. Get the files from the owner and put them in `assets/` at the repo root, which git ignores: `arachne-banner.webp`, `arachne-crest.png`, `arachne-crest-large.png`, `hero-battlefield.jpg`, `spinner-bot-icon.jpg` and `emblems/<clan>.svg`. Set `ASSETS_DIR` in `.env` to use another folder. Without the files the bot and web still run, and log a warning for each missing one.

`pnpm dev` (below) starts the database and migrates it for you. To do it by hand, start a throwaway database. It's bound to loopback and its data goes away when it stops:

```bash
podman run -d --rm --name spinnerbot-dev-db -e POSTGRES_PASSWORD=scrimbot -e POSTGRES_USER=scrimbot -e POSTGRES_DB=scrimbot -p 127.0.0.1:5432:5432 docker.io/library/postgres:18.6-alpine3.24
```

```bash
pnpm db:migrate
```

In `.env`, fill in `DISCORD_TOKEN`, `DISCORD_APPLICATION_ID` and `DISCORD_DEV_GUILD_ID` (your test server). Set `PUBLIC_URL` to where you open the roster page: `http://localhost:5173` on this machine, or the machine's address (for example `http://192.168.1.166:5173`) to open links from another device. The bot refuses to start without it.

The dev app needs the **Message Content** intent switched on in the Discord Developer Portal, or it can't read Apollo's embed. It needs View Channel and Read Message History where Apollo posts, and Send Messages and Embed Links where you run the command.

## Run

One command starts the database, applies migrations, sets up the database roles, and runs the web API, the web page and the bot together. Ctrl+C stops the three servers and leaves the database running:

```bash
pnpm dev
```

- `pnpm dev --deploy-commands` registers the slash commands in your test server first. Needed only when a command's name or options change.
- `pnpm dev --setup-only` starts and migrates the database, then stops.
- `pnpm dev --stop-db` stops the database container, which erases its data.

As in production, the web API and the bot connect as the restricted roles `scrimbot_web` and `scrimbot_bot`, not as the database owner. A missing permission then shows up in dev and not after a deploy. `pnpm db:dev-roles` sets those roles up on its own. These local passwords are for dev only.

To run the pieces yourself, use three terminals (the page on port 5173, the API on 3000):

```bash
pnpm dev:web --host
```

```bash
pnpm --filter @scrimbot/web dev:server
```

```bash
pnpm dev:bot
```

`--host` lets other devices on your network open the page. Start the web server and bot this way and they use the owner role from `.env`, because only `pnpm dev` switches roles. Register commands with `pnpm commands:deploy`.

## Add a command

```bash
pnpm new:command my-command
```

Add `--python` to write the logic in Python. See [docs/adding-a-feature.md](docs/adding-a-feature.md).

## Test

Each tier proves more than the one before, and takes longer. Run the cheapest one that shows your change works. Commands run from the repo root.

| Tier        | Command                                                          | Which Discord app, and where                   | What it proves                                                                                                                                | Time                       |
| ----------- | ---------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Inner loop  | `pnpm dev`                                                       | Dev app, in your test server                   | The change works for real: you run the command and press the buttons yourself, and the code reloads on save                                   | Seconds                    |
| Check       | `pnpm check`                                                     | None                                           | Format, lint, types, build, unit and Python tests                                                                                             | About a minute             |
| Database    | `pnpm test:db`                                                   | None                                           | Migrations, the job queue and what each database role may do. Needs the throwaway database from `pnpm dev` (below)                            | Under a minute             |
| End to end  | `pnpm --filter @scrimbot/bot e2e` and `... join-lobby:e2e`       | TesterBot and the dev app, in your test server | The whole `/build-roster` and `/join-lobby` flows, with real posts read back from Discord and stand-in presses (below). Stop `pnpm dev` first | A few minutes each         |
| Setup check | `pnpm --filter @scrimbot/bot tester:smoke <Apollo message link>` | TesterBot and the dev app, in your test server | The server's permissions, the registered commands and the look of a posted roster                                                             | Seconds                    |
| Release     | PR, then `main`, then a `v` tag, then the owner approves         | The main app, live                             | The released image runs on the platform                                                                                                       | Minutes, plus the approval |

Later, a deployed test slot at new-spinnerbot.doublew.nu gets its own test Discord app (#57). Never put the prod token in `.env`: if both ran with one token, both would receive every command.

`pnpm test:db` runs against the dev database. Stop the dev bot first, or use a second database in the same container, because the bot's job worker would claim the tests' jobs:

```bash
podman exec spinnerbot-dev-db psql -U scrimbot -c 'create database scrimbot_test'
```

```bash
TEST_DATABASE_URL=postgres://scrimbot:scrimbot@127.0.0.1:5432/scrimbot_test pnpm test:db
```

### TesterBot and the end-to-end scripts

A bot can't run slash commands or press buttons, so the scripts in `apps/bot/dev/` send stand-in presses into the real code. Everything public is really posted in the test server and read back by TesterBot. Private replies (previews, prompts, notices) are captured, so how they look in Discord needs a person. Each script makes its own category and channels, and deletes them when it ends.

To set up once:

- Make a second Discord app, TesterBot, with a bot user, and add it to the test server with Manage Channels and Manage Expressions. Put its credentials in `testerBot/testerBot_creds` as two lines, `APPID=...` and `TOKEN=...`. That folder is git-ignored and kept out of the image. Keep them out of `.env`, which the production container's contract test reads.
- `e2e` needs 5 other members in the test server (a human for the owner and bots for the rest are best), and `join-lobby:e2e` needs 3. Their names are read from Discord at run time, and each must be one no other member shares. Turn on the dev app's Server Members intent in the Developer Portal so the scripts can list them.
- Optional, in `.env`: `E2E_STEAM_PROFILE` (a Steam profile link, SteamID64 or friend code) and `E2E_STEAM_VANITY` (a custom profile name) switch on the two `join-lobby:e2e` steps that read the real steamcommunity.com. Without them the steps print one SKIP line.

Other tools in `apps/bot/dev/`, run with `pnpm --filter @scrimbot/bot <name>`: `capture:message <link> <file>` saves a Discord message as JSON, `roster:status` shows the newest roster as the database and Discord hold it, `emoji:upload` uploads the bot's emoji, and `steam:import <file> <server>` reports who a copied channel would link to Steam (add `--apply` to save them).

## Branches and environments

|             | Dev                                     | Prod                                           |
| ----------- | --------------------------------------- | ---------------------------------------------- |
| Branch      | A feature branch, merged into `main`    | A `v` tag on `main`                            |
| Runs as     | Node processes, from `pnpm dev`         | Containers on the hosting platform             |
| Discord app | A separate dev app, in your test server | The main app                                   |
| Secrets     | `.env`                                  | `/run/secrets/app.json`, set with `set-secret` |
| Database    | Throwaway container                     | The platform's database, with a backup         |

Never put the prod token in `.env`. If both ran with one token, both would receive every command.

## Release

Releases follow "Release" in [AGENTS.md](AGENTS.md): merge to `main`, push a `v` tag, and the owner approves it. Rollback covers the containers, not the database, because migrations only go forward. Keep each migration compatible with the version before it.

### Discord app settings

- **Message Content intent:** on, for `/build-roster`.
- **Permissions:** View Channel and Read Message History where Apollo posts, Send Messages and Embed Links where rosters are posted, View Channel on the voice channels `/join-lobby` should list, and the `applications.commands` scope. No Connect or Speak: the bot never joins audio.
- **Outbound access:** the bot must reach Discord and `steamcommunity.com`. Members' browsers must reach `PUBLIC_URL/api/join-lobby/...`.

### After a release

Run `/build-roster` on a real Apollo event and go through it once: open the link, place players, customise a button, post, answer, edit, then delete. Run `pnpm --filter @scrimbot/bot roster:status` if something looks wrong. For `/join-lobby`, sit in voice with the game open, run it, press **Join** and follow the link.

## Build the image

```bash
podman build -t localhost/spinnerbot:dev .
```

| Process          | Command                                    |
| ---------------- | ------------------------------------------ |
| Web (default)    | `node apps/web/dist/server/main.js`        |
| Bot              | `node apps/bot/dist/main.js`               |
| Migrations       | `node packages/db/dist/deploy-cli.js`      |
| Web health check | `node apps/web/dist/server/healthcheck.js` |
| Bot health check | `node apps/bot/dist/healthcheck.js`        |

The migrations command runs as the database owner. It also sets the bot's and web's passwords from their secrets (`/run/secrets/db_owner_url`, `web_db_url`, `bot_db_url`). Development uses `pnpm db:migrate`, which is not in the image.

Secrets can come from files: `DISCORD_TOKEN_FILE` and `DATABASE_URL_FILE`. Settings: the bot needs `DISCORD_TOKEN`, `DISCORD_APPLICATION_ID`, `DATABASE_URL` and `PUBLIC_URL`. The web needs `DATABASE_URL` and `PORT`.

## Volumes

- The assets folder, mounted read-only, with its path in `ASSETS_DIR`. It holds the art listed under "Set up", which is not in the image because the image is public. The owner copies the files into the host folder once. The app works without it: the bot posts without the missing images, and the web returns 404 for them.
