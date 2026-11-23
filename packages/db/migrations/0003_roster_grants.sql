-- The web reads a roster by its token and saves squad assignments. It can't create, delete or
-- repost rosters, or read who owns them. The bot manages the whole life of an instance.
GRANT SELECT (id, token, snapshot, assignments, status, expires_at) ON roster_instances TO scrimbot_web;
--> statement-breakpoint
GRANT UPDATE (assignments) ON roster_instances TO scrimbot_web;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON roster_instances TO scrimbot_bot;
