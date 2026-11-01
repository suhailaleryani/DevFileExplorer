import { useEffect, useMemo, useRef, useState } from "react";
import {
  type HEntry,
  type GroupBy,
  type HKind,
  type Range,
  HISTORY_DAYS,
  KINDS,
  countByKind,
  filterHistory,
  groupHistory,
  pruneHistory,
  timeLabel,
} from "./historyLog.ts";
import { clearHistory, useHistory } from "./historyStore";

const PAGE = 250;

export function HistoryModal(props: {
  onClose: () => void;
  onOpenFolder: (path: string) => void;
  onUndo: (e: HEntry) => Promise<void>;
}) {
  const [undoing, setUndoing] = useState<Set<string>>(new Set());
  const all = useHistory();
  const [q, setQ] = useState("");
  const [kinds, setKinds] = useState<Set<HKind>>(new Set());
  const [range, setRange] = useState<Range>("all");
  const [failedOnly, setFailedOnly] = useState(false);
  const [by, setBy] = useState<GroupBy>("day");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(PAGE);
  const [confirmClear, setConfirmClear] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Entries older than the retention window disappear even while the panel is open.
  const list = useMemo(() => pruneHistory(all), [all]);
  const counts = useMemo(() => countByKind(list), [list]);
  const shown = useMemo(() => filterHistory(list, { q, kinds, range, failedOnly }), [list, q, kinds, range, failedOnly]);
  const groups = useMemo(() => groupHistory(shown, by), [shown, by]);

  const toggleIn = <T,>(set: Set<T>, v: T) => {
    const n = new Set(set);
    n.has(v) ? n.delete(v) : n.add(v);
    return n;
  };
  const filtered = q.trim() !== "" || kinds.size > 0 || range !== "all" || failedOnly;
  const reset = () => {
    setQ("");
    setKinds(new Set());
    setRange("all");
    setFailedOnly(false);
  };

  let budget = limit;
  const kindList = (Object.keys(KINDS) as HKind[]).filter((k) => counts[k]);

  return (
    <div className="modal-backdrop" onMouseDown={props.onClose}>
      <div className="modal hist" onMouseDown={(e) => e.stopPropagation()}>
        <div className="hist-title">
          <h3>History</h3>
          <span className="hist-sub">
            Every change you make in the app is recorded and kept for {HISTORY_DAYS} days, then removed automatically.
          </span>
        </div>

        <div className="hist-bar">
          <input
            ref={searchRef}
            className="hist-search"
            placeholder="Search name, path, action…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setLimit(PAGE);
            }}
          />
          <select value={range} onChange={(e) => setRange(e.target.value as Range)} title="Time range">
            <option value="all">All {HISTORY_DAYS} days</option>
            <option value="today">Today</option>
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
          </select>
          <select value={by} onChange={(e) => setBy(e.target.value as GroupBy)} title="Group by">
            <option value="day">Group by day</option>
            <option value="kind">Group by type</option>
            <option value="folder">Group by folder</option>
            <option value="none">No grouping</option>
          </select>
          <label className="hist-check">
            <input type="checkbox" checked={failedOnly} onChange={(e) => setFailedOnly(e.target.checked)} />
            Failed only
          </label>
        </div>

        <div className="hist-chips">
          {kindList.length === 0 && <span className="hist-dim">No operations recorded yet.</span>}
          {kindList.map((k) => (
            <button
              key={k}
              className={`hist-chip${kinds.has(k) ? " on" : ""}`}
              onClick={() => setKinds((s) => toggleIn(s, k))}
              title={`Show only: ${KINDS[k].label}`}
            >
              <span>{KINDS[k].icon}</span> {KINDS[k].label} <b>{counts[k]}</b>
            </button>
          ))}
          {filtered && (
            <button className="hist-chip clear" onClick={reset}>
              Clear filters
            </button>
          )}
        </div>

        <div className="hist-body">
          {groups.length === 0 && (
            <div className="hist-empty">{list.length === 0 ? "Nothing here yet. Create, move, rename or delete something." : "No operations match the filters."}</div>
          )}
          {groups.map((g) => {
            if (budget <= 0) return null;
            const isCollapsed = by !== "none" && collapsed.has(g.key);
            const rows = isCollapsed ? [] : g.entries.slice(0, budget);
            budget -= rows.length;
            return (
              <div key={g.key} className="hist-group">
                {by !== "none" && (
                  <button className="hist-gh" onClick={() => setCollapsed((s) => toggleIn(s, g.key))}>
                    <span className="hist-caret">{isCollapsed ? "▸" : "▾"}</span>
                    <span className="hist-gl" title={g.label}>
                      {g.label}
                    </span>
                    <span className="hist-gc">{g.entries.length}</span>
                  </button>
                )}
                {rows.map((e) => {
                  const isOpen = open.has(e.id);
                  return (
                    <div key={e.id} className={`hist-row${e.ok ? "" : " bad"}${isOpen ? " open" : ""}`}>
                      <div className="hist-main" onClick={() => setOpen((s) => toggleIn(s, e.id))}>
                        <span className={`hist-ico k-${KINDS[e.kind].group}`}>{KINDS[e.kind].icon}</span>
                        <span className="hist-sum" title={e.summary}>
                          {e.summary}
                        </span>
                        {by !== "folder" && e.folder && <span className="hist-where" title={e.folder}>{e.folder}</span>}
                        <span className="hist-time" title={new Date(e.ts).toLocaleString()}>
                          {timeLabel(e.ts)}
                        </span>
                        {e.undone && <span className="hist-undone">restored</span>}
                        {e.kind === "delete" && e.ok && !e.undone && (
                          <button
                            className="hist-undo"
                            disabled={undoing.has(e.id)}
                            title="Put back from the Recycle Bin"
                            onClick={async (ev) => {
                              ev.stopPropagation();
                              setUndoing((s) => new Set(s).add(e.id));
                              await props.onUndo(e);
                              setUndoing((s) => {
                                const n = new Set(s);
                                n.delete(e.id);
                                return n;
                              });
                            }}
                          >
                            {undoing.has(e.id) ? "Restoring…" : "Undo"}
                          </button>
                        )}
                        {e.folder && (
                          <button
                            className="hist-go"
                            title={`Open ${e.folder}`}
                            onClick={(ev) => {
                              ev.stopPropagation();
                              props.onOpenFolder(e.folder);
                            }}
                          >
                            Open
                          </button>
                        )}
                      </div>
                      {isOpen && (
                        <div className="hist-detail">
                          <div className="hist-dline">
                            <span>When</span> {new Date(e.ts).toLocaleString()}
                          </div>
                          <div className="hist-dline">
                            <span>Type</span> {KINDS[e.kind].label}
                            {e.ok ? "" : " (failed)"}
                          </div>
                          {e.error && (
                            <div className="hist-dline err">
                              <span>Error</span> {e.error}
                            </div>
                          )}
                          <div className="hist-dline">
                            <span>{e.items.length === 1 ? "Item" : `Items (${e.items.length})`}</span>
                          </div>
                          <ul className="hist-paths">
                            {e.items.slice(0, 50).map((i) => (
                              <li key={i.path} title={i.path}>
                                {i.isDir ? "📁 " : "📄 "}
                                {i.path}
                              </li>
                            ))}
                            {e.items.length > 50 && <li className="hist-dim">… and {e.items.length - 50} more</li>}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
          {shown.length > limit && (
            <button className="hist-more" onClick={() => setLimit((l) => l + PAGE)}>
              Show more ({shown.length - limit} left)
            </button>
          )}
        </div>

        <div className="hist-foot">
          <span className="hist-dim">
            {filtered ? `${shown.length} of ${list.length}` : list.length} operation{list.length === 1 ? "" : "s"}
          </span>
          <span className="hist-spacer" />
          {confirmClear ? (
            <>
              <span>Delete the whole history?</span>
              <button
                className="danger"
                onClick={() => {
                  clearHistory();
                  setConfirmClear(false);
                }}
              >
                Yes, clear it
              </button>
              <button onClick={() => setConfirmClear(false)}>Cancel</button>
            </>
          ) : (
            <button disabled={list.length === 0} onClick={() => setConfirmClear(true)}>
              Clear history…
            </button>
          )}
          <button onClick={props.onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
