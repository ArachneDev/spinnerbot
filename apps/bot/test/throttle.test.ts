import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createThrottle } from "../src/features/build-roster/throttle.js";

describe("createThrottle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs the first call now and merges a burst into one run after the gap", async () => {
    const throttle = createThrottle(2000);
    const task = vi.fn(async () => {});
    const onError = vi.fn();

    throttle.schedule("a", task, onError);
    for (let i = 0; i < 20; i++) throttle.schedule("a", task, onError);
    expect(task).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1999);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("keeps keys apart and reports failures", async () => {
    const throttle = createThrottle(2000);
    const onError = vi.fn();
    throttle.schedule("a", async () => {}, onError);
    throttle.schedule("b", async () => Promise.reject(new Error("boom")), onError);
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("drops a waiting run when forgotten", async () => {
    const throttle = createThrottle(2000);
    const task = vi.fn(async () => {});
    throttle.schedule("a", task, vi.fn());
    throttle.schedule("a", task, vi.fn());
    throttle.forget("a");
    await vi.advanceTimersByTimeAsync(5000);
    expect(task).toHaveBeenCalledTimes(1);
  });
});
