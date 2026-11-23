CREATE TABLE "guild_roster_defaults" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"squad_names" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "roster_instances" ADD COLUMN "squad_names" jsonb DEFAULT '["CERBERUS","BLACKSPEAR","DIREHOUND","DEADWATCH","FORGEWEAVER","DREADNOUGHT","DEATHWING"]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "roster_instances" ADD COLUMN "squad_leaders" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "roster_instances" ADD COLUMN "show_banner" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "roster_instances" ADD COLUMN "show_bench" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "roster_instances" ADD COLUMN "posted_squad_names" jsonb;--> statement-breakpoint
ALTER TABLE "roster_instances" ADD COLUMN "posted_squad_leaders" jsonb;--> statement-breakpoint
ALTER TABLE "roster_instances" ADD COLUMN "posted_show_banner" boolean;--> statement-breakpoint
ALTER TABLE "roster_instances" ADD COLUMN "posted_show_bench" boolean;