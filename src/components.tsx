import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { type Entry, type TabState } from "./api";
import { baseName, dragState, formatDate, formatSize, typeLabel } from "./util";

// ---------- virtualised list (fixed row height) ----------

export function VirtualList(props: {
  count: number;
  rowHeight: number;
  render: (i: number) => ReactNode;
  keyOf: (i: number) => string;
  className?: string;
  onBackgroundContextMenu?: (e: React.MouseEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  /** scrolls just enough to bring this row into view whenever it changes */
  revealIndex?: number | null;
  /** rubber-band selection: called once the drag starts, then with the row range under the rectangle */
  onMarqueeStart?: (additive: boolean) => void;
  onMarquee?: (lo: number, hi: number) => void;
  /** plain click on empty space (no drag) */
  onEmptyClick?: (additive: boolean) => void;
}) {
  const { count, rowHeight, render, keyOf } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [h, setH] = useState(600);
  const [mq, setMq] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  const startMarquee = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!props.onMarquee || !el || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest(".name-text, .ficon, input, button, select")) return; // those start a file drag / their own action
    const rect = el.getBoundingClientRect();
    if (e.clientX > rect.left + el.clientWidth) return; // scrollbar
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    const onRow = !!target.closest(".row");
    const toContent = (cx: number, cy: number) => ({ x: cx - rect.left + el.scrollLeft, y: cy - rect.top + el.scrollTop });
    const p0 = toContent(e.clientX, e.clientY);
    let active = false;
    let lastX = e.clientX;
    let lastY = e.clientY;

    const update = () => {
      const p1 = toContent(lastX, lastY);
      const y0 = Math.min(p0.y, p1.y);
      const y1 = Math.max(p0.y, p1.y);
      setMq({ x0: Math.min(p0.x, p1.x), y0, x1: Math.max(p0.x, p1.x), y1 });
      const lo = Math.max(0, Math.floor(y0 / rowHeight));
      const hi = Math.min(count - 1, Math.floor(y1 / rowHeight));
      props.onMarquee!(lo, hi);
    };
    const move = (m: MouseEvent) => {
      lastX = m.clientX;
      lastY = m.clientY;
      if (!active) {
        if (Math.hypot(m.clientX - e.clientX, m.clientY - e.clientY) < 4) return;
        active = true;
        props.onMarqueeStart?.(additive);
      }
      update();
    };
    // keep scrolling while the pointer rests near the top or bottom edge
    const timer = window.setInterval(() => {
      if (!active) return;
      if (lastY < rect.top + 24) el.scrollTop -= 18;
      else if (lastY > rect.bottom - 24) el.scrollTop += 18;
      else return;
      update();
    }, 30);
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.clearInterval(timer);
      setMq(null);
      if (active) {
        // the mouseup would otherwise click a row and replace the selection we just made
        const swallow = (ev: Event) => ev.stopPropagation();
        window.addEventListener("click", swallow, { capture: true, once: true });
        window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 50);
      } else if (!onRow) {
        props.onEmptyClick?.(additive);
      }
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  useEffect(() => {
    const el = ref.current;
    const i = props.revealIndex;
    if (!el || i == null || i < 0) return;
    const rowTop = i * rowHeight;
    if (rowTop < el.scrollTop) el.scrollTop = rowTop;
    else if (rowTop + rowHeight > el.scrollTop + el.clientHeight) el.scrollTop = rowTop + rowHeight - el.clientHeight;
  }, [props.revealIndex, rowHeight]);

  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    setH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const start = Math.max(0, Math.floor(top / rowHeight) - 4);
  const end = Math.min(count, Math.ceil((top + h) / rowHeight) + 4);
  const items: ReactNode[] = [];
  for (let i = start; i < end; i++) {
    items.push(
      <div
        key={keyOf(i)}
        style={{ position: "absolute", top: i * rowHeight, height: rowHeight, left: 0, right: 0 }}
      >
        {render(i)}
      </div>,
    );
  }
  return (
    <div
      ref={ref}
      className={props.className}
      onScroll={(e) => setTop(e.currentTarget.scrollTop)}
      onContextMenu={props.onBackgroundContextMenu}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
      onMouseDown={startMarquee}
    >
      <div style={{ height: count * rowHeight, position: "relative" }}>
        {items}
        {mq && (
          <div
            className="marquee"
            style={{ left: mq.x0, top: mq.y0, width: Math.max(1, mq.x1 - mq.x0), height: Math.max(1, mq.y1 - mq.y0) }}
          />
        )}
      </div>
    </div>
  );
}

// ---------- file icons ----------

export function FileIcon({ kind }: { kind: string }) {
  return kind === "folder" ? (
    <svg className="ficon ic-folder" viewBox="0 0 16 16" aria-hidden>
      <path d="M1.5 3.5A1 1 0 0 1 2.5 2.5h3.7l1.5 1.6h5.8a1 1 0 0 1 1 1V12.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" fill="currentColor" />
    </svg>
  ) : (
    <svg className={"ficon ic-" + kind} viewBox="0 0 16 16" aria-hidden>
      <path d="M3.5 1.5h5.8L13 5.2v8.3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z" fill="currentColor" opacity=".9" />
      <path d="M9.3 1.5v3a.7.7 0 0 0 .7.7H13" fill="#fff" opacity=".55" />
    </svg>
  );
}

// ---------- breadcrumbs (always keep the current folder visible) ----------

export function Crumbs(props: {
  path: string;
  items: { name: string; path: string }[];
  editToken: number;
  onGo: (path: string) => void;
  onGoNewTab: (path: string) => void;
}) {
  const { items, onGo } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [items, editing]);
  useEffect(() => {
    if (props.editToken > 0) setEditing(true);
  }, [props.editToken]);

  if (editing)
    return (
      <div className="crumbs editing">
        <input
          className="addr"
          autoFocus
          spellCheck={false}
          defaultValue={props.path}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              const v = e.currentTarget.value.trim();
              setEditing(false);
              if (v) onGo(v);
            } else if (e.key === "Escape") setEditing(false);
          }}
          onBlur={() => setEditing(false)}
        />
      </div>
    );

  return (
    <div
      className="crumbs"
      ref={ref}
      title="Click empty space to type a path (Ctrl+L)"
      onClick={(e) => e.target === e.currentTarget && setEditing(true)}
    >
      {items.map((c, i) => (
        <span key={c.path}>
          <button
            className={"crumb" + (i === items.length - 1 ? " last" : "")}
            onClick={() => onGo(c.path)}
            onMouseDown={(e) => e.button === 1 && e.preventDefault()}
            onAuxClick={(e) => e.button === 1 && props.onGoNewTab(c.path)}
          >
            {c.name}
          </button>
          {i < items.length - 1 && <span className="sep">›</span>}
        </span>
      ))}
    </div>
  );
}

// ---------- theme switch ----------

export type Theme = "system" | "light" | "dark";
const NEXT_THEME: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
const THEME_LABEL: Record<Theme, string> = { system: "Auto", light: "Light", dark: "Dark" };

export function ThemeButton({ theme, onChange }: { theme: Theme; onChange: (t: Theme) => void }) {
  const icon =
    theme === "light" ? (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <circle cx="8" cy="8" r="3" />
        <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
      </svg>
    ) : theme === "dark" ? (
      <svg viewBox="0 0 16 16" fill="currentColor">
        <path d="M13.5 9.6A6 6 0 0 1 6.4 2.5a6 6 0 1 0 7.1 7.1z" />
      </svg>
    ) : (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="8" cy="8" r="5.5" />
        <path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" />
      </svg>
    );
  return (
    <button
      className="theme-btn"
      title={`Theme: ${THEME_LABEL[theme]} (click for ${THEME_LABEL[NEXT_THEME[theme]]})`}
      onClick={() => onChange(NEXT_THEME[theme])}
    >
      {icon}
      {THEME_LABEL[theme]}
    </button>
  );
}

// ---------- tabs ----------

export function TabsBar(props: {
  tabs: TabState[];
  active: number;
  onSelect: (i: number) => void;
  onClose: (i: number) => void;
  onNew: () => void;
  onMove: (from: number, to: number) => void;
  right?: ReactNode;
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    stripRef.current?.querySelector(".tab.active")?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [props.active, props.tabs.length]);
  return (
    <div className="tabs">
      <div
        className="tabs-strip"
        ref={stripRef}
        onWheel={(e) => {
          // vertical wheel scrolls the tab strip sideways
          if (stripRef.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) stripRef.current.scrollLeft += e.deltaY;
        }}
      >
      {props.tabs.map((t, i) => {
        const path = t.history[t.idx];
        return (
          <div
            key={t.id}
            className={"tab" + (i === props.active ? " active" : "") + (overIdx === i && dragIdx !== i ? " tab-over" : "")}
            title={path}
            draggable
            onDragStart={(e) => {
              setDragIdx(i);
              e.dataTransfer.setData("application/x-tab", String(i));
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              if (dragIdx === null) return;
              e.preventDefault();
              setOverIdx(i);
            }}
            onDragLeave={() => setOverIdx((o) => (o === i ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIdx !== null && dragIdx !== i) props.onMove(dragIdx, i);
              setDragIdx(null);
              setOverIdx(null);
            }}
            onDragEnd={() => {
              setDragIdx(null);
              setOverIdx(null);
            }}
            onClick={() => props.onSelect(i)}
            onMouseDown={(e) => {
              // stop the browser's middle-click autoscroll so the click below is delivered
              if (e.button === 1) e.preventDefault();
            }}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                props.onClose(i);
              }
            }}
          >
            <span className="tab-title">{baseName(path)}</span>
            {props.tabs.length > 1 && (
              <button
                className="tab-close"
                title="Close tab"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onClose(i);
                }}
              >
                ×
              </button>
            )}
          </div>
        );
      })}
      <button className="tab-new" title="New tab (Ctrl+T)" onClick={props.onNew}>
        +
      </button>
      </div>
      <div className="tabs-spacer" />
      <div className="tabs-right">{props.right}</div>
    </div>
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// ---------- status bar ----------

export interface Details {
  files: number;
  folders: number;
  size: number;
  pending: boolean;
  partial?: boolean;
}

export function StatusBar(props: {
  rows: Entry[];
  selected: Entry[];
  details: Details;
  dragging: boolean;
  onRecycle: () => void;
  onBlackHole: () => void;
  onDropRecycle: () => void;
  onDropBlackHole: () => void;
  right?: ReactNode;
}) {
  const { rows, selected, details } = props;
  const [over, setOver] = useState<"r" | "b" | null>(null);

  let text: ReactNode;
  if (selected.length === 0) {
    const files = rows.filter((r) => !r.isDir);
    const folders = rows.length - files.length;
    text = (
      <>
        {plural(rows.length, "item")} ({plural(folders, "folder")}, {plural(files.length, "file")}) ·{" "}
        {formatSize(files.reduce((a, r) => a + r.size, 0))} in files
      </>
    );
  } else if (selected.length === 1) {
    const e = selected[0];
    text = (
      <>
        <b>{e.name}</b> · {typeLabel(e)} ·{" "}
        {details.pending ? "calculating…" : (details.partial ? "≥ " : "") + formatSize(details.size)} · Modified {formatDate(e.modified)}{" "}
        · Created {formatDate(e.created)}
      </>
    );
  } else {
    text = (
      <>
        <b>
          {plural(details.files, "file")}, {plural(details.folders, "folder")}
        </b>{" "}
        selected · {details.pending ? "calculating…" : (details.partial ? "≥ " : "") + formatSize(details.size)}
      </>
    );
  }

  const zone = (id: "r" | "b", cls: string, label: string, title: string, click: () => void, drop: () => void) => (
    <button
      className={`zone ${cls}${props.dragging ? " active" : ""}${over === id ? " over" : ""}`}
      title={title}
      disabled={selected.length === 0 && !props.dragging}
      onClick={click}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(id);
      }}
      onDragLeave={() => setOver(null)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(null);
        drop();
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="statusbar">
      <div className="status-text">{text}</div>
      <div className="zones">
        {zone("r", "recycle", "♻ Recycle", "Move to recycle bin (Delete). Recoverable.", props.onRecycle, props.onDropRecycle)}
        {zone("b", "blackhole", "⚫ Black hole", "Delete permanently (Shift+Delete). Not recoverable.", props.onBlackHole, props.onDropBlackHole)}
      </div>
      {props.right && (
        <>
          <span className="tb-sep" />
          {props.right}
        </>
      )}
    </div>
  );
}

// ---------- context menu ----------

export interface MenuItem {
  label?: string;
  onClick?: () => void;
  danger?: boolean;
  sep?: boolean;
}
export interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

export function ContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });

  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect();
    setPos({
      x: Math.min(menu.x, window.innerWidth - r.width - 4),
      y: Math.min(menu.y, window.innerHeight - r.height - 4),
    });
  }, [menu]);

  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="menu"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.items.map((it, i) =>
        it.sep ? (
          <div key={i} className="menu-sep" />
        ) : (
          <button
            key={i}
            className={"menu-item" + (it.danger ? " danger" : "")}
            onClick={() => {
              onClose();
              it.onClick?.();
            }}
          >
            {it.label}
          </button>
        ),
      )}
    </div>
  );
}

// ---------- drop onto a pinned folder / project: ask what to do ----------

export function DropChoiceModal(props: {
  names: string[];
  destName: string;
  canPin: boolean;
  onMove: () => void;
  onCopy: () => void;
  onPin: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onCancel();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [props]);
  const what = props.names.length === 1 ? `"${props.names[0]}"` : `${props.names.length} items`;
  return (
    <div className="modal-backdrop" onMouseDown={props.onCancel}>
      <div className="modal neutral" onMouseDown={(e) => e.stopPropagation()}>
        <h3>What should happen?</h3>
        <p>
          You dropped {what} onto <b>{props.destName}</b>.
        </p>
        <ul>
          {props.names.slice(0, 5).map((n) => (
            <li key={n}>{n}</li>
          ))}
          {props.names.length > 5 && <li>…and {props.names.length - 5} more</li>}
        </ul>
        <div className="modal-actions">
          <button autoFocus onClick={props.onCancel}>
            Cancel
          </button>
          {props.canPin && <button onClick={props.onPin}>Pin</button>}
          <button onClick={props.onCopy}>Copy here</button>
          <button className="primary" onClick={props.onMove}>
            Move here
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- permanent-delete confirmation ----------

export function ConfirmModal(props: {
  names: string[];
  total: string;
  onCancel: () => void;
  onConfirm: (dontAskAgain: boolean) => void;
}) {
  const [dontAsk, setDontAsk] = useState(false);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onCancel();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [props]);

  return (
    <div className="modal-backdrop" onMouseDown={props.onCancel}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Delete permanently?</h3>
        <p>
          {props.names.length} item{props.names.length === 1 ? "" : "s"} · {props.total}. This cannot be undone and
          nothing goes to the recycle bin.
        </p>
        <ul>
          {props.names.slice(0, 6).map((n) => (
            <li key={n}>{n}</li>
          ))}
          {props.names.length > 6 && <li>…and {props.names.length - 6} more</li>}
        </ul>
        <label className="check">
          <input type="checkbox" checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} /> Don't ask again
        </label>
        <div className="modal-actions">
          <button onClick={props.onCancel}>Cancel</button>
          <button className="danger" autoFocus onClick={() => props.onConfirm(dontAsk)}>
            Delete permanently
          </button>
        </div>
      </div>
    </div>
  );
}

export function clearDrag() {
  dragState.paths = [];
}
