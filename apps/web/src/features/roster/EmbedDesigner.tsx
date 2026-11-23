import { useEffect, useState } from "react";
import { EmojiPicker, type Emoji } from "./EmojiPicker";

export interface EmbedStyle {
  heading?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
  footer?: string | undefined;
  colour?: string | undefined;
  bannerImage?: "roster" | undefined;
  imageTitle?: string | undefined;
  opponents?: string | undefined;
  map?: string | undefined;
  faction?: string | undefined;
  bannerUrl?: string | undefined;
  thumbnail?: string | undefined;
  layout?: "columns" | "stacked" | undefined;
  showTime?: boolean | undefined;
  showProgress?: boolean | undefined;
  benchName?: string | undefined;
  pendingEmoji?: Emoji | undefined;
  leaderEmoji?: Emoji | undefined;
  squadEmojis?: (Emoji | null)[] | undefined;
}

const SWATCHES: [name: string, hex: string][] = [
  ["Arachne red", "#e3121e"],
  ["Signal", "#ed4b43"],
  ["Gold", "#e9a700"],
  ["Orange", "#fa6e1d"],
  ["Green", "#7fc200"],
  ["Cyan", "#00cdde"],
  ["Blue", "#1289e7"],
  ["Violet", "#a661e8"],
];

/** Commits on leaving the field, so half-typed text is never saved. Empty means the default. */
function TextField({
  label,
  hint,
  value,
  max,
  long = false,
  type = "text",
  error,
  placeholder,
  onCommit,
}: {
  label: string;
  hint?: string;
  value: string | undefined;
  max: number;
  long?: boolean;
  type?: "text" | "url";
  error?: string | undefined;
  placeholder?: string;
  onCommit: (value: string | undefined) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => setDraft(value ?? ""), [value]);
  const shared = {
    className: "field",
    value: draft,
    maxLength: max,
    placeholder,
    onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
    // Only a real change is sent, so leaving a field can't undo someone else's edit to it.
    onBlur: () => {
      const next = draft.trim() || undefined;
      if (next !== value) onCommit(next);
    },
  };
  return (
    <label className="form-field">
      <span className="rc-label">
        {label}
        {hint && <span className="rc-muted"> · {hint}</span>}
      </span>
      {long ? <textarea rows={3} {...shared} /> : <input type={type} {...shared} />}
      {error && <span className="status-line status-line--error">{error}</span>}
    </label>
  );
}

const validImage = (url: string) => /^https:\/\/\S+$/.test(url);

type PictureMode = "none" | "arachne" | "roster" | "custom";

/** A choice of none, the Arachne picture, or a link of the leader's own. */
function PictureField({
  label,
  mode,
  url,
  offerRoster = false,
  onChange,
}: {
  label: string;
  mode: PictureMode;
  url: string | undefined;
  offerRoster?: boolean;
  onChange: (mode: PictureMode, url: string | undefined) => void;
}) {
  const [custom, setCustom] = useState(mode === "custom");
  const [error, setError] = useState<string>();
  const shown = custom ? "custom" : mode;
  return (
    <div className="form-field">
      <label className="form-field">
        <span className="rc-label">{label}</span>
        <select
          className="field"
          value={shown}
          onChange={(event) => {
            const next = event.target.value as PictureMode;
            setCustom(next === "custom");
            setError(undefined);
            if (next !== "custom") onChange(next, undefined);
          }}
        >
          <option value="none">None</option>
          <option value="arachne">Arachne</option>
          {offerRoster && <option value="roster">Roster image</option>}
          <option value="custom">My own image link</option>
        </select>
      </label>
      {custom && (
        <TextField
          label="Image link"
          hint="https"
          type="url"
          max={500}
          value={url}
          placeholder="https://"
          error={error}
          onCommit={(next) => {
            if (next && !validImage(next)) return setError("The link must start with https://");
            setError(undefined);
            if (next) onChange("custom", next);
          }}
        />
      )}
    </div>
  );
}

/** Everything about the embed a leader can change. All of it is optional. */
export function EmbedDesigner({
  token,
  eventTitle,
  style,
  showBanner,
  showBench,
  onStyle,
  onOptions,
}: {
  token: string;
  eventTitle: string;
  style: EmbedStyle;
  showBanner: boolean;
  showBench: boolean;
  onStyle: (patch: Partial<EmbedStyle>) => void;
  onOptions: (patch: { showBanner?: boolean; showBench?: boolean }) => void;
}) {
  return (
    <section className="panel panel--wide">
      <h2>Embed design</h2>
      <p className="helper">
        Changes show in your Discord preview. Anything left empty uses the default.
      </p>

      <div className="designer-grid">
        <TextField
          label="Heading"
          max={100}
          value={style.heading}
          placeholder="ARACHNE // ROSTER"
          onCommit={(heading) => onStyle({ heading })}
        />
        <TextField
          label="Title"
          max={200}
          value={style.title}
          placeholder={eventTitle}
          onCommit={(title) => onStyle({ title })}
        />
        <div className="designer-full">
          <TextField
            long
            label="Description"
            hint="optional, Discord formatting works"
            max={1000}
            value={style.description}
            placeholder="Orders, map, meeting point."
            onCommit={(description) => onStyle({ description })}
          />
        </div>
        <TextField
          label="Footer"
          max={200}
          value={style.footer}
          placeholder="[RCNE] // WEAVE THE WEB // WAGE THE WAR"
          onCommit={(footer) => onStyle({ footer })}
        />
        <TextField
          label="Bench name"
          max={32}
          value={style.benchName}
          placeholder="Bench"
          onCommit={(benchName) => onStyle({ benchName })}
        />

        <div className="form-field designer-full">
          <span className="rc-label">Sidebar colour</span>
          <div className="swatches">
            <button
              type="button"
              className="swatch swatch--auto"
              aria-pressed={!style.colour}
              title="Red until everyone is placed, then green"
              onClick={() => onStyle({ colour: undefined })}
            >
              Auto
            </button>
            {SWATCHES.map(([name, hex]) => (
              <button
                key={hex}
                type="button"
                className="swatch"
                aria-label={name}
                title={name}
                aria-pressed={style.colour === hex}
                style={{ background: hex }}
                onClick={() => onStyle({ colour: hex })}
              />
            ))}
            <label className="check">
              <input
                type="color"
                className="colour-input"
                aria-label="Any other colour"
                value={style.colour ?? "#e3121e"}
                onChange={(event) => onStyle({ colour: event.target.value })}
              />
              Any colour
            </label>
          </div>
        </div>

        <PictureField
          label="Banner"
          offerRoster
          mode={
            !showBanner
              ? "none"
              : style.bannerImage === "roster"
                ? "roster"
                : style.bannerUrl
                  ? "custom"
                  : "arachne"
          }
          url={style.bannerUrl}
          onChange={(mode, url) => {
            onOptions({ showBanner: mode !== "none" });
            onStyle({ bannerUrl: url, bannerImage: mode === "roster" ? "roster" : undefined });
          }}
        />
        <PictureField
          label="Corner image"
          mode={!style.thumbnail ? "none" : style.thumbnail === "crest" ? "arachne" : "custom"}
          url={style.thumbnail === "crest" ? undefined : style.thumbnail}
          onChange={(mode, url) =>
            onStyle({ thumbnail: mode === "none" ? undefined : mode === "arachne" ? "crest" : url })
          }
        />

        {showBanner && style.bannerImage === "roster" && (
          <div className="designer-grid designer-full">
            <TextField
              label="Image title"
              max={40}
              value={style.imageTitle}
              placeholder="Arachne Roster"
              onCommit={(imageTitle) => onStyle({ imageTitle })}
            />
            <TextField
              label="Opponents"
              hint="optional"
              max={40}
              value={style.opponents}
              placeholder="DAXS + TLL"
              onCommit={(opponents) => onStyle({ opponents })}
            />
            <TextField
              label="Map"
              hint="optional"
              max={40}
              value={style.map}
              placeholder="Ozeti: Default"
              onCommit={(map) => onStyle({ map })}
            />
            <TextField
              label="Faction"
              hint="optional"
              max={40}
              value={style.faction}
              placeholder="Manticore"
              onCommit={(faction) => onStyle({ faction })}
            />
          </div>
        )}

        <div className="form-field">
          <span className="rc-label">Icons</span>
          <div className="actions">
            <span className="icon-choice">
              <EmojiPicker
                token={token}
                label="Pending icon"
                value={style.pendingEmoji}
                placeholder="⏳"
                onChange={(pendingEmoji) => onStyle({ pendingEmoji })}
              />
              Pending
            </span>
            <span className="icon-choice">
              <EmojiPicker
                token={token}
                label="Squad leader icon"
                value={style.leaderEmoji}
                placeholder="👑"
                onChange={(leaderEmoji) => onStyle({ leaderEmoji })}
              />
              Squad leader
            </span>
          </div>
        </div>

        <label className="form-field">
          <span className="rc-label">Squad layout</span>
          <select
            className="field"
            value={style.layout ?? "columns"}
            onChange={(event) => onStyle({ layout: event.target.value as "columns" | "stacked" })}
          >
            <option value="columns">Side by side</option>
            <option value="stacked">One per row</option>
          </select>
        </label>

        <div className="form-field designer-full">
          <label className="check">
            <input
              type="checkbox"
              checked={showBench}
              onChange={(e) => onOptions({ showBench: e.target.checked })}
            />
            Show bench on the posted roster
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={style.showTime !== false}
              onChange={(e) => onStyle({ showTime: e.target.checked ? undefined : false })}
            />
            Show the start time
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={style.showProgress !== false}
              onChange={(e) => onStyle({ showProgress: e.target.checked ? undefined : false })}
            />
            Show the confirmation bar
          </label>
        </div>
      </div>
    </section>
  );
}
