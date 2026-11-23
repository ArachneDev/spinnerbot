CREATE TABLE "roster_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"source_channel_id" text NOT NULL,
	"source_message_id" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"assignments" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"posted_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "roster_instances_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE INDEX "roster_instances_expires_idx" ON "roster_instances" USING btree ("expires_at");