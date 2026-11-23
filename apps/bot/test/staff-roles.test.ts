import type { Database, DatabaseHandle } from "@scrimbot/db";
import { MessageFlags, PermissionFlagsBits } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { features } from "../src/features/index.js";
import { addStaffRole, removeStaffRole, staffRoleIds } from "../src/framework/staff-roles.js";
import { buildRegistry } from "../src/framework/registry.js";
import { routeInteraction } from "../src/framework/router.js";
import { fakeContext, fakeInteraction } from "./helpers.js";

vi.mock("../src/framework/staff-roles.js", () => ({
  staffRoleIds: vi.fn(),
  addStaffRole: vi.fn(),
  removeStaffRole: vi.fn(),
}));

const GUILD = "100000000000000001";
const ROLE = "100000000000000099";
const registry = buildRegistry(features);
const db = {} as Database;

/** Runs `/staff-roles`, as an administrator unless `admin` is false. */
async function run(options: { action: string; role?: string }, admin = true) {
  const interaction = fakeInteraction({
    kind: "command",
    commandName: "staff-roles",
    allowed: admin,
  });
  const raw: Record<string, unknown> = {
    action: { value: options.action },
    ...(options.role && { role: { role: { id: options.role, name: "Staff" } } }),
  };
  Object.assign(interaction, { options: { get: (name: string) => raw[name] } });
  if (!admin) Object.assign(interaction, { member: { roles: [ROLE] } });
  await routeInteraction(interaction, registry, {
    ...fakeContext(),
    database: { db } as DatabaseHandle,
  });
  return interaction;
}

beforeEach(() => vi.clearAllMocks());

describe("/staff-roles", () => {
  it("is shown and allowed only to administrators", () => {
    const command = registry.commands.get("staff-roles")!;
    expect(command.handler.requiredPermissions).toBe(PermissionFlagsBits.Administrator);
    expect(command.handler.data.toJSON().default_member_permissions).toBe(
      String(PermissionFlagsBits.Administrator),
    );
  });

  it("refuses a staff member who is not an administrator, on every use", async () => {
    vi.mocked(staffRoleIds).mockResolvedValue([ROLE]);
    const interaction = await run({ action: "add", role: ROLE }, false);
    expect(addStaffRole).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "You do not have permission to use this command.",
        flags: MessageFlags.Ephemeral,
      }),
    );
  });

  it("adds a role for this server and says so privately", async () => {
    vi.mocked(addStaffRole).mockResolvedValue(true);
    const interaction = await run({ action: "add", role: ROLE });
    expect(addStaffRole).toHaveBeenCalledWith(db, GUILD, ROLE);
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: `<@&${ROLE}> is now a staff role.` }),
    );
  });

  it("says when a role was already staff, or was not", async () => {
    vi.mocked(addStaffRole).mockResolvedValue(false);
    const again = await run({ action: "add", role: ROLE });
    expect(again.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: `<@&${ROLE}> was already a staff role.` }),
    );
    vi.mocked(removeStaffRole).mockResolvedValue(false);
    const missing = await run({ action: "remove", role: ROLE });
    expect(missing.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: `<@&${ROLE}> was not a staff role.` }),
    );
  });

  it("removes a role", async () => {
    vi.mocked(removeStaffRole).mockResolvedValue(true);
    const interaction = await run({ action: "remove", role: ROLE });
    expect(removeStaffRole).toHaveBeenCalledWith(db, GUILD, ROLE);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: `<@&${ROLE}> is no longer a staff role.` }),
    );
  });

  it("lists the roles, or says there are none, without pinging", async () => {
    vi.mocked(staffRoleIds).mockResolvedValueOnce([ROLE, "100000000000000098"]);
    const some = await run({ action: "list" });
    expect(staffRoleIds).toHaveBeenCalledWith(db, GUILD);
    expect(some.editReply).toHaveBeenCalledWith({
      content: `Staff roles, besides admins: <@&${ROLE}> <@&100000000000000098>`,
      allowedMentions: { parse: [] },
    });
    vi.mocked(staffRoleIds).mockResolvedValueOnce([]);
    const none = await run({ action: "list" });
    expect(none.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("No staff roles are set") }),
    );
  });

  it("needs a role to add or remove, and refuses @everyone", async () => {
    const missing = await run({ action: "add" });
    expect(missing.editReply).toHaveBeenCalledWith({ content: "Choose the role to add." });
    const everyone = await run({ action: "add", role: GUILD });
    expect(everyone.editReply).toHaveBeenCalledWith({
      content: "@everyone can't be a staff role.",
    });
    expect(addStaffRole).not.toHaveBeenCalled();
  });
});
