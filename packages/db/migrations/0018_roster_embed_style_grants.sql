GRANT SELECT (embed_style) ON roster_instances TO scrimbot_web;
--> statement-breakpoint
GRANT UPDATE (embed_style) ON roster_instances TO scrimbot_web;
--> statement-breakpoint
-- Rosters already posted show no extras, so a later edit must not leak into their redraws.
UPDATE roster_instances
SET posted_squad_leaders = '{}'::jsonb,
    posted_show_banner = false,
    posted_show_bench = true,
    posted_embed_style = '{}'::jsonb
WHERE posted_message_id IS NOT NULL AND posted_embed_style IS NULL;
