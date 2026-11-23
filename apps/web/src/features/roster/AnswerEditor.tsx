import { useEffect, useRef, useState } from "react";
import { EmojiPicker, type Emoji } from "./EmojiPicker";

export type { Emoji };

export interface AnswerOption {
  key: string;
  label: string;
  emoji?: Emoji;
}

const MAX_ANSWERS = 5;
const SAVE_DELAY_MS = 600;
type SaveState = "idle" | "saving" | "saved" | "failed";

const newKey = () => Math.random().toString(36).slice(2, 8).padEnd(6, "0");

/**
 * Edits the answer buttons. This whole file, and the emoji list it asks the bot for, is only
 * loaded once the leader chooses to customise the buttons.
 */
export default function AnswerEditor({
  token,
  initial,
  save,
}: {
  token: string;
  initial: AnswerOption[];
  /** Sends the buttons as one change, resolving once the server has them. */
  save: (options: AnswerOption[]) => Promise<void>;
}) {
  const [options, setOptions] = useState(initial);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState("");
  const latest = useRef(options);
  const dirty = useRef(false);
  const saving = useRef(false);
  const changed = useRef(false);

  async function flush() {
    if (saving.current) return;
    saving.current = true;
    try {
      while (dirty.current) {
        dirty.current = false;
        setSaveState("saving");
        await save(latest.current);
      }
      setError("");
      setSaveState("saved");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save");
      setSaveState("failed");
    } finally {
      saving.current = false;
    }
  }

  useEffect(() => {
    latest.current = options;
    if (!changed.current) return;
    dirty.current = true;
    const timer = setTimeout(() => void flush(), SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [options]);

  function update(next: AnswerOption[]) {
    changed.current = true;
    setOptions(next);
  }

  const setOption = (index: number, patch: Partial<AnswerOption>) =>
    update(options.map((o, i) => (i === index ? { ...o, ...patch } : o)));

  function setEmoji(index: number, emoji: Emoji | undefined) {
    update(
      options.map((o, i) =>
        i === index ? { key: o.key, label: o.label, ...(emoji ? { emoji } : {}) } : o,
      ),
    );
  }

  return (
    <>
      <h2>Answer buttons</h2>
      <p className="helper">
        <strong>Button 1 is always the Confirm button.</strong> Players who press it are counted in
        &ldquo;Confirmed N/M&rdquo; on the roster. The other buttons are extra answers: they show
        next to each player but don&rsquo;t count as confirmed. You can have up to {MAX_ANSWERS}.
      </p>
      <ol className="answer-list">
        {options.map((option, index) => {
          return (
            <li key={option.key}>
              <strong>{index === 0 ? "Confirm button" : `Button ${index + 1}`}</strong>{" "}
              <EmojiPicker
                token={token}
                label={`Icon for button ${index + 1}`}
                value={option.emoji}
                placeholder="None"
                onChange={(emoji) => setEmoji(index, emoji)}
              />{" "}
              <input
                className="field"
                aria-label={`Label for button ${index + 1}`}
                value={option.label}
                maxLength={80}
                onChange={(e) => setOption(index, { label: e.target.value })}
              />{" "}
              {index > 0 && (
                <button
                  type="button"
                  className="rc-btn rc-btn--nav"
                  onClick={() => update(options.filter((_, i) => i !== index))}
                >
                  Remove
                </button>
              )}
            </li>
          );
        })}
      </ol>

      {options.length < MAX_ANSWERS && (
        <button
          type="button"
          className="rc-btn rc-btn--outline-tactical"
          onClick={() =>
            update([...options, { key: newKey(), label: "Answer", emoji: { name: "🤔" } }])
          }
        >
          Add button
        </button>
      )}
      <p className="status-line" aria-live="polite">
        {saveState === "saving" && "Saving…"}
        {saveState === "saved" && "Saved. The preview in Discord is updating."}
        {saveState === "failed" && `Could not save: ${error}`}
        {saveState === "idle" && "Changes save automatically."}
      </p>
    </>
  );
}
