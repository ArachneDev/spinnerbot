import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";
import { retryWithBackoff } from "../src/framework/retry.js";

describe("retryWithBackoff", () => {
  it("tries again, with a longer wait each time, until it works", async () => {
    vi.useFakeTimers();
    try {
      const attempt = vi
        .fn<() => Promise<string>>()
        .mockRejectedValueOnce(new Error("one"))
        .mockRejectedValueOnce(new Error("two"))
        .mockResolvedValue("done");
      const result = retryWithBackoff("Thing", attempt, pino({ level: "silent" }));
      await vi.advanceTimersByTimeAsync(1_000);
      expect(attempt).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1_999);
      expect(attempt).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toBe("done");
      expect(attempt).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
