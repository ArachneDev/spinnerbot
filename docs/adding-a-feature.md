# Adding a feature

A feature is a folder. It should work, and fail, without touching any other feature.

This page is the recommended way to work, so depart from it when a feature has a good reason to. The firm rules are in `README.md` (releasing) and `AGENTS.md`.

## From idea to production

1. Branch from `main`, as `feature_<name>`.
2. Build the feature, using the sections below. Run it with `pnpm dev` in your test server.
3. Run `pnpm check` and `pnpm test:db`. A flow with several steps can also get a live test in `apps/bot/dev/`, like `join-lobby:e2e`.
4. Update `README.md` and `docs/architecture.md`, and `docs/permissions.md` if it needs new Discord permissions or intents. If production needs a manual step, add it to the README's deploy section, and say whether it comes before or after the deploy. Migrations run during the deploy, so anything that writes to a new table comes after.
5. A new setting or outbound access needs the owner: tell them in the pull request.
6. Merge into `main`, then release as `README.md` says.

## Add a command

```bash
pnpm new:command team-stats            # TypeScript only
```

```bash
pnpm new:command team-stats --python   # logic in Python
```

This creates the files and adds the feature to the list. Then:

1. Fill in the description and inputs, then the logic.
2. Run `pnpm commands:deploy` to show the command in Discord. Repeat this whenever its name, description or inputs change.
3. Run `pnpm dev` and try it. The bot reloads when you save TypeScript, and Python files are read fresh on every use.
4. Run `pnpm check`.

`/roll` is a working Python example, and `/ping` a TypeScript one. `/build-roster` in `apps/bot/src/features/build-roster/` is a large one, with buttons, a web page and jobs. `/join-lobby` in `apps/bot/src/features/join-lobby/` shows modals, voice state and reading another website.

## Inputs

List them under `options`. **`required: true` makes Discord refuse to send the command until it's filled in.** Everything else is optional, and required inputs are moved to the front automatically, as Discord demands.

```ts
defineCommand({
  name: "scrim",
  description: "Set up a scrim",
  options: {
    opponent: { type: "string", description: "Who we play", required: true, maxLength: 50 },
    map: {
      type: "string",
      description: "Which map",
      required: true,
      choices: [
        { name: "Omaha Beach", value: "omaha" },
        { name: "Carentan", value: "carentan" },
      ],
    },
    size: { type: "integer", description: "Players per side", min: 1, max: 50 },
    captain: { type: "user", description: "Team captain" },
  },
  async execute(interaction, input) {
    // input.map is "omaha" | "carentan". input.size is number | undefined.
    await interaction.editReply(`${input.opponent} on ${input.map}`);
  },
});
```

| `type`        | The user provides | `input` receives                             | Extra settings                      |
| ------------- | ----------------- | -------------------------------------------- | ----------------------------------- |
| `string`      | Text              | `string`                                     | `choices`, `minLength`, `maxLength` |
| `integer`     | Whole number      | `number`                                     | `choices`, `min`, `max`             |
| `number`      | Decimal number    | `number`                                     | `choices`, `min`, `max`             |
| `boolean`     | True or false     | `boolean`                                    |                                     |
| `user`        | A server member   | `id`, `username`, `displayName`, `isBot`     |                                     |
| `channel`     | A channel         | `id`, `name`, `type`                         | `channelTypes`                      |
| `role`        | A role            | `id`, `name`                                 |                                     |
| `mentionable` | A user or a role  | As above, plus `kind` (`"user"` or `"role"`) |                                     |
| `attachment`  | An uploaded file  | `name`, `url`, `contentType`, `size`         |                                     |

Discord enforces `choices`, the limits and `required` before the command reaches the bot. `choices` allows up to 25 entries and a command up to 25 inputs.

Other command settings:

| Setting                    | Purpose                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| `defer`                    | `"ephemeral"` (default, only the user sees it), `"public"`, or `"none"` to `reply` immediately |
| `allowInDms`               | Also allow DMs with the bot. By default commands work only in servers                          |
| `defaultMemberPermissions` | Who sees the command by default. Admins can change it under Server Settings, Integrations      |
| `requiredPermissions`      | Checked on every use, whatever Integrations says                                               |

**New commands are restricted.** Only server admins and the staff roles can use a command, and the bot checks this on every use. Admins set the staff roles with `/staff-roles`, and they are kept in the database. To open one to every member, add its name to `PUBLIC_COMMANDS` in that file and run `pnpm deploy:prod`. Buttons and modals aren't restricted, so a button on a posted message works for anyone who sees it. If one should be limited, check that in its handler.

To tell the user about a problem they can fix, `throw new UserFacingError("...")`. Any other error shows them a generic message and goes to the log.

A modal has to be the first response to an interaction, so a command that may show one needs `defer: "none"`.

## Calling another website

Parse in `packages/core`, which does no I/O, and fetch in the feature. Fix the host in code, so user input can't choose where the bot connects. Send requests through one queue if the site limits them, as `features/join-lobby/steam.ts` does. Only the bot has internet access, and only on port 443.

## Logic in Python

Discord stays in TypeScript, and Python receives the inputs and returns a result:

```ts
const resultSchema = z.object({ message: z.string() });
const { message } = await python.run("team_stats", input, resultSchema);
await interaction.editReply(message);
```

```python
# python/commands/team_stats.py
from scrimbot import UserError


def run(data):
    if data.get("size", 1) > 10:  # Use .get for optional inputs, which are missing if skipped.
        raise UserError("That team is too big.")  # Shown to the user.
    return {"message": f"Playing {data['opponent']}"}
```

- **`data`** is the same `input` TypeScript has, as a dict. `run` can also be `async`.
- **The result** must be JSON, and is checked against the schema.
- **`print()`** goes to the bot's log. It's safe to use for debugging.
- **`raise UserError("...")`** shows the message to the user. Other exceptions show a generic message, and the traceback goes to the log.
- **Limits:** 30 seconds by default, changed with `python.run(name, input, schema, { timeoutMs })`. Four scripts run at once, and others wait. Results can be up to 1 MB.
- **Secrets:** scripts start with an empty environment. They run in the bot's container, so only add code you trust.

Each use starts a fresh Python process, so nothing is kept in memory between uses. Save anything lasting through the TypeScript side.

**Libraries:** add them to `python/requirements.txt` with exact versions, then run `pnpm py:setup`. The image uses Alpine, so check that a library offers `musllinux` wheels. The image runs Python 3.14, and `python/.venv` uses whatever `python3` is on your machine (3.12 on this server), so avoid relying on version-specific behaviour.

**Tests** go in `python/tests/`, and call `run` directly. `pnpm check` runs them.

## Everything a feature can export

| Field        | Purpose                                                               |
| ------------ | --------------------------------------------------------------------- |
| `commands`   | Slash commands, written with `defineCommand`                          |
| `components` | Buttons, select menus and modals. Build IDs with `customId()`         |
| `events`     | Discord gateway events, written with `defineListener`                 |
| `jobs`       | Work the web app asks for, written with `defineJob`                   |
| `intents`    | Gateway intents it needs. The bot requests only what features declare |

Handlers receive a `FeatureContext`: `client`, `database`, `log`, `python` and `publicUrl` (the web app's address, for building links to give users).

The framework handles the rest:

- **Routing:** commands by name, and components by `<feature>:<action>`.
- **Errors:** a failing handler is logged, the user is told, and nothing else is affected. A button on a private message shows the error at the top of that message, keeping its buttons and links. A button on a public message gets a private notice that deletes itself after 15 seconds. A command's reply shows the error.
- **Finished private messages:** end a flow with `finish(interaction, text)` from `framework/dismiss.ts`. It shows the result for 5 seconds, then deletes the message, or at once with `{ immediately: true }`. Steps in between should `update` the message they were pressed on rather than reply, so a flow stays one message.
- **Collisions:** two features claiming the same command, component or job stop the bot at startup, and fail the tests first.

## Web

1. Add `apps/web/server/features/<name>/index.ts`, exporting a `WebFeature`. Its routes appear under `/api/<name>`.
2. Add it to the list in `apps/web/server/features/index.ts`.
3. Put its page in `apps/web/src/features/<name>/`.

## When the web app needs the bot to act

The web container has no Discord token and no internet access, so it queues a job. Anything Discord shows the user, such as redrawing a message, goes this way (see `roster.preview`):

1. Add the job type and its payload schema to `jobPayloads` in `packages/core/src/jobs.ts`.
2. Handle it in a bot feature with `defineJob`. **It can run more than once**, so it must be safe to repeat.
3. Queue it with `enqueueJob`, inside the same transaction as the related data change. The web role may write only `type` and `payload` of a job, and `enqueueJob` is written to respect that, so use it and not an ORM insert into `bot_jobs`:

```ts
await db.transaction(async (tx) => {
  await tx.insert(rosters).values(roster);
  await enqueueJob(tx, "system.heartbeat", { note: "example" });
});
```

## Changing the database

1. Edit `packages/db/src/schema.ts`.
2. Run `pnpm db:generate`.
3. **Grant access to any new table** in a migration: run `pnpm --filter @scrimbot/db exec drizzle-kit generate --custom`, and follow `0001_roles.sql` and `0003_roster_grants.sql`. New tables are closed to the bot and web roles until then. The web role's grants are per column, so a column added later to a table the web reads or writes needs its own grant.
4. Add a case to the database tests for what each role may and may not do.
5. **Test the real code as the real role.** Code that works as the database owner can still fail for `scrimbot_web` or `scrimbot_bot`. `pnpm dev` and the end-to-end run use the restricted roles, and the web API tests in `apps/web/test/roster.db.test.ts` show how to connect as one.
6. Check that the migration still works with the version of the code that is running, because a rollback restores the code and not the database. Check generated SQL too: Drizzle can leave out a default or an escape, so read the `.sql` file before you apply it.

Migrations only go forward. Never edit one that has been applied.

## Boundaries

ESLint enforces the first two:

- `packages/core` does no I/O.
- `apps/web` never imports `discord.js`.
- Features don't import each other. Shared logic goes in `packages/core`.
- Anything Apollo-specific stays in `packages/core/src/integrations/apollo/`. The rest of the system uses the shared event types, never Apollo's message layout.
