-- The web page edits the squad names, leaders and options, and reads the guild to find its default.
GRANT SELECT (guild_id, squad_names, squad_leaders, show_banner, show_bench) ON roster_instances TO scrimbot_web;
--> statement-breakpoint
GRANT UPDATE (squad_names, squad_leaders, show_banner, show_bench) ON roster_instances TO scrimbot_web;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON guild_roster_defaults TO scrimbot_web;
--> statement-breakpoint
GRANT SELECT ON guild_roster_defaults TO scrimbot_bot;
--> statement-breakpoint
-- Rosters already posted say "Squad 1" and so on, and must not change name on their next redraw.
UPDATE roster_instances
SET squad_names = '["Squad 1","Squad 2","Squad 3","Squad 4","Squad 5","Squad 6","Squad 7"]'::jsonb,
    posted_squad_names = '["Squad 1","Squad 2","Squad 3","Squad 4","Squad 5","Squad 6","Squad 7"]'::jsonb
WHERE posted_message_id IS NOT NULL;
