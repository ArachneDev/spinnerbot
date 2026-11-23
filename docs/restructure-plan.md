# Restructure plan

A proposal for after the contract work (infra ticket 55), not a status list. "More efficient" here means three things: a smaller image, a faster CI run, and a shorter path from a change to the live bot. "Fit the new system" means the platform's app contract and the app-starter template: one image, secrets from `/run/secrets/app.json`, migrations on start-up, the release workflow from app-pipeline, and nothing host-specific in the repo.

Items are ordered by payoff. Each says what it serves, what it costs, how risky it is, and whether it should wait for the move to the new platform (infra ticket 59). Each item the owner approves becomes a ticket in the infra repo; status lives there, not here.

## 1. Drop the Python bridge (owner decision)

- **What:** the only Python command is `roll`, a 10-line example in `python/commands/roll.py`. Port it to TypeScript (or delete it), then remove `python/`, `apps/bot/src/framework/python.ts`, its test, and the `py:*` scripts.
- **Serves:** image size and CI time. Python is installed in both image stages and gets its own venv; CI runs `py:setup` and `py:check` (ruff and pytest) on every change; developers need Python for `pnpm check`.
- **Cost:** small. One command, one test, the bridge and the `PythonBridge` entry in the command context, plus two e2e scripts that create a bridge.
- **Risk:** low, but the bridge looks deliberate (a place to write commands in Python). Keep it if Python commands are planned.
- **When:** any time; easiest before the move, so the first image on the platform is the smaller one.

## 2. Ship only what runs

- **What:** the build stage copies the whole repo (`COPY . .`) and the final stage copies all of `/app`. Copy only each app's `dist`, the web client build, the migrations and the production `node_modules` into the final stage. Move the developer tools out of `apps/bot/src/scripts/` (`new-command`, `scaffold`, `import-steam-profiles`) into `apps/bot/dev/`, which is already the place for tools that don't run in production.
- **Serves:** image size, attack surface, and Trivy findings (fewer files to scan and to flag).
- **Cost:** small to medium: a Containerfile change, plus `package.json` script paths for the moved tools.
- **Risk:** low. The contract test in CI catches a missing runtime file for both modes.
- **When:** before the move. Measure the image before and after; no size is claimed here yet.

## 3. Match the template's build details

- **What:** pin the base image by digest as app-starter does (`node:22-alpine@sha256:…`, with Dependabot updating it), and keep the remaining differences from the template deliberate and named in the README.
- **Serves:** reproducible builds and the platform's pinning rule.
- **Cost:** one line per `FROM`.
- **Risk:** none.
- **When:** any time.

## 4. Rename scrimbot to spinnerbot, in two steps

- **Mechanical step:** the `@scrimbot/` package scope (in about 55 files), the root package name, the heartbeat file name, the dev database name, and the docs. Code only, no data. Any time.
- **Data step:** the database roles `scrimbot_web` and `scrimbot_bot`. They are created by migrations, granted to in later ones, and named in the database URLs held in the vault. Renaming them means a new migration, new URLs and a coordinated secret change. Do it after the move (ticket 59), on its own, or keep the old role names: they are internal and nobody sees them. Owner decision.

## 5. Bring the docs up to date

- **What:** `docs/architecture.md` still says the Join lobby commands "start out for admins and WEB WEAVER"; the code no longer names a role (staff roles are in the database, set with `/staff-roles`). Check `docs/permissions.md` and `docs/adding-a-feature.md` the same way, and point `AGENTS.md` at the platform contract instead of repeating it.
- **Serves:** a shorter path for the next agent or developer, and fewer wrong turns.
- **Cost:** small.
- **Risk:** none.
- **When:** any time; best together with item 4's mechanical step.

## 6. One way to test against Discord

- **What:** `apps/bot/dev/` holds ten scripts (`e2e`, `join-lobby-e2e`, `discord-smoke`, `roster-status`, `capture-message`, `dev-roles`, and others). Keep `tester.ts`, `e2e.ts` and `join-lobby-e2e.ts` as the one TesterBot run, give it one `pnpm` entry, and fold or delete the one-off scripts.
- **Serves:** the change-to-live loop: one command proves a change against the test server before it ships to the test slot.
- **Cost:** medium; each script has to be read for what it still does.
- **Risk:** low; these scripts don't ship.
- **When:** after the first TesterBot run against the test server, so it's clear which scripts earn their place.

## Left out on purpose

- **Branding** (clan names, colours, titles): the owner chose to keep it in code for now.
- **Replacing Apollo:** a product decision, already described in `docs/architecture.md`.
- **What ticket 55 delivers:** secrets from `app.json`, migrations and command registration at start-up, the bot health check, and the CI test workflow.
