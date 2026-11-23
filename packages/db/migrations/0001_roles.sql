-- The web and bot connect with their own roles, so a compromised web container can't run jobs or
-- rewrite history. These roles can't log in until deployment grants LOGIN and sets a password.
-- Every later migration that adds a table must grant access to it here too.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'scrimbot_web') THEN
    CREATE ROLE scrimbot_web NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'scrimbot_bot') THEN
    CREATE ROLE scrimbot_bot NOLOGIN;
  END IF;
END $$;
--> statement-breakpoint
GRANT SELECT ON guilds TO scrimbot_web;
--> statement-breakpoint
GRANT INSERT ON audit_log TO scrimbot_web;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE audit_log_id_seq TO scrimbot_web;
--> statement-breakpoint
-- The web can queue a job and learn its ID, but can't read or change the queue.
GRANT INSERT (type, payload), SELECT (id) ON bot_jobs TO scrimbot_web;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE bot_jobs_id_seq TO scrimbot_web;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON guilds TO scrimbot_bot;
--> statement-breakpoint
GRANT INSERT ON audit_log TO scrimbot_bot;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE audit_log_id_seq TO scrimbot_bot;
--> statement-breakpoint
GRANT SELECT, UPDATE ON bot_jobs TO scrimbot_bot;
