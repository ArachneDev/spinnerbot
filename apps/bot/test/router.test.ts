import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { PUBLIC_COMMANDS } from "../src/command-access.js";
import { features } from "../src/features/index.js";
import { UserFacingError } from "../src/framework/errors.js";
import { buildRegistry } from "../src/framework/registry.js";
import { staffRoleIds } from "../src/framework/staff-roles.js";
import { routeInteraction, withError } from "../src/framework/router.js";
import type { SlashCommand } from "../src/framework/types.js";
import { fakeContext, fakeInteraction } from "./helpers.js";

// The staff roles come from the database. These tests give one server a single staff role.
vi.mock("../src/framework/staff-roles.js", () => ({ staffRoleIds: vi.fn() }));
const STAFF_ROLE_ID = "100000000000000099";
vi.mocked(staffRoleIds).mockResolvedValue([STAFF_ROLE_ID]);

function setup(overrides: Partial<SlashCommand> = {}) {
  const execute = vi.fn(async () => {});
  const component = vi.fn(async () => {});
  const registry = buildRegistry([
    {
      name: "demo",
      commands: [
        {
          data: new SlashCommandBuilder().setName("demo").setDescription("test"),
          defer: "none",
          execute,
          ...overrides,
        },
      ],
      components: [{ action: "go", execute: component }],
    },
    {
      name: "other",
      commands: [
        {
          data: new SlashCommandBuilder().setName("other").setDescription("test"),
          defer: "none",
          execute: async () => {},
        },
      ],
    },
  ]);
  return { execute, component, registry, context: fakeContext() };
}

describe("commands", () => {
  it("runs the matching command", async () => {
    const { execute, registry, context } = setup();
    await routeInteraction(
      fakeInteraction({ kind: "command", commandName: "demo" }),
      registry,
      context,
    );
    expect(execute).toHaveBeenCalledOnce();
  });

  it("defers privately before running when asked", async () => {
    const order: string[] = [];
    const { registry, context } = setup({
      defer: "ephemeral",
      execute: async () => void order.push("execute"),
    });
    const interaction = fakeInteraction({ kind: "command", commandName: "demo" });
    interaction.deferReply.mockImplementation(async () => void order.push("defer"));
    await routeInteraction(interaction, registry, context);
    expect(order).toEqual(["defer", "execute"]);
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
  });

  it("keeps a failure from escaping and tells the user privately", async () => {
    const { registry, context } = setup({
      execute: async () => {
        throw new Error("boom");
      },
    });
    const interaction = fakeInteraction({ kind: "command", commandName: "demo" });
    await expect(routeInteraction(interaction, registry, context)).resolves.toBeUndefined();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );
  });

  it("shows a UserFacingError's own message", async () => {
    const { registry, context } = setup({
      execute: async () => {
        throw new UserFacingError("Pick a smaller number");
      },
    });
    const interaction = fakeInteraction({ kind: "command", commandName: "demo" });
    await routeInteraction(interaction, registry, context);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Pick a smaller number" }),
    );
  });

  it("edits the deferred reply when a deferred command fails", async () => {
    const { registry, context } = setup({
      defer: "ephemeral",
      execute: async () => {
        throw new Error("boom");
      },
    });
    const interaction = fakeInteraction({ kind: "command", commandName: "demo" });
    await routeInteraction(interaction, registry, context);
    expect(interaction.editReply).toHaveBeenCalledOnce();
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it("survives Discord rejecting the failure notice", async () => {
    const { registry, context } = setup({
      execute: async () => {
        throw new Error("boom");
      },
    });
    const interaction = fakeInteraction({ kind: "command", commandName: "demo" });
    interaction.reply.mockRejectedValue(new Error("Unknown interaction"));
    await expect(routeInteraction(interaction, registry, context)).resolves.toBeUndefined();
  });

  it("blocks a member without the required permission", async () => {
    const { execute, registry, context } = setup({
      requiredPermissions: PermissionFlagsBits.ManageEvents,
    });
    const interaction = fakeInteraction({ kind: "command", commandName: "demo", allowed: false });
    await routeInteraction(interaction, registry, context);
    expect(execute).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledOnce();
  });

  it("runs a restricted command only for an admin or a staff role", async () => {
    const { execute, registry, context } = setup();
    const member = fakeInteraction({ kind: "command", commandName: "demo", allowed: false });
    await routeInteraction(member, registry, context);
    expect(execute).not.toHaveBeenCalled();
    expect(member.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );

    const staff = fakeInteraction({ kind: "command", commandName: "demo", allowed: false });
    Object.assign(staff, { member: { roles: [STAFF_ROLE_ID] } });
    await routeInteraction(staff, registry, context);
    expect(execute).toHaveBeenCalledOnce();

    const cached = fakeInteraction({ kind: "command", commandName: "demo", allowed: false });
    Object.assign(cached, { member: { roles: { cache: new Set([STAFF_ROLE_ID]) } } });
    await routeInteraction(cached, registry, context);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("looks up the staff roles of the interaction's own server, and not for an admin", async () => {
    const { execute, registry, context } = setup();
    vi.mocked(staffRoleIds).mockClear();
    const admin = fakeInteraction({ kind: "command", commandName: "demo" });
    await routeInteraction(admin, registry, context);
    expect(execute).toHaveBeenCalledOnce();
    expect(staffRoleIds).not.toHaveBeenCalled();

    // A fresh database has no staff roles, so a member with a role is refused.
    vi.mocked(staffRoleIds).mockResolvedValueOnce([]);
    const member = fakeInteraction({ kind: "command", commandName: "demo", allowed: false });
    Object.assign(member, { member: { roles: [STAFF_ROLE_ID] } });
    await routeInteraction(member, registry, context);
    expect(staffRoleIds).toHaveBeenCalledWith(context.database.db, "100000000000000001");
    expect(execute).toHaveBeenCalledOnce();
  });

  it("names only real commands as public", () => {
    const names = [...buildRegistry(features).commands.keys()];
    expect(names).toEqual(expect.arrayContaining([...PUBLIC_COMMANDS]));
  });

  it("answers an unknown command", async () => {
    const { registry, context } = setup();
    const interaction = fakeInteraction({ kind: "command", commandName: "gone" });
    await routeInteraction(interaction, registry, context);
    expect(interaction.reply).toHaveBeenCalledOnce();
  });
});

describe("components", () => {
  it("routes by feature and action and passes the arguments", async () => {
    const { component, registry, context } = setup();
    const interaction = fakeInteraction({ kind: "component", customId: "demo:go:42:abc" });
    await routeInteraction(interaction, registry, context);
    expect(component).toHaveBeenCalledWith(interaction, ["42", "abc"], expect.anything());
  });

  const failing =
    (interaction: ReturnType<typeof fakeInteraction>, deferred = false) =>
    async () => {
      if (deferred) Object.assign(interaction, { deferred: true });
      throw new UserFacingError("Nothing was posted");
    };

  it("shows a failure inside a private message, keeping its link and buttons", async () => {
    const { component, registry, context } = setup();
    const interaction = fakeInteraction({
      kind: "component",
      customId: "demo:go",
      ephemeral: true,
      content: "### Roster draft\n[Open the roster builder](https://x)",
    });
    component.mockImplementation(failing(interaction));
    await routeInteraction(interaction, registry, context);
    // Only the text changes, so the buttons and embeds stay.
    expect(interaction.update).toHaveBeenCalledWith({
      content: "> ⚠️ Nothing was posted\n### Roster draft\n[Open the roster builder](https://x)",
    });
    expect(interaction.followUp).not.toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it("edits a deferred private message the same way", async () => {
    const { component, registry, context } = setup();
    const interaction = fakeInteraction({
      kind: "component",
      customId: "demo:go",
      ephemeral: true,
    });
    component.mockImplementation(failing(interaction, true));
    await routeInteraction(interaction, registry, context);
    expect(interaction.editReply).toHaveBeenCalledWith({ content: "> ⚠️ Nothing was posted" });
    expect(interaction.followUp).not.toHaveBeenCalled();
  });

  it("answers a failure on a public message privately, and removes the notice later", async () => {
    vi.useFakeTimers();
    try {
      const { component, registry, context } = setup();
      const pressed = fakeInteraction({ kind: "component", customId: "demo:go" });
      component.mockImplementation(failing(pressed));
      await routeInteraction(pressed, registry, context);
      expect(pressed.update).not.toHaveBeenCalled();
      expect(pressed.reply).toHaveBeenCalledWith({
        content: "Nothing was posted",
        flags: MessageFlags.Ephemeral,
      });

      const deferred = fakeInteraction({ kind: "component", customId: "demo:go" });
      component.mockImplementation(failing(deferred, true));
      await routeInteraction(deferred, registry, context);
      expect(deferred.editReply).not.toHaveBeenCalled();
      expect(deferred.followUp).toHaveBeenCalledWith({
        content: "Nothing was posted",
        flags: MessageFlags.Ephemeral,
      });

      await vi.advanceTimersByTimeAsync(14_000);
      expect(pressed.deleteReply).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(pressed.deleteReply).toHaveBeenCalledWith(undefined);
      expect(deferred.deleteReply).toHaveBeenCalledWith({ id: "follow-up" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("replaces an earlier error line rather than stacking them", () => {
    expect(withError("> ⚠️ First\nDraft", "Second")).toBe("> ⚠️ Second\nDraft");
    expect(withError("", "Only")).toBe("> ⚠️ Only");
  });

  it("answers a button from a removed feature instead of failing silently", async () => {
    const { component, registry, context } = setup();
    const interaction = fakeInteraction({ kind: "component", customId: "removed:go" });
    await routeInteraction(interaction, registry, context);
    expect(component).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledOnce();
  });
});
