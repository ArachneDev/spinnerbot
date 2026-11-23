CREATE TABLE "roster_responses" (
	"instance_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"answer" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roster_responses_instance_id_user_id_pk" PRIMARY KEY("instance_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "roster_responses" ADD CONSTRAINT "roster_responses_instance_id_roster_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."roster_instances"("id") ON DELETE cascade ON UPDATE no action;