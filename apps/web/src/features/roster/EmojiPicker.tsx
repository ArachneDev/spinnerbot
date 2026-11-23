import { useEffect, useRef, useState } from "react";
import { UNICODE_EMOJIS } from "./unicodeEmojis";

export interface Emoji {
  name: string;
  id?: string;
  animated?: boolean;
}

interface EmojiCache {
  loadedAt: string;
  emojis: { id: string; name: string; animated?: boolean }[];
}

const POLL_MS = 1000;
const POLL_TRIES = 15;

const lists = new Map<string, Promise<EmojiCache["emojis"]>>();

/**
 * Asks the bot for the server's emoji. It answers by saving them, so this polls until they appear.
 * Every picker on the page shares one request, made only once someone opens a picker.
 */
export function serverEmojis(token: string): Promise<EmojiCache["emojis"]> {
  let list = lists.get(token);
  if (list) return list;
  const url = `/api/roster/${encodeURIComponent(token)}/emojis`;
  const read = async () =>
    ((await (await fetch(url)).json()) as { cache: EmojiCache | null }).cache;
  list = (async () => {
    let current = await read();
    // Refreshes in the background when what we hold is old, and fetches when we hold nothing.
    await fetch(url, { method: "POST" });
    for (let i = 0; i < POLL_TRIES && !current; i++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      current = await read();
    }
    if (!current) throw new Error("No emoji list");
    return current.emojis;
  })();
  list.catch(() => lists.delete(token));
  lists.set(token, list);
  return list;
}

export function EmojiImage({ emoji }: { emoji: Emoji }) {
  if (!emoji.id) return <span className="emoji-text">{emoji.name}</span>;
  const extension = emoji.animated ? "gif" : "webp";
  return (
    <img
      alt={emoji.name}
      width={22}
      height={22}
      src={`https://cdn.discordapp.com/emojis/${emoji.id}.${extension}?size=48`}
    />
  );
}

/** A button showing the chosen emoji, opening a searchable grid of the server's and standard ones. */
export function EmojiPicker({
  token,
  value,
  label,
  placeholder = "+",
  disabled = false,
  onChange,
}: {
  token: string;
  value: Emoji | null | undefined;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  onChange: (emoji: Emoji | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [server, setServer] = useState<EmojiCache["emojis"] | "loading" | "failed">("loading");
  const opener = useRef<HTMLButtonElement>(null);
  const searchBox = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    searchBox.current?.focus();
    let cancelled = false;
    serverEmojis(token).then(
      (emojis) => !cancelled && setServer(emojis),
      () => !cancelled && setServer("failed"),
    );
    return () => {
      cancelled = true;
    };
  }, [open, token]);

  function choose(emoji: Emoji | undefined) {
    onChange(emoji);
    setOpen(false);
    opener.current?.focus();
  }

  const term = search.trim().toLowerCase().replaceAll(":", "");
  const matching = Array.isArray(server)
    ? server.filter((emoji) => emoji.name.toLowerCase().includes(term))
    : [];

  return (
    <span className="emoji-picker">
      <button
        ref={opener}
        type="button"
        className="emoji-button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${value?.name ?? "none"}`}
        title={label}
        onClick={() => setOpen((current) => !current)}
      >
        {value ? <EmojiImage emoji={value} /> : <span className="helper">{placeholder}</span>}
      </button>
      {open && (
        <div
          className="emoji-panel"
          role="dialog"
          aria-label={label}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setOpen(false);
              opener.current?.focus();
            }
          }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
          }}
        >
          <input
            ref={searchBox}
            className="field"
            aria-label="Search this server's emoji"
            placeholder="Search emoji"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button type="button" className="rc-btn rc-btn--nav" onClick={() => choose(undefined)}>
            Use the default
          </button>
          <p className="rc-label">This server</p>
          {server === "loading" && <p className="helper">Loading the server&rsquo;s emoji…</p>}
          {server === "failed" && (
            <p className="helper">
              Couldn&rsquo;t load the server&rsquo;s emoji. Standard emoji still work.
            </p>
          )}
          {Array.isArray(server) && matching.length === 0 && (
            <p className="helper">No matching emoji.</p>
          )}
          <div className="emoji-grid">
            {matching.map((emoji) => (
              <button
                key={emoji.id}
                type="button"
                title={`:${emoji.name}:`}
                onClick={() =>
                  choose({
                    id: emoji.id,
                    name: emoji.name,
                    ...(emoji.animated ? { animated: true } : {}),
                  })
                }
              >
                <EmojiImage emoji={emoji} />
              </button>
            ))}
          </div>
          {!term && (
            <>
              <p className="rc-label">Standard</p>
              <div className="emoji-grid">
                {UNICODE_EMOJIS.map((emoji) => (
                  <button key={emoji} type="button" onClick={() => choose({ name: emoji })}>
                    <EmojiImage emoji={{ name: emoji }} />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </span>
  );
}
