-- The web page shows and edits the answer buttons, and reads the emoji list the bot saved for it.
GRANT SELECT (answer_options, emoji_options) ON roster_instances TO scrimbot_web;
--> statement-breakpoint
GRANT UPDATE (answer_options) ON roster_instances TO scrimbot_web;
