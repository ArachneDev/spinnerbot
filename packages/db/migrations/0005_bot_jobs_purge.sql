-- The bot deletes finished jobs after a day (failed ones after a week) so the queue stays small.
GRANT DELETE ON bot_jobs TO scrimbot_bot;
