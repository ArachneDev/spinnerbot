import { z } from "zod";

/**
 * Everything the web app may ask the bot to do. A type missing from this list can't be queued
 * or run, so a compromised web container can only request these actions.
 *
 * Handlers can run more than once, so each one must be safe to repeat.
 */
export const jobPayloads = {
  /** Proves the queue works end to end. Replace or join with real jobs as features need them. */
  "system.heartbeat": z.object({ note: z.string().max(200).optional() }),
  /** The saved roster changed, so the leader's private preview in Discord should be redrawn. */
  "roster.preview": z.object({ id: z.uuid() }),
  /** The leader opened the button editor, so list the server's emoji for the web page. */
  "roster.emojis": z.object({ id: z.uuid() }),
} as const;

export type JobType = keyof typeof jobPayloads;
export type JobPayload<T extends JobType> = z.infer<(typeof jobPayloads)[T]>;

export function isJobType(value: string): value is JobType {
  return Object.hasOwn(jobPayloads, value);
}

export function parseJobPayload<T extends JobType>(type: T, payload: unknown): JobPayload<T> {
  return jobPayloads[type].parse(payload) as JobPayload<T>;
}
