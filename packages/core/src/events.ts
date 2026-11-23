/**
 * The vocabulary rosters and ready checks use, whoever runs the event.
 *
 * Apollo is one implementation of EventSource. A later native source implements the same
 * interface, so replacing Apollo doesn't touch the features built on top.
 */

export type ResponseStatus = "accepted" | "declined" | "tentative";

/** A person as an event source reports them. Some sources can't supply a Discord ID. */
export interface EventParticipant {
  displayName: string;
  discordUserId?: string;
}

export type EventResponses = Record<ResponseStatus, EventParticipant[]>;

export interface EventSnapshot {
  title: string;
  description?: string;
  startsAt?: Date;
  responses: EventResponses;
  /** False when the source can't prove the lists are complete. Callers must not ping on this. */
  complete: boolean;
}

/** Where an event lives in Discord. */
export interface EventLocation {
  guildId: string;
  channelId: string;
  messageId: string;
}

export interface EventSource {
  /** Stable identifier stored with saved events, such as "apollo" or "native". */
  readonly id: string;
  read(location: EventLocation): Promise<EventSnapshot>;
}
