import {
  DndContext,
  DragOverlay,
  KeyboardCode,
  KeyboardSensor,
  MouseSensor,
  rectIntersection,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import {
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { EmojiPicker, type Emoji } from "./EmojiPicker";
import { membersOf, squadOf, squadSize, UNASSIGNED } from "./board";
import type { Placement } from "./board";

export interface SystemSquad {
  name: string;
  type: string;
}

interface BoardProps {
  players: { displayName: string }[];
  placement: Placement;
  token: string;
  squadNames: string[];
  squadEmojis: (Emoji | null)[];
  maxSquads: number;
  systemSquads: readonly SystemSquad[];
  locked: boolean;
  onMove: (player: number, squad: number) => void;
  onLeader: (player: number, lead: boolean) => void;
  /** Players other editors are dragging, with their names. */
  draggingBy: ReadonlyMap<number, string>;
  /** Tells the others which player this page is dragging, or none. */
  onDragging: (player: number | null) => void;
  onSquadName: (squad: number, name: string) => void;
  onSquadEmoji: (squad: number, emoji: Emoji | undefined) => void;
  onAddSquad: () => void;
  onRemoveSquad: (squad: number) => void;
}

const icons = {
  grip: (
    <>
      <circle cx="9" cy="12" r="1" />
      <circle cx="9" cy="5" r="1" />
      <circle cx="9" cy="19" r="1" />
      <circle cx="15" cy="12" r="1" />
      <circle cx="15" cy="5" r="1" />
      <circle cx="15" cy="19" r="1" />
    </>
  ),
  crown: (
    <>
      <path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z" />
      <path d="M5 21h14" />
    </>
  ),
  chevron: <path d="m6 9 6 6 6-6" />,
  close: <path d="M18 6 6 18M6 6l12 12" />,
};

function Icon({ name }: { name: keyof typeof icons }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icons[name]}
    </svg>
  );
}

/** Dragging is never the only way: this list does the same with arrow keys, Enter and Escape. */
function MoveMenu({
  name,
  targets,
  onMove,
}: {
  name: string;
  targets: { squad: number; label: string }[];
  onMove: (squad: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    opener.current?.focus();
  }

  function onKeyDown(event: ReactKeyboardEvent) {
    if (event.key === "Escape") return close();
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    items[(at + step + items.length) % items.length]?.focus();
  }

  return (
    <>
      <button
        ref={opener}
        type="button"
        className="rc-btn rc-btn--nav"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Move ${name}`}
        onClick={() => setOpen((current) => !current)}
      >
        Move
      </button>
      {open && (
        <ul
          ref={menu}
          className="move-menu"
          role="menu"
          aria-label={`Move ${name} to`}
          onKeyDown={onKeyDown}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
          }}
        >
          {targets.map((target) => (
            <li key={target.squad} role="none">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onMove(target.squad);
                  close();
                }}
              >
                {target.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function PlayerRow({
  player,
  name,
  isLeader,
  movingBy,
  inSquad,
  locked,
  targets,
  onMove,
  onLeader,
}: {
  player: number;
  name: string;
  isLeader: boolean;
  /** Another editor's name, while they are dragging this player. */
  movingBy: string | undefined;
  inSquad: boolean;
  locked: boolean;
  targets: { squad: number; label: string }[];
  onMove: (squad: number) => void;
  onLeader: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: player,
    disabled: locked,
    data: { name },
  });
  const on = (listeners ?? {}) as Pick<
    HTMLAttributes<HTMLElement>,
    "onKeyDown" | "onMouseDown" | "onTouchStart"
  >;
  const classes = [
    "player",
    locked ? "" : "can-drag",
    isDragging ? "is-dragging" : "",
    movingBy ? "is-moving-elsewhere" : "",
  ];

  return (
    <li
      ref={setNodeRef}
      className={classes.join(" ")}
      onMouseDown={on.onMouseDown}
      onTouchStart={on.onTouchStart}
    >
      <span className="player-name" title={name}>
        {name}
      </span>
      {movingBy && <span className="moving-by">{movingBy} is moving</span>}
      {/* These sit inside the draggable row, and a press on them must not start a drag. */}
      <span
        className="actions"
        style={{ gap: 0, position: "relative" }}
        onMouseDown={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
      >
        {inSquad && (locked ? isLeader : true) && (
          <button
            type="button"
            className="icon-button"
            disabled={locked}
            aria-pressed={isLeader}
            aria-label={isLeader ? `${name} is squad leader` : `Make ${name} squad leader`}
            title={isLeader ? "Squad leader" : "Make squad leader"}
            onClick={onLeader}
          >
            <Icon name="crown" />
          </button>
        )}
        {!locked && <MoveMenu name={name} targets={targets} onMove={onMove} />}
        {!locked && (
          <button
            ref={setActivatorNodeRef}
            type="button"
            className="icon-button grip"
            {...attributes}
            onKeyDown={on.onKeyDown}
            onMouseDown={on.onMouseDown}
            onTouchStart={on.onTouchStart}
            aria-label={`Drag ${name}`}
          >
            <Icon name="grip" />
          </button>
        )}
      </span>
    </li>
  );
}

function SquadCard({
  token,
  emoji,
  canRemove,
  onEmoji,
  onRemove,
  squad,
  name,
  type,
  colour,
  size,
  locked,
  dragging,
  onName,
  children,
}: {
  token: string;
  emoji: Emoji | null | undefined;
  canRemove: boolean;
  onEmoji: (emoji: Emoji | undefined) => void;
  onRemove: () => void;
  squad: number;
  name: string;
  type?: string | undefined;
  colour?: string | undefined;
  size: number;
  locked: boolean;
  dragging: boolean;
  onName: (name: string) => void;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `squad-${squad}`, data: { squad } });
  const [draft, setDraft] = useState(name);
  const [open, setOpen] = useState(false);
  useEffect(() => setDraft(name), [name]);

  // An empty name goes back to the last one, so the autosave never sends an invalid name.
  function commit() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== name) onName(trimmed);
    else setDraft(name);
  }

  const classes = ["squad", open || dragging ? "is-open" : "", isOver ? "drop-target" : ""];
  return (
    <section
      ref={setNodeRef}
      className={classes.join(" ")}
      style={colour ? ({ "--squad": colour } as object) : undefined}
      aria-label={name}
    >
      <div className="squad-head">
        <EmojiPicker
          token={token}
          label={`Icon for ${name}`}
          value={emoji}
          disabled={locked}
          onChange={onEmoji}
        />
        <input
          className="squad-name"
          aria-label={`Name of squad ${squad}`}
          value={draft}
          maxLength={32}
          disabled={locked}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        <span className="squad-count">
          <strong>{size}</strong>
        </span>
        {!locked && canRemove && (
          <button
            type="button"
            className="icon-button squad-remove"
            aria-label={`Remove ${name}`}
            title={
              size > 0
                ? "Remove this squad. Its players return to Unassigned."
                : "Remove this squad"
            }
            onClick={onRemove}
          >
            <Icon name="close" />
          </button>
        )}
        <button
          type="button"
          className="icon-button squad-toggle"
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} ${name}`}
          onClick={() => setOpen((current) => !current)}
        >
          <Icon name="chevron" />
        </button>
        <span className="squad-type">{type ?? " "}</span>
      </div>
      <ul className="squad-body">
        {size === 0 && <li className="squad-empty">No members yet. Drag players here.</li>}
        {children}
      </ul>
    </section>
  );
}

function Unassigned({ size, children }: { size: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `squad-${UNASSIGNED}`,
    data: { squad: UNASSIGNED },
  });
  return (
    <section
      ref={setNodeRef}
      className={isOver ? "unassigned drop-target" : "unassigned"}
      aria-labelledby="unassigned-heading"
    >
      <div className="board-heading">
        <h2 id="unassigned-heading" className="rc-h rc-h3">
          Unassigned
        </h2>
        <span className="count">{size}</span>
      </div>
      {size === 0 ? (
        <p className="helper">Everyone who signed up has a squad.</p>
      ) : (
        <ul className="unassigned-list">{children}</ul>
      )}
    </section>
  );
}

/**
 * The zone under the pointer, measured now: dnd-kit's pointerWithin uses rects from the start of the
 * drag, which miss once the page has scrolled. A keyboard drag has no pointer and goes by position.
 */
const zoneUnderPointer: CollisionDetection = (args) => {
  const { pointerCoordinates: pointer, droppableContainers } = args;
  if (!pointer) return rectIntersection(args);
  for (const container of droppableContainers) {
    const rect = container.node.current?.getBoundingClientRect();
    if (
      rect &&
      pointer.x >= rect.left &&
      pointer.x <= rect.right &&
      pointer.y >= rect.top &&
      pointer.y <= rect.bottom
    ) {
      return [{ id: container.id, data: { droppableContainer: container, value: 0 } }];
    }
  }
  return [];
};

/** The arrow keys jump to the nearest drop zone in that direction, instead of creeping. */
const jumpToZone: KeyboardCoordinateGetter = (
  event,
  { context: { droppableRects, collisionRect } },
) => {
  const directions: Partial<Record<string, [number, number]>> = {
    [KeyboardCode.Right]: [1, 0],
    [KeyboardCode.Left]: [-1, 0],
    [KeyboardCode.Down]: [0, 1],
    [KeyboardCode.Up]: [0, -1],
  };
  const direction = directions[event.code];
  if (!direction || !collisionRect) return undefined;
  event.preventDefault();

  const here = {
    x: collisionRect.left + collisionRect.width / 2,
    y: collisionRect.top + collisionRect.height / 2,
  };
  let best: { x: number; y: number; distance: number } | undefined;
  for (const rect of droppableRects.values()) {
    const x = rect.left + rect.width / 2;
    const y = rect.top + Math.min(rect.height / 2, 40);
    const along = (x - here.x) * direction[0] + (y - here.y) * direction[1];
    if (along <= 1) continue;
    const distance = Math.hypot(x - here.x, y - here.y);
    if (!best || distance < best.distance) best = { x, y, distance };
  }
  return best && { x: best.x - collisionRect.width / 2, y: best.y - collisionRect.height / 2 };
};

const EDGE_PX = 70;
const MAX_SCROLL_PX = 14;

/** While dragging, scrolls the page when the pointer is close to the top or bottom of the window. */
function useEdgeScroll(dragging: boolean) {
  useEffect(() => {
    if (!dragging) return;
    let y: number | undefined;
    let frame = 0;
    const track = (event: MouseEvent | TouchEvent) => {
      y = "touches" in event ? event.touches[0]?.clientY : event.clientY;
    };
    const step = () => {
      if (y !== undefined) {
        const fromTop = EDGE_PX - y;
        const fromBottom = y - (window.innerHeight - EDGE_PX);
        const depth = fromTop > 0 ? -fromTop : fromBottom > 0 ? fromBottom : 0;
        if (depth) window.scrollBy(0, (depth / EDGE_PX) * MAX_SCROLL_PX);
      }
      frame = requestAnimationFrame(step);
    };
    window.addEventListener("mousemove", track);
    window.addEventListener("touchmove", track, { passive: true });
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("mousemove", track);
      window.removeEventListener("touchmove", track);
    };
  }, [dragging]);
}

export function SquadBoard({
  players,
  placement,
  token,
  squadNames,
  squadEmojis,
  maxSquads,
  onSquadEmoji,
  onAddSquad,
  onRemoveSquad,
  systemSquads,
  locked,
  onMove,
  onLeader,
  draggingBy,
  onDragging,
  onSquadName,
}: BoardProps) {
  const [active, setActive] = useState<string | null>(null);
  useEdgeScroll(active !== null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: jumpToZone }),
  );

  const nameOf = (squad: number) => (squad === UNASSIGNED ? "Unassigned" : squadNames[squad - 1]!);
  const squadNumbers = squadNames.map((_, index) => index + 1);

  function move(player: number, squad: number) {
    if (squadOf(placement, player) !== squad) onMove(player, squad);
  }

  function onDragEnd({ active: dragged, over }: DragEndEvent) {
    setActive(null);
    onDragging(null);
    const squad = over?.data.current?.["squad"] as number | undefined;
    if (squad !== undefined) move(Number(dragged.id), squad);
  }

  const zoneName = (id: string | number) => nameOf(Number(String(id).replace("squad-", "")));
  const playerName = (id: string | number) => players[Number(id)]?.displayName ?? "Player";
  const announcements: Announcements = {
    onDragStart: ({ active: a }) => `Picked up ${playerName(a.id)}.`,
    onDragOver: ({ active: a, over }) =>
      over ? `${playerName(a.id)} is over ${zoneName(over.id)}.` : undefined,
    onDragEnd: ({ active: a, over }) =>
      over
        ? `${playerName(a.id)} dropped on ${zoneName(over.id)}.`
        : `${playerName(a.id)} returned.`,
    onDragCancel: ({ active: a }) => `Move cancelled. ${playerName(a.id)} returned.`,
  };

  const row = (player: number) => {
    const current = squadOf(placement, player);
    const name = players[player]!.displayName;
    return (
      <PlayerRow
        key={player}
        player={player}
        name={name}
        isLeader={placement.squadLeaders[String(current)] === player}
        movingBy={draggingBy.get(player)}
        inSquad={current !== UNASSIGNED}
        locked={locked}
        targets={[UNASSIGNED, ...squadNumbers]
          .filter((squad) => squad !== current)
          .map((squad) => ({ squad, label: nameOf(squad) }))}
        onMove={(squad) => move(player, squad)}
        onLeader={() => onLeader(player, placement.squadLeaders[String(current)] !== player)}
      />
    );
  };

  const pool = membersOf(placement, UNASSIGNED, players.length);
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={zoneUnderPointer}
      // Its own scrolling sent a long page flying mid-drag, so useEdgeScroll does this instead.
      autoScroll={false}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            "Press Space to pick up this player, use the arrow keys to choose a squad, then press Space to drop or Escape to cancel.",
        },
      }}
      onDragStart={({ active: dragged }) => {
        setActive(playerName(dragged.id));
        onDragging(Number(dragged.id));
      }}
      onDragCancel={() => {
        setActive(null);
        onDragging(null);
      }}
      onDragEnd={onDragEnd}
    >
      <Unassigned size={pool.length}>{pool.map(row)}</Unassigned>

      <div className="board-heading" style={{ marginTop: 32 }}>
        <h2 className="section-heading">Squads</h2>
        {!locked && squadNames.length < maxSquads && (
          <button type="button" className="rc-btn rc-btn--outline-tactical" onClick={onAddSquad}>
            Add squad
          </button>
        )}
      </div>
      <div className="squad-grid">
        {squadNumbers.map((squad) => {
          const name = squadNames[squad - 1]!;
          const match = systemSquads.find((s) => s.name === name.trim().toUpperCase());
          // A clan squad wears its own colour. Others keep their slot's, and extras the brand red.
          const system = match ?? systemSquads[squad - 1];
          return (
            <SquadCard
              key={squad}
              squad={squad}
              name={name}
              type={match?.type}
              colour={system ? `var(--squad-${system.name.toLowerCase()})` : "var(--primary)"}
              token={token}
              emoji={squadEmojis[squad - 1]}
              canRemove={squadNames.length > 1}
              onEmoji={(emoji) => onSquadEmoji(squad, emoji)}
              onRemove={() => onRemoveSquad(squad)}
              size={squadSize(placement, squad)}
              locked={locked}
              dragging={active !== null}
              onName={(next) => onSquadName(squad, next)}
            >
              {membersOf(placement, squad, players.length).map(row)}
            </SquadCard>
          );
        })}
      </div>

      <DragOverlay dropAnimation={null}>
        {active && (
          <div className="player is-overlay">
            <span className="player-name">{active}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
