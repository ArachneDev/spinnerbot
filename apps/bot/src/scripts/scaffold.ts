import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const COMMAND_NAME = /^[a-z][a-z-]*[a-z]$/;

const camelCase = (name: string) => name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

function typescriptOnly(name: string, exportName: string): string {
  return `import { defineCommand } from "../../framework/command.js";
import type { Feature } from "../../framework/types.js";

export const ${exportName}: Feature = {
  name: "${name}",
  commands: [
    defineCommand({
      name: "${name}",
      description: "TODO: describe /${name}",
      options: {
        text: { type: "string", description: "TODO: describe this input", required: true },
      },
      async execute(interaction, input) {
        await interaction.editReply(\`You said: \${input.text}\`);
      },
    }),
  ],
};
`;
}

function withPython(name: string, exportName: string, pythonName: string): string {
  return `import { z } from "zod";
import { defineCommand } from "../../framework/command.js";
import type { Feature } from "../../framework/types.js";

// What python/commands/${pythonName}.py returns.
const resultSchema = z.object({ message: z.string() });

export const ${exportName}: Feature = {
  name: "${name}",
  commands: [
    defineCommand({
      name: "${name}",
      description: "TODO: describe /${name}",
      options: {
        text: { type: "string", description: "TODO: describe this input", required: true },
      },
      async execute(interaction, input, { python }) {
        const { message } = await python.run("${pythonName}", input, resultSchema);
        await interaction.editReply(message);
      },
    }),
  ],
};
`;
}

const pythonCommand = (name: string) => `"""The logic behind /${name}."""


def run(data):
    return {"message": f"You said: {data['text']}"}
`;

const pythonTest = (pythonName: string) => `from commands.${pythonName} import run


def test_replies_with_the_text():
    assert run({"text": "hi"}) == {"message": "You said: hi"}
`;

export interface ScaffoldResult {
  created: string[];
  updated: string;
}

/** Creates a command's files and adds it to the feature list. Changes nothing if it can't. */
export function scaffoldCommand(root: string, name: string, python: boolean): ScaffoldResult {
  if (!COMMAND_NAME.test(name)) {
    throw new Error(`"${name}" must be lowercase letters and hyphens, such as "team-stats"`);
  }
  const exportName = `${camelCase(name)}Feature`;
  const pythonName = name.replaceAll("-", "_");

  const files: Record<string, string> = {
    [`apps/bot/src/features/${name}/index.ts`]: python
      ? withPython(name, exportName, pythonName)
      : typescriptOnly(name, exportName),
    ...(python && {
      [`python/commands/${pythonName}.py`]: pythonCommand(name),
      [`python/tests/test_${pythonName}.py`]: pythonTest(pythonName),
    }),
  };

  for (const file of Object.keys(files)) {
    if (existsSync(join(root, file))) throw new Error(`${file} already exists`);
  }

  const indexFile = "apps/bot/src/features/index.ts";
  const index = readFileSync(join(root, indexFile), "utf8");
  const list = /(export const features: Feature\[\] = \[)([\s\S]*?)(\];)/;
  if (!list.test(index)) throw new Error(`Couldn't find the feature list in ${indexFile}`);
  const updatedIndex = `import { ${exportName} } from "./${name}/index.js";\n${index}`.replace(
    list,
    (_, open: string, items: string, close: string) =>
      `${open}${items.trim().replace(/,$/, "")}, ${exportName}${close}`,
  );

  for (const [file, content] of Object.entries(files)) {
    mkdirSync(join(root, file, ".."), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  writeFileSync(join(root, indexFile), updatedIndex);

  return { created: Object.keys(files), updated: indexFile };
}

/** Tidies the feature list. It's only formatting, so a failure here doesn't matter. */
export function formatFile(root: string, file: string): void {
  try {
    execFileSync("pnpm", ["exec", "prettier", "--write", file], { cwd: root, stdio: "ignore" });
  } catch {
    // `pnpm format` will catch it.
  }
}
