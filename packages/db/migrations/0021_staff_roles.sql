CREATE TABLE "staff_roles" (
	"guild_id" text NOT NULL,
	"role_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_roles_guild_id_role_id_pk" PRIMARY KEY("guild_id","role_id")
);
