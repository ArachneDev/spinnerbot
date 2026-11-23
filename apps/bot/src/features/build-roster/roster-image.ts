import { Resvg } from "@resvg/resvg-js";
import { buildRoster, type Assignments, type StoredEvent } from "@scrimbot/core";
import satori from "satori";
import { fontFile, readAsset } from "../../framework/assets.js";
import type { RosterDisplay } from "./display.js";

export const ROSTER_IMAGE_FILE = "roster.png";

const WIDTH = 1640;
const MARGIN = 38;
const GAP = 18;
const COLUMNS = 3;
const HEADER_HEIGHT = 200;
const FOOTER_HEIGHT = 60;
const CARD_HEAD = 136;
const CARD_PADDING = 22;
const PLAYER_ROW = 44;
const MIN_PLAYER_ROWS = 3;
const SINGLE_COLUMN_PLAYERS = 5;
const NOTCH = 20;
const MAX_NAME_LENGTH = 22;
const CACHE_SIZE = 20;

const RED = "#e3121e";
const GOLD = "#ffc21a";
/** Arachne's colour for each board slot, and for squads past the clan's seven. */
const SLOT_COLOURS = ["#df0325", "#e9a700", "#fa6e1d", "#00cdde", "#7fc200", "#1289e7", "#a661e8"];
const CLAN_COLOURS: Record<string, string> = {
  CERBERUS: "#df0325",
  BLACKSPEAR: "#e9a700",
  DIREHOUND: "#fa6e1d",
  DEADWATCH: "#00cdde",
  FORGEWEAVER: "#7fc200",
  DREADNOUGHT: "#1289e7",
  DEATHWING: "#a661e8",
};
/** The design system has a unit shield for these. ForgeWeaver and renamed squads go without. */
const EMBLEMS = new Set([
  "CERBERUS",
  "BLACKSPEAR",
  "DIREHOUND",
  "DEADWATCH",
  "DREADNOUGHT",
  "DEATHWING",
]);
const CROWN =
  "M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294zM5 21h14";

const dataUrls = new Map<string, string>();
/** A picture as a data URL, or undefined when its file is missing, so the image goes without it. */
function dataUrl(path: string, type: string): string | undefined {
  let url = dataUrls.get(path);
  if (!url) {
    const bytes = readAsset(path);
    if (!bytes) return undefined;
    url = `data:${type};base64,${bytes.toString("base64")}`;
    dataUrls.set(path, url);
  }
  return url;
}

const HEADING_FONT = "Oswald latin, Oswald latin-ext, Oswald cyrillic";
const BODY_FONT = "Barlow latin, Barlow latin-ext, Oswald cyrillic";
const MONO_FONT = "Share Tech Mono";

// One name per subset, because Satori picks a single font per name and weight.
const font = (family: string, subset: string, weight: 500 | 600 | 700) => ({
  name: `${family} ${subset}`,
  data: fontFile(family.toLowerCase(), `${family.toLowerCase()}-${subset}-${weight}-normal.woff`),
  weight,
});
let fonts: Parameters<typeof satori>[1]["fonts"] | undefined;
function loadFonts() {
  fonts ??= [
    {
      name: MONO_FONT,
      data: fontFile("share-tech-mono", "share-tech-mono-latin-400-normal.woff"),
      weight: 400,
    },
    ...["latin", "latin-ext"].flatMap((subset) => [
      font("Barlow", subset, 500),
      font("Barlow", subset, 600),
    ]),
    ...["latin", "latin-ext", "cyrillic"].flatMap((subset) => [
      font("Oswald", subset, 500),
      font("Oswald", subset, 700),
    ]),
  ];
  return fonts;
}

type Style = Record<string, string | number>;
interface Node {
  type: string;
  props: Record<string, unknown>;
}
const div = (style: Style, ...children: (Node | string)[]): Node => ({
  type: "div",
  props: { style: { display: "flex", ...style }, children },
});
const image = (src: string, width: number, height: number, style: Style = {}): Node => ({
  type: "img",
  props: { src, width, height, style },
});

const crown = (size: number): Node => ({
  type: "svg",
  props: {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    style: { flexShrink: 0, marginLeft: 12 },
    children: { type: "path", props: { d: CROWN, fill: GOLD, stroke: GOLD, strokeWidth: 1.5 } },
  },
});

/** A name for the picture: the fonts have no emoji, and past this length it wouldn't fit. */
function shortName(displayName: string): string {
  const name = displayName.replace(/\p{Extended_Pictographic}|️|‍/gu, "").trim();
  return name.length > MAX_NAME_LENGTH ? `${name.slice(0, MAX_NAME_LENGTH - 1)}…` : name;
}

type Squad = ReturnType<typeof buildRoster>["squads"][number];

const clanName = (squad: Squad) => squad.name.trim().toUpperCase();
const squadColour = (squad: Squad) =>
  CLAN_COLOURS[clanName(squad)] ?? SLOT_COLOURS[squad.number - 1] ?? RED;
/** Past five players, the names run in two columns. */
const playerRows = ({ players }: Squad) =>
  players.length > SINGLE_COLUMN_PLAYERS ? Math.ceil(players.length / 2) : players.length;

function playerLine(squad: Squad, player: Squad["players"][number], colour: string, width: number) {
  const leader = player === squad.leader;
  return div(
    { alignItems: "center", height: PLAYER_ROW, width },
    div({
      width: 11,
      height: 11,
      flexShrink: 0,
      marginRight: 16,
      backgroundColor: colour,
      transform: "rotate(45deg)",
      boxShadow: `0 0 10px ${colour}`,
    }),
    div(
      {
        fontFamily: BODY_FONT,
        fontSize: 28,
        fontWeight: leader ? 600 : 500,
        color: leader ? "#ffffff" : "#e4e0dc",
        overflow: "hidden",
        whiteSpace: "nowrap",
        maxWidth: width - 75,
      },
      shortName(player.displayName),
    ),
    ...(leader ? [crown(28)] : []),
  );
}

function squadCard(squad: Squad, width: number, height: number): Node {
  const colour = squadColour(squad);
  const inner = width - CARD_PADDING * 2;
  const emblemUrl = EMBLEMS.has(clanName(squad))
    ? dataUrl(`emblems/${clanName(squad).toLowerCase()}.svg`, "image/svg+xml")
    : undefined;
  const emblem = emblemUrl ? [image(emblemUrl, 92, 92, { marginRight: 20, flexShrink: 0 })] : [];
  const twoColumns = squad.players.length > SINGLE_COLUMN_PLAYERS;
  const firstColumn = twoColumns ? Math.ceil(squad.players.length / 2) : squad.players.length;
  const column = (players: Squad["players"], columnWidth: number) =>
    div(
      { flexDirection: "column", width: columnWidth },
      ...players.map((player) => playerLine(squad, player, colour, columnWidth)),
    );
  const clip = `polygon(0 0, ${width - NOTCH}px 0, ${width}px ${NOTCH}px, ${width}px ${height}px, ${NOTCH}px ${height}px, 0 ${height - NOTCH}px)`;

  return div(
    {
      position: "relative",
      boxSizing: "border-box",
      flexDirection: "column",
      flexShrink: 0,
      width,
      height,
      backgroundColor: "#0c0c10",
      border: "1px solid #ffffff12",
      backgroundImage: `radial-gradient(circle at 18% 22%, ${colour}55 0%, ${colour}1a 30%, #0c0c1000 58%)`,
      clipPath: clip,
    },
    div({
      position: "absolute",
      top: 0,
      left: 0,
      width,
      height: 3,
      backgroundImage: `linear-gradient(90deg, ${colour} 0%, ${colour}aa 55%, ${colour}00 100%)`,
    }),
    div(
      {
        alignItems: "center",
        height: CARD_HEAD - 18,
        padding: `0 ${CARD_PADDING}px`,
        width,
        boxSizing: "border-box",
      },
      ...emblem,
      div(
        { flexDirection: "column", minWidth: 0 },
        ...(squad.type
          ? [
              div(
                {
                  fontFamily: MONO_FONT,
                  fontSize: 19,
                  letterSpacing: 5,
                  color: colour,
                  marginBottom: 2,
                },
                squad.type.toUpperCase(),
              ),
            ]
          : []),
        div(
          {
            fontFamily: HEADING_FONT,
            fontWeight: 700,
            fontSize: 50,
            lineHeight: 1.1,
            color: "#ffffff",
            overflow: "hidden",
            whiteSpace: "nowrap",
            maxWidth: inner - (emblem.length ? 112 : 0),
          },
          squad.name.toUpperCase(),
        ),
      ),
    ),
    div({
      height: 1,
      width: inner,
      marginLeft: CARD_PADDING,
      marginBottom: 12,
      backgroundColor: "#ffffff1f",
    }),
    div(
      { paddingLeft: CARD_PADDING, width },
      column(squad.players.slice(0, firstColumn), twoColumns ? inner / 2 : inner),
      ...(twoColumns ? [column(squad.players.slice(firstColumn), inner / 2)] : []),
    ),
  );
}

/** The start in London and central European time, the two the clan plays by. */
export function eventTimes(startsAt: string): { date: string; times: [string, string][] } {
  const start = new Date(startsAt);
  const date = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/London",
  })
    .format(start)
    .replace(",", "");
  const time = (timeZone: string): [string, string] => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone,
      timeZoneName: "short",
    }).formatToParts(start);
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? "";
    return [
      `${value("hour")}:${value("minute")}${value("dayPeriod").toUpperCase()}`,
      value("timeZoneName").replace("GMT+1", "BST"),
    ];
  };
  return { date, times: [time("Europe/London"), time("Europe/Paris")] };
}

function infoCell(label: string, width: number, ...value: (Node | string)[]): Node {
  return div(
    {
      flexDirection: "column",
      justifyContent: "center",
      boxSizing: "border-box",
      width,
      height: 84,
      padding: "0 24px",
      borderRight: "1px solid #ffffff1a",
      borderBottom: "1px solid #ffffff1a",
    },
    div(
      { fontFamily: MONO_FONT, fontSize: 16, letterSpacing: 4, color: "#a39c98", marginBottom: 4 },
      label.toUpperCase(),
    ),
    div(
      {
        fontFamily: HEADING_FONT,
        fontWeight: 500,
        fontSize: 32,
        lineHeight: 1.15,
        color: "#ffffff",
        alignItems: "center",
        whiteSpace: "nowrap",
        overflow: "hidden",
      },
      ...value,
    ),
  );
}

function header(event: StoredEvent, display: RosterDisplay, width: number): Node {
  const { imageTitle, opponents, map, faction } = display.embedStyle;
  const cells: Node[] = [];
  const panelCell = 390;
  if (event.startsAt) {
    const { date, times } = eventTimes(event.startsAt);
    const zone = (text: string) => div({ color: RED, margin: "0 8px 0 6px" }, text);
    cells.push(
      infoCell(
        date,
        panelCell,
        times[0]![0],
        zone(times[0]![1]),
        div({ color: RED, marginRight: 8 }, "/"),
        times[1]![0],
        zone(times[1]![1]),
      ),
    );
  }
  const text = (label: string, value: string | undefined) => {
    if (value) cells.push(infoCell(label, panelCell, value.toUpperCase()));
  };
  text("Opponents", opponents);
  text("Map", map);
  text("Faction", faction);

  const crestUrl = dataUrl("arachne-crest-large.png", "image/png");
  const panelWidth = Math.min(cells.length, 2) * panelCell + (cells.length > 0 ? 2 : 0);
  return div(
    { alignItems: "center", width, height: HEADER_HEIGHT, flexShrink: 0 },
    ...(crestUrl
      ? [image(crestUrl, 170, 165, { objectFit: "contain", marginRight: 26, flexShrink: 0 })]
      : [div({ width: 196, flexShrink: 0 })]),
    div(
      { flexDirection: "column", width: width - 196 - panelWidth - 24 },
      div(
        { fontFamily: MONO_FONT, fontSize: 20, letterSpacing: 7, color: RED, marginBottom: 2 },
        "WARDOGS // DEPLOYMENT ORDERS",
      ),
      div(
        {
          fontFamily: HEADING_FONT,
          fontWeight: 700,
          fontSize: cells.length > 2 ? 68 : 84,
          lineHeight: 1.15,
          color: "#ffffff",
          whiteSpace: "nowrap",
          overflow: "hidden",
        },
        (imageTitle ?? "Arachne Roster").toUpperCase(),
      ),
      div({
        height: 4,
        marginTop: 6,
        width: "100%",
        backgroundImage: `linear-gradient(90deg, ${RED} 0%, ${RED} 60%, ${RED}00 100%)`,
      }),
    ),
    ...(cells.length > 0
      ? [
          div(
            {
              flexWrap: "wrap",
              width: panelWidth,
              marginLeft: 24,
              flexShrink: 0,
              backgroundColor: "#0a0a0dcc",
              borderTop: "1px solid #ffffff1a",
              borderLeft: "1px solid #ffffff1a",
            },
            ...cells,
          ),
        ]
      : []),
  );
}

async function draw(event: StoredEvent, squads: Squad[], display: RosterDisplay): Promise<Buffer> {
  const contentWidth = WIDTH - MARGIN * 2;
  const columns = Math.min(squads.length, COLUMNS);
  const cardWidth = Math.floor((contentWidth - GAP * (columns - 1)) / columns);
  const rows: Squad[][] = [];
  for (let i = 0; i < squads.length; i += columns) rows.push(squads.slice(i, i + columns));
  const rowHeight = (row: Squad[]) =>
    CARD_HEAD + CARD_PADDING + Math.max(MIN_PLAYER_ROWS, ...row.map(playerRows)) * PLAYER_ROW;
  const height =
    MARGIN +
    HEADER_HEIGHT +
    GAP +
    rows.reduce((total, row) => total + rowHeight(row) + GAP, 0) +
    FOOTER_HEIGHT;

  const heroUrl = dataUrl("hero-battlefield.jpg", "image/jpeg");
  const svg = await satori(
    div(
      { position: "relative", width: WIDTH, height, backgroundColor: "#07070a" },
      ...(heroUrl
        ? [
            image(heroUrl, WIDTH, height, {
              position: "absolute",
              top: 0,
              left: 0,
              objectFit: "cover",
              opacity: 0.16,
            }),
          ]
        : []),
      div({
        position: "absolute",
        top: 0,
        left: 0,
        width: WIDTH,
        height,
        backgroundImage: `radial-gradient(circle at 0% 0%, ${RED}70 0%, #07070a00 45%), radial-gradient(circle at 100% 100%, ${RED}38 0%, #07070a00 35%)`,
      }),
      div({
        position: "absolute",
        top: 12,
        left: 12,
        width: WIDTH - 24,
        height: height - 24,
        border: `1px solid ${RED}55`,
      }),
      div(
        {
          position: "absolute",
          top: MARGIN - 12,
          left: MARGIN,
          flexDirection: "column",
          width: contentWidth,
        },
        header(event, display, contentWidth),
        div({
          height: 1,
          width: contentWidth,
          marginBottom: GAP,
          backgroundImage: `linear-gradient(90deg, ${RED}aa 0%, ${RED}33 100%)`,
        }),
        ...rows.map((row) =>
          div(
            { gap: GAP, marginBottom: GAP },
            ...row.map((squad) => squadCard(squad, cardWidth, rowHeight(row))),
          ),
        ),
        div(
          {
            justifyContent: "space-between",
            alignItems: "center",
            height: FOOTER_HEIGHT - 20,
            width: contentWidth,
            fontFamily: MONO_FONT,
            fontSize: 17,
            letterSpacing: 5,
            color: "#8f8884",
          },
          "ARACHNE // WARDOGS",
          div({}, "ONE PACK ", div({ color: RED, margin: "0 8px" }, "//"), " ONE PURPOSE"),
        ),
      ),
    ) as unknown as Parameters<typeof satori>[0],
    { width: WIDTH, height, fonts: loadFonts() },
  );
  return Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: WIDTH } }).render().asPng());
}

const rendered = new Map<string, Buffer>();
/** Changes come in bursts while the leader works, so a preview waits for them to stop. */
const QUIET_MS = 1500;

// The drawing is heavy, so only one runs at a time across all rosters.
let queue: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => undefined);
  return run;
}

/**
 * The squads as a deployment poster, for show. Nobody can answer on it, so it only changes with the
 * squads and its own details. Null when no one is placed yet.
 */
export async function renderRosterImage(
  event: StoredEvent,
  assignments: Assignments,
  display: RosterDisplay,
): Promise<Buffer | null> {
  const squads = buildRoster(event, assignments, display).squads.filter(
    (squad) => squad.players.length > 0,
  );
  if (squads.length === 0) return null;

  // A preview redraws often, usually for changes that don't touch the picture.
  const { imageTitle, opponents, map, faction } = display.embedStyle;
  const key = JSON.stringify([
    event.startsAt,
    imageTitle,
    opponents,
    map,
    faction,
    squads.map((s) => [s.number, s.name, s.leader?.displayName, s.players]),
  ]);
  const cached = rendered.get(key);
  if (cached) return cached;
  const png = await oneAtATime(async () => rendered.get(key) ?? draw(event, squads, display));
  if (rendered.size >= CACHE_SIZE) rendered.clear();
  rendered.set(key, png);
  return png;
}

const lastShown = new Map<string, Buffer>();
const waiting = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * The picture for a live preview, without waiting for it. Returns the newest one already drawn
 * for this roster, or none, and draws the current one once changes stop, then calls `onReady` so
 * the preview can show it.
 */
export function previewRosterImage(
  id: string,
  event: StoredEvent,
  assignments: Assignments,
  display: RosterDisplay,
  onReady: () => void,
  onError: (error: unknown) => void,
): Buffer | null {
  clearTimeout(waiting.get(id));
  waiting.delete(id);
  const timer = setTimeout(() => {
    waiting.delete(id);
    renderRosterImage(event, assignments, display)
      .then((png) => {
        const before = lastShown.get(id);
        if (!png || png === before) return;
        if (lastShown.size >= CACHE_SIZE) lastShown.clear();
        lastShown.set(id, png);
        onReady();
      })
      .catch(onError);
  }, QUIET_MS);
  timer.unref?.();
  return lastShown.get(id) ?? null;
}

/** Forget a roster's preview picture once it is posted or gone. */
export function forgetPreviewImage(id: string): void {
  clearTimeout(waiting.get(id));
  waiting.delete(id);
  lastShown.delete(id);
}
