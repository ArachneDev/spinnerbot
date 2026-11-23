-- Only the bot handles answers. The web app never sees them.
GRANT SELECT, INSERT, UPDATE, DELETE ON roster_responses TO scrimbot_bot;
