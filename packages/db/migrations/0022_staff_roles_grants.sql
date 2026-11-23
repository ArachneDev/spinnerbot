-- Only the bot reads and changes a server's staff roles. The web app never sees them.
GRANT SELECT, INSERT, DELETE ON staff_roles TO scrimbot_bot;
