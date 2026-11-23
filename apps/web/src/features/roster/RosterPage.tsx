import { lazy, Suspense, useState } from "react";
import { PageHeader, Ticker } from "../../components/PageHeader";
import type { AnswerOption } from "./AnswerEditor";
import { squadSize } from "./board";
import { EmbedDesigner, type EmbedStyle } from "./EmbedDesigner";
import { SquadBoard, type SystemSquad } from "./SquadBoard";
import { useRosterSync, type BoardState, type Editor, type Loaded, type RosterOp } from "./sync";

// Not loaded until the leader opens it, along with the emoji list it needs.
const AnswerEditor = lazy(() => import("./AnswerEditor"));

interface Player {
  displayName: string;
}

interface RosterData extends Loaded {
  event: {
    title: string;
    startsAt?: string;
    complete: boolean;
    responses: { accepted: Player[]; declined: Player[]; tentative: Player[] };
  };
  answerOptions: AnswerOption[];
  embedStyle: EmbedStyle;
  defaultSquadNames: string[];
  defaultEmbedStyle: EmbedStyle;
  maxSquads: number;
  systemSquads: SystemSquad[];
}

type DefaultState = "idle" | "saving" | "saved" | "failed";

const api = (token: string, path = "") => `/api/roster/${encodeURIComponent(token)}${path}`;
/** Key order doesn't matter, and a key left undefined is the same as one left out. */
const canonical = (value: unknown) =>
  JSON.stringify(value, (_, part: unknown) =>
    part && typeof part === "object" && !Array.isArray(part)
      ? Object.fromEntries(Object.entries(part).sort(([a], [b]) => a.localeCompare(b)))
      : part,
  );
const names = (players: Player[]) => players.map((p) => p.displayName).join(", ");

function Message({ title, children }: { title: string; children: string }) {
  return (
    <PageHeader kicker="Roster" title={title}>
      {children}
    </PageHeader>
  );
}

/** Who else is on this link right now, and the name this page shows to them. */
function Editors({
  editors,
  name,
  live,
  onName,
}: {
  editors: Editor[];
  name: string;
  live: boolean;
  onName: (name: string) => void;
}) {
  const [draft, setDraft] = useState(name);
  return (
    <div className="editors">
      <label className="helper editors-name">
        Your name
        <input
          className="field"
          value={draft}
          maxLength={32}
          placeholder="Editor"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => draft !== name && onName(draft)}
          onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
        />
      </label>
      <span className="helper" role="status">
        {!live
          ? "Live updates paused. Checking for changes every few seconds."
          : editors.length === 0
            ? "Only you are editing."
            : `Also editing: ${editors.map((e) => e.name).join(", ")}`}
      </span>
    </div>
  );
}

export function RosterPage({ token }: { token: string }) {
  const sync = useRosterSync<RosterData>(token);
  const { data, board, saveState, change } = sync;
  const [savedDefault, setSavedDefault] = useState<string>();
  const [defaultState, setDefaultState] = useState<DefaultState>("idle");
  const [editingButtons, setEditingButtons] = useState(false);

  async function saveDefault({ squadNames, embedStyle }: BoardState) {
    setDefaultState("saving");
    try {
      const response = await fetch(api(token, "/default-squad-names"), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ squadNames, embedStyle }),
      });
      if (!response.ok) throw new Error(String(response.status));
      setSavedDefault(canonical([squadNames, embedStyle]));
      setDefaultState("saved");
    } catch {
      setDefaultState("failed");
    }
  }

  if (data === undefined) {
    return (
      <div className="rc-container page-section">
        <p className="loading" role="status">
          Loading signups
        </p>
      </div>
    );
  }
  if (data === "missing") {
    return (
      <Message title="Trail gone cold">
        This link has expired or the roster was cancelled. Run /build-roster again in Discord.
      </Message>
    );
  }
  if (data === "failed" || !board) {
    return (
      <Message title="Line down">
        The roster could not be loaded. Reload the page to try again.
      </Message>
    );
  }

  const { event, status } = data;
  const { accepted, declined, tentative } = event.responses;
  const locked = status === "posted";
  const placed = board.squadNames.reduce(
    (total, _, index) => total + squadSize(board, index + 1),
    0,
  );
  const style = board.embedStyle as EmbedStyle;
  const squadEmojis = board.squadNames.map((_, i) => style.squadEmojis?.[i] ?? null);
  // Each field is its own change, so two people editing different fields don't undo each other.
  const setStyle = (patch: Partial<EmbedStyle>) => {
    for (const [field, value] of Object.entries(patch)) {
      void change({ type: "style", field, value: value ?? null } as RosterOp);
    }
  };
  const draggingBy = new Map(
    sync.editors.flatMap((e) => (e.dragging === null ? [] : [[e.dragging, e.name] as const])),
  );
  const defaultNow = savedDefault ?? canonical([data.defaultSquadNames, data.defaultEmbedStyle]);
  const startsAt = event.startsAt && new Date(event.startsAt).toLocaleString();

  return (
    <>
      <Ticker
        items={[
          ...(startsAt ? ([["Starts", startsAt]] as [string, string][]) : []),
          ["Accepted", String(accepted.length)],
          ["Declined", String(declined.length)],
          ["Tentative", String(tentative.length)],
        ]}
      />
      <PageHeader
        event
        kicker="Roster // Deployment"
        title={event.title}
        sub="Assign the pack // Post the order"
      >
        Drag each player into a squad. Changes save on their own and show in your Discord preview.
      </PageHeader>

      <div className="rc-container page-section">
        <div className="status-bar">
          {locked ? (
            <p className="status-line">
              This roster is posted. Press Manage under it in Discord, then Edit roster, to change
              it.
            </p>
          ) : saveState === "failed" ? (
            <p className="status-line status-line--error" role="alert">
              Could not save.
              <button
                type="button"
                className="rc-btn rc-btn--outline-tactical"
                onClick={sync.retry}
              >
                Retry
              </button>
            </p>
          ) : (
            <p className="status-line" role="status">
              {saveState === "saving" && "Saving…"}
              {saveState === "saved" && "Saved. The Discord preview is updating."}
              {saveState === "idle" && "Changes save automatically."}
              {sync.error && ` ${sync.error}.`}
            </p>
          )}
          <span className="count">
            {placed} of {accepted.length} placed
          </span>
        </div>
        {!locked && (
          <Editors editors={sync.editors} name={sync.name} live={sync.live} onName={sync.setName} />
        )}
        {!event.complete && (
          <p className="status-line status-line--error" style={{ marginTop: 12 }}>
            Warning: the sign-up lists may be incomplete.
          </p>
        )}

        <div style={{ marginTop: 24 }}>
          <SquadBoard
            players={accepted}
            placement={board}
            token={token}
            squadNames={board.squadNames}
            squadEmojis={squadEmojis}
            maxSquads={data.maxSquads}
            draggingBy={draggingBy}
            onDragging={sync.setDragging}
            onSquadEmoji={(squad, emoji) =>
              void change({ type: "squadEmoji", squad, emoji: emoji ?? null })
            }
            onAddSquad={() => {
              const taken = new Set(board.squadNames);
              let number = board.squadNames.length + 1;
              while (taken.has(`Squad ${number}`)) number++;
              void change({ type: "addSquad", name: `Squad ${number}` });
            }}
            onRemoveSquad={(squad) => void change({ type: "removeSquad", squad })}
            systemSquads={data.systemSquads}
            locked={locked}
            onMove={(player, squad) => void change({ type: "move", player, squad })}
            onLeader={(player, lead) => void change({ type: "leader", player, lead })}
            onSquadName={(squad, name) => void change({ type: "rename", squad, name })}
          />
        </div>

        <div className="panels">
          {!locked && (
            <EmbedDesigner
              token={token}
              eventTitle={event.title}
              style={style}
              showBanner={board.showBanner}
              showBench={board.showBench}
              onStyle={setStyle}
              onOptions={(options) => {
                for (const field of ["showBanner", "showBench"] as const) {
                  const value = options[field];
                  if (value !== undefined) void change({ type: "toggle", field, value });
                }
              }}
            />
          )}

          {!locked && (
            <section className="panel">
              <h2>Server default</h2>
              <p className="helper">
                New rosters on this server start with these squads and this embed design.
              </p>
              <div className="actions">
                <button
                  type="button"
                  className="rc-btn rc-btn--outline-tactical"
                  disabled={
                    defaultState === "saving" ||
                    canonical([board.squadNames, board.embedStyle]) === defaultNow
                  }
                  onClick={() => void saveDefault(board)}
                >
                  Save as server default
                </button>
                <span className="helper" role="status">
                  {defaultState === "saved" && "Saved."}
                  {defaultState === "failed" && "Could not save the default. Try again."}
                </span>
              </div>
            </section>
          )}

          <section className="panel">
            <h2>Not deploying</h2>
            <p className="rc-label">Declined // {declined.length}</p>
            <p className="helper">{names(declined) || "None"}</p>
            <p className="rc-label">Tentative // {tentative.length}</p>
            <p className="helper">{names(tentative) || "None"}</p>
          </section>

          {!locked && (
            <section className="panel">
              {editingButtons ? (
                <Suspense fallback={<p className="loading">Loading</p>}>
                  <AnswerEditor
                    token={token}
                    initial={board.answerOptions as AnswerOption[]}
                    save={(options) => change({ type: "answers", options })}
                  />
                </Suspense>
              ) : (
                <>
                  <h2>Answer buttons</h2>
                  <p className="helper">{board.answerOptions.map((o) => o.label).join(" · ")}</p>
                  <div className="actions">
                    <button
                      type="button"
                      className="rc-btn rc-btn--outline-tactical"
                      onClick={() => setEditingButtons(true)}
                    >
                      Customise answer buttons
                    </button>
                  </div>
                </>
              )}
            </section>
          )}
        </div>
      </div>
    </>
  );
}
