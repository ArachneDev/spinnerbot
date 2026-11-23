-- Only the bot reads Steam accounts and stores them. The web app never sees them.
GRANT SELECT, INSERT, UPDATE, DELETE ON steam_profiles TO scrimbot_bot;
