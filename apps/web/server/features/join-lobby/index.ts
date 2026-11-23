import { isSteamLobby, steamJoinUrl } from "@scrimbot/core";
import { Hono } from "hono";
import type { WebFeature } from "../../types.js";

/**
 * Discord only allows http and https links on buttons, so a join button points here, and this page
 * hands over to Steam. It holds nothing secret: the numbers are public on the Steam profile, and
 * only digits are accepted, so it can't be made to redirect anywhere but a Steam lobby.
 */
function joinPage(url: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<meta http-equiv="refresh" content="0;url=${url}">
<title>Joining game</title>
</head>
<body>
<h1>Opening Steam</h1>
<p>If nothing happens, <a href="${url}">open the game in Steam</a>. You need Steam installed on this device.</p>
</body>
</html>
`;
}

export const joinLobbyFeature: WebFeature = {
  name: "join-lobby",
  routes() {
    return new Hono().get("/:appId/:lobbyId/:steamId", (c) => {
      const lobby = {
        appId: c.req.param("appId"),
        lobbyId: c.req.param("lobbyId"),
        steamId: c.req.param("steamId"),
      };
      if (!isSteamLobby(lobby)) return c.json({ error: "Not found" }, 404);
      return c.html(joinPage(steamJoinUrl(lobby)));
    });
  },
};
