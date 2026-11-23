ALTER TABLE "guild_roster_defaults" ADD COLUMN "embed_style" jsonb;--> statement-breakpoint
ALTER TABLE "roster_instances" ADD COLUMN "embed_style" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "roster_instances" ADD COLUMN "posted_embed_style" jsonb;