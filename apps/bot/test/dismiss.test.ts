import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageComponentInteraction } from "discord.js";
import { finish } from "../src/framework/dismiss.js";
import { fakeInteraction } from "./helpers.js";

describe("finish", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const pressed = () => fakeInteraction({ kind: "component", customId: "x:y", ephemeral: true });
  const asComponent = (i: ReturnType<typeof pressed>) =>
    i as unknown as MessageComponentInteraction;

  it("replaces the message with the result, then deletes it after five seconds", async () => {
    const interaction = pressed();
    await finish(asComponent(interaction), "Roster posted.");
    expect(interaction.update).toHaveBeenCalledWith({
      content: "Roster posted.",
      embeds: [],
      components: [],
      attachments: [],
    });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(interaction.deleteReply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(interaction.deleteReply).toHaveBeenCalledOnce();
  });

  it("edits instead when the press was already answered, and can delete at once", async () => {
    const interaction = pressed();
    interaction.deferred = true;
    await finish(asComponent(interaction), "Roster cancelled.", { immediately: true });
    expect(interaction.editReply).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(0);
    expect(interaction.deleteReply).toHaveBeenCalledOnce();
  });

  it("ignores a failed delete", async () => {
    const interaction = pressed();
    interaction.deleteReply.mockRejectedValue(new Error("Unknown Message"));
    await finish(asComponent(interaction), "Roster deleted.", { immediately: true });
    await expect(vi.advanceTimersByTimeAsync(10_000)).resolves.not.toThrow();
  });
});
