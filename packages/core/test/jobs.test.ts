import { describe, expect, it } from "vitest";
import { isJobType, parseJobPayload } from "@scrimbot/core";

describe("job list", () => {
  it("accepts a listed type and rejects anything else", () => {
    expect(isJobType("system.heartbeat")).toBe(true);
    expect(isJobType("system.deleteEverything")).toBe(false);
    expect(isJobType("toString")).toBe(false);
  });

  it("validates payloads", () => {
    expect(parseJobPayload("system.heartbeat", { note: "hi" })).toEqual({ note: "hi" });
    expect(() => parseJobPayload("system.heartbeat", { note: "x".repeat(201) })).toThrow();
  });
});
