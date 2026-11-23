import { describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import { DEFAULT_ANSWER_OPTIONS, type StoredEvent } from "@scrimbot/core";
import type { RosterDisplay } from "../src/features/build-roster/display.js";
import { renderRosterImage } from "../src/features/build-roster/roster-image.js";
import { rosterEmbed, rosterFiles } from "../src/features/build-roster/view.js";
import { ASSET_FILES, readAsset, warnMissingAssets } from "../src/framework/assets.js";
import { brandedEmbed, brandFile } from "../src/framework/brand.js";
import { TINY_PNG, useAssets } from "./assets-fixture.js";

const event: StoredEvent = {
  title: "Scrim",
  complete: true,
  responses: {
    accepted: [
      { displayName: "Alice", discordUserId: "1" },
      { displayName: "Bob", discordUserId: "2" },
    ],
    declined: [],
    tentative: [],
  },
};
const assignments = { "0": 1, "1": 1 };
const display: RosterDisplay = {
  squadNames: ["Cerberus", "B", "C", "D", "E", "F", "G"],
  squadLeaders: {},
  showBanner: true,
  showBench: true,
  embedStyle: { thumbnail: "crest" },
};
const withImage: RosterDisplay = { ...display, embedStyle: { bannerImage: "roster" } };

/** An empty folder: the case in CI and anywhere the owner has not copied the art. */
describe("without any art", () => {
  useAssets({});
  it("finds no file, and warns once for each", () => {
    const log = { warn: vi.fn() } as unknown as Logger;
    expect(readAsset("arachne-crest.png")).toBeUndefined();
    expect(brandFile("arachne-banner.webp")).toBeUndefined();
    warnMissingAssets(log);
    expect(log.warn).toHaveBeenCalledTimes(ASSET_FILES.length);
  });

  it("posts the roster with no crest, banner or thumbnail", async () => {
    const files = await rosterFiles(event, assignments, { ...display, embedStyle: {} });
    expect(files).toEqual([]);
    const embed = rosterEmbed(event, assignments, new Map(), DEFAULT_ANSWER_OPTIONS, { display });
    expect(embed.data.image).toBeUndefined();
    expect(embed.data.thumbnail).toBeUndefined();
    expect(embed.data.author?.icon_url).toBeUndefined();
    expect(brandedEmbed("X").data.author?.icon_url).toBeUndefined();
  });

  it("still draws the roster image, without emblems, crest or background", async () => {
    const png = await renderRosterImage(event, assignments, withImage);
    expect(png?.subarray(1, 4).toString()).toBe("PNG");
  }, 20_000);
});

describe("with some art", () => {
  useAssets({
    "arachne-crest.png": TINY_PNG,
    "arachne-crest-large.png": TINY_PNG,
    "emblems/cerberus.svg":
      '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>',
  });

  it("attaches what exists and leaves out the rest", async () => {
    const files = await rosterFiles(event, assignments, display);
    expect(files.map((file) => file.name)).toEqual(["arachne-crest.png"]);
    const embed = rosterEmbed(event, assignments, new Map(), DEFAULT_ANSWER_OPTIONS, { display });
    expect(embed.data.thumbnail?.url).toBe("attachment://arachne-crest.png");
    expect(embed.data.image).toBeUndefined();
  });

  it("draws the roster image with the files it has", async () => {
    const png = await renderRosterImage(event, assignments, withImage);
    expect(png?.subarray(1, 4).toString()).toBe("PNG");
  }, 20_000);
});
