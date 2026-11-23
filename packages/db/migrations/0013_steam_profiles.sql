CREATE TABLE "steam_profiles" (
	"discord_user_id" text PRIMARY KEY NOT NULL,
	"steam_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "steam_profiles_steam_id_unique" UNIQUE("steam_id")
);
