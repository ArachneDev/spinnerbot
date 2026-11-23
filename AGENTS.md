# Container contract for this app

This app is hosted as a container by a shared platform. The platform does not care what is inside the image, only that it follows this contract. Keep it true when you change the code.

This is a copy. The source is the container contract in the platform's blueprint, which is private; a weekly check there compares the version below with the blueprint's and flags a difference. Change the text here only when the platform changes the contract.

Contract version: 235db985147e

- **Port.** Listen on `PORT` (default 3000), above 1024.
- **Variables.** List every variable the app reads in `.env.example`, one `# description` line each.
- **Secrets.** Read app secrets only from `/run/secrets/app.json`. Pass each value to the code that needs it; never export it to the environment, log it or put it in the image or a build argument. A missing key is a clear start-up error. Never commit a real secret; `ci/app.json` holds fake values only.
- **Public address.** Build absolute and redirect URLs from `PUBLIC_URL`, not from the request. Trust the proxy headers.
- **Health.** `/healthz` returns 2xx with the build version: keep `ARG VERSION` and `ENV VERSION` in the `Containerfile`.
- **Hardened runtime.** The image runs with a read-only root, no capabilities and a memory limit. Write temporary files under `/tmp`. State any exception and why in the README.
- **Non-root.** End the `Containerfile` with a numeric `USER` above 0.
- **Persistence.** List every path that must persist under Volumes in the README. Run schema migrations on start-up.
- **No hardcoding.** No hostnames, IDs or keys in the code. Keep env files, keys and local data in `.gitignore` and `.dockerignore`.
- **README.** Keep sections Port, Volumes, Dependencies and Memory true; the pipeline fails without them.

Check your change: open a pull request. The pipeline builds the image, runs it under these limits, scans it and names any broken line with its fix.

## Release

1. Merge to `main`, then push a tag `vX.Y.Z` on that commit. Check: `ghcr.io/arachnedev/<repo>:vX.Y.Z` exists.
2. Production follows only when `.github/workflows/release.yml` has `promote: true` and `production-url: https://<first hostname>/healthz` (the app-pipeline README, "Release channels"), and the repo's `production` Environment has the owner as required reviewer. If either is missing, ask the owner: without the reviewer, `:prod` moves unapproved. The tag then waits for the owner's approval; after it, the job moves `:prod` and moves it back if `/healthz` fails.

## Secrets

- A value lives in the `ArachneDev/<stack>-secrets` repo, set with `./set-secret NAME` as its README shows. The developer or owner types it at a hidden prompt; never print, commit or ask for one.
- In code: read the key from `/run/secrets/app.json`, as the contract says, and add a fake value for it to `ci/app.json`.
- Hosting a new secret's repo, or giving an app secrets the first time, is done in `infra` (`docs/runbook/app-secrets.md`).

# This app: Spinner Bot

Discord bot and web app for Wardogs scrims. Read `docs/architecture.md` for the design and `docs/adding-a-feature.md` before adding code.

Run `pnpm check` before finishing. With a database available, run `pnpm test:db` too (see `README.md`). A new setting or outbound access needs the owner: say so in the pull request.

- Discord code stays in TypeScript. Python gets plain JSON through `python.run` and never talks to Discord.
- Apollo is temporary. Keep Apollo-specific code in `packages/core/src/integrations/apollo/`, so the rest of the system never depends on its message layout. `EventSource` is the seam for a native source later.
- Don't guess Apollo's message format. Write parsers against real captured messages only. The captured ones are in `packages/core/test/fixtures/apollo`, and the format is described in `docs/architecture.md`.
- New tables need role grants in a migration, or the bot and web can't use them. The web role's grants are per column, so new columns need them too.
- Test database code as the restricted role. `pnpm dev` and the web API tests do. Running as the owner hides missing permissions, and that already hid a bug that would have broken production.
- pnpm rejects packages published in the last 24 hours. Pin an older version rather than relaxing that policy.

## Working on several features at once

Editing in parallel is safe. Running in parallel is not.

- One `feature_<name>` branch from `main` per feature, each in its own `git worktree` (`git worktree add ../discord_bot-<name> feature_<name>`). A branch can't be checked out twice. Don't switch branches in a folder another task is using.
- A new worktree lacks git-ignored files: run `pnpm install`, copy `.env`, `testerBot/` and `python/.venv` (`pnpm py:setup`) from the main checkout.
- Run one dev stack at a time. Every `pnpm dev` shares the dev Discord app token (both bots would answer every command), the dev database on port 5432, ports 3000 and 5173, and the bot job worker, which claims the other stack's jobs. For a second stack at once, use a different database, ports and Discord app. Otherwise rely on `pnpm check` in the other worktree.
- Merge `main` into the feature branch before testing and before merging back. Merge features into `main` one at a time.
- Expect conflicts only in shared files: the feature lists (`apps/bot/src/features/index.ts`, `apps/web/server/features/index.ts`), `jobPayloads` in `packages/core/src/jobs.ts`, `PUBLIC_COMMANDS`, `packages/db/src/schema.ts`, and the docs. Keep both sides' lines when resolving.
- Migrations: two branches that each ran `pnpm db:generate` both claim the next number, and `packages/db/migrations/meta` (journal and snapshots) conflicts too. Never hand-merge them. After merging `main`, delete your unapplied migration and its snapshot, restore the journal from `main`, and run `pnpm db:generate` again (re-do the role grants). Never touch a migration already on `main`.
- Features don't import each other, but only the `core` and `web` rules are lint-enforced. Check this one in review. Shared code goes in `packages/core`.

### Open problems with this workflow

This workflow has never been used. It was worked out by reading the repo, not by running two features side by side. The first agent to use it must solve these, then rewrite this section and the bullets above to match what actually worked:

- Running two stacks at once has no setup yet. `scripts/dev.sh` hardcodes port 5432 and the container name, and `.env` fixes ports 3000 and 5173 and the Discord token. Decide how a second worktree gets its own database, ports and dev Discord app, or write down that it can't.
- The migration regeneration steps are untested. Confirm them on a real conflict, including the role grants and the journal.
- Worktree setup is manual. Consider a script that does the install and copies the ignored files.
- Record what you learned here, then remove any step that proved unnecessary.
