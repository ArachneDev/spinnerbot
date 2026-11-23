-- The web page raises the revision with every change, and browsers compare it to their own.
GRANT SELECT (revision) ON roster_instances TO scrimbot_web;
--> statement-breakpoint
GRANT UPDATE (revision) ON roster_instances TO scrimbot_web;
