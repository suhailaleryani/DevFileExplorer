import { useEffect, useMemo, useRef, useState } from "react";
import { type Cleanable, type Entry, deletePaths, dirSize, findCleanable } from "./api";
import { logOp } from "./historyStore";
import { ageLabel, formatSize } from "./util";

interface Item extends Cleanable {
  project: string;
  root: string;
  size?: number;
  partial?: boolean;
}

/** Calls onSeen once, the first time the row scrolls into view: that is what makes size lookups lazy. */
function Row(props: {
  item: Item;
  checked: boolean;
  showProject: boolean;
  onToggle: () => void;
  onSeen: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { item } = props;
  const seen = useRef(props.onSeen);
  seen.current = props.onSeen;
  useEffect(() => {
    const el = ref.current;
    if (!el || item.size !== undefined) return;
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) {
        seen.current();
        io.disconnect();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [item.path, item.size]);
  return (
    <div
      ref={ref}
      className={"cl-row" + (props.checked ? " on" : "") + (props.showProject ? "" : " grouped")}
      onClick={props.onToggle}
      title={item.path}
    >
      <input type="checkbox" checked={props.checked} onChange={props.onToggle} onClick={(e) => e.stopPropagation()} />
      <div className="cl-main">
        {props.showProject && <span className="cl-proj">{item.project}</span>}
        <span className="cl-path">{item.path.slice(item.root.length).replace(/^[\\/]+/, "")}</span>
      </div>
      <span className="cl-kind">{item.kind}</span>
      <span className="cl-age">{item.modified ? ageLabel(item.modified) : ""}</span>
      <span className="cl-size">
        {item.size === undefined ? "…" : (item.partial ? "≥ " : "") + formatSize(item.size)}
      </span>
    </div>
  );
}

export function Cleaner(props: { projects: Entry[]; onClose: () => void; onDone: (msg: string) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [scanned, setScanned] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<"project" | "size">("size");
  const [grouped, setGrouped] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapse = (root: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      n.has(root) ? n.delete(root) : n.add(root);
      return n;
    });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const sizing = useRef(new Set<string>());

  // Scan projects one after another (two at a time), only now that the window is open.
  useEffect(() => {
    alive.current = true;
    let cancelled = false; // per run, so a stale run (React dev double-effect) can never add rows
    setItems([]);
    setScanned(0);
    const queue = [...props.projects];
    const worker = async () => {
      while (queue.length && !cancelled) {
        const p = queue.shift()!;
        try {
          const found = await findCleanable(p.path);
          if (!cancelled && found.length)
            setItems((a) => {
              const have = new Set(a.map((x) => x.path));
              return [...a, ...found.filter((f) => !have.has(f.path)).map((f) => ({ ...f, project: p.name, root: p.path }))];
            });
        } catch {
          /* unreadable project: skip */
        }
        if (!cancelled) setScanned((n) => n + 1);
      }
    };
    void Promise.all([worker(), worker()]);
    return () => {
      cancelled = true;
      alive.current = false;
    };
  }, [props.projects]);

  const measure = (path: string) => {
    if (sizing.current.has(path)) return;
    sizing.current.add(path);
    dirSize(path, { budgetMs: 30000, isStale: () => !alive.current })
      .then((s) => {
        if (alive.current) setItems((a) => a.map((x) => (x.path === path ? { ...x, size: s.size, partial: s.partial } : x)));
      })
      .catch(() => {
        if (alive.current) setItems((a) => a.map((x) => (x.path === path ? { ...x, size: 0 } : x)));
      });
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && !busy && props.onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const shown = useMemo(() => {
    const a = [...items];
    a.sort((x, y) =>
      sort === "size"
        ? (y.size ?? -1) - (x.size ?? -1) || x.project.localeCompare(y.project)
        : x.project.localeCompare(y.project, undefined, { numeric: true }) || x.path.localeCompare(y.path),
    );
    return a;
  }, [items, sort]);

  const groups = useMemo(() => {
    const m = new Map<string, { root: string; name: string; rows: Item[]; size: number; unknown: boolean }>();
    for (const i of shown) {
      let g = m.get(i.root);
      if (!g) m.set(i.root, (g = { root: i.root, name: i.project, rows: [], size: 0, unknown: false }));
      g.rows.push(i);
      g.size += i.size ?? 0;
      if (i.size === undefined) g.unknown = true;
    }
    const a = [...m.values()];
    a.sort((x, y) =>
      sort === "size" ? y.size - x.size || x.name.localeCompare(y.name) : x.name.localeCompare(y.name, undefined, { numeric: true }),
    );
    return a;
  }, [shown, sort]);

  const setMany = (paths: string[], on: boolean) =>
    setPicked((s) => {
      const n = new Set(s);
      paths.forEach((p) => (on ? n.add(p) : n.delete(p)));
      return n;
    });

  const sel = items.filter((i) => picked.has(i.path));
  const selSize = sel.reduce((n, i) => n + (i.size ?? 0), 0);
  const unknown = sel.some((i) => i.size === undefined);
  const total = items.reduce((n, i) => n + (i.size ?? 0), 0);
  const scanning = scanned < props.projects.length;

  const toggle = (p: string) =>
    setPicked((s) => {
      const n = new Set(s);
      n.has(p) ? n.delete(p) : n.add(p);
      return n;
    });

  const doDelete = async () => {
    setBusy(true);
    const paths = sel.map((i) => i.path);
    try {
      const r = await deletePaths(paths, true);
      const failedPaths = new Set(r.failed.map((f) => paths.find((p) => f.startsWith(p)) ?? ""));
      const gone = sel.filter((i) => !failedPaths.has(i.path));
      const freed = gone.reduce((n, i) => n + (i.size ?? 0), 0);
      if (gone.length)
        logOp({
          kind: "cleanup",
          paths: gone.map((i) => i.path),
          isDir: () => true,
          text: `Cleaned up ${gone.length} folder${gone.length === 1 ? "" : "s"}${freed ? `, freed ${formatSize(freed)}` : ""}`,
        });
      if (r.failed.length) logOp({ kind: "cleanup", paths: sel.filter((i) => failedPaths.has(i.path)).map((i) => i.path), isDir: () => true, ok: false, error: r.failed[0], text: "Disk cleanup" });
      setItems((a) => a.filter((i) => !gone.some((g) => g.path === i.path)));
      setPicked(new Set(sel.filter((i) => failedPaths.has(i.path)).map((i) => i.path)));
      props.onDone(
        `Deleted ${gone.length} folder${gone.length === 1 ? "" : "s"}${freed ? `, freed ${formatSize(freed)}` : ""}` +
          (r.failed.length ? `. ${r.failed.length} failed: ${r.failed[0]}` : ""),
      );
    } catch (e) {
      props.onDone(String(e));
    }
    setConfirming(false);
    setBusy(false);
  };

  return (
    <div className="modal-backdrop" onMouseDown={() => !busy && props.onClose()}>
      <div className="modal cleaner" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Free up disk space</h3>
        <p className="cl-sub">
          Folders that can be rebuilt (node_modules, build output, virtual environments).{" "}
          {scanning ? `Scanning projects… ${scanned}/${props.projects.length}` : `${items.length} found`}
          {total ? ` · ${formatSize(total)} measured so far` : ""}
        </p>
        <div className="cl-bar">
          <button onClick={() => setSort(sort === "size" ? "project" : "size")}>
            Sort: {sort === "size" ? "largest first" : "project name"}
          </button>
          <button onClick={() => setGrouped(!grouped)}>Group by project: {grouped ? "on" : "off"}</button>
          {grouped && (
            <button onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(groups.map((g) => g.root)))}>
              {collapsed.size ? "Expand all" : "Collapse all"}
            </button>
          )}
          <button onClick={() => items.forEach((i) => measure(i.path))} disabled={items.every((i) => i.size !== undefined)}>
            Measure all
          </button>
          <button onClick={() => setPicked(new Set(items.map((i) => i.path)))} disabled={!items.length}>
            Select all
          </button>
          <button onClick={() => setPicked(new Set())} disabled={!picked.size}>
            Select none
          </button>
        </div>
        <div className="cl-list">
          {grouped
            ? groups.map((g) => {
                const paths = g.rows.map((r) => r.path);
                const n = paths.filter((p) => picked.has(p)).length;
                return (
                  <div key={g.root} className="cl-group">
                    <div className="cl-ghead" onClick={() => toggleCollapse(g.root)} title={g.root}>
                      <button
                        className="cl-chev"
                        title={collapsed.has(g.root) ? "Expand" : "Collapse"}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleCollapse(g.root);
                        }}
                      >
                        {collapsed.has(g.root) ? "▸" : "▾"}
                      </button>
                      <input
                        type="checkbox"
                        checked={n === paths.length}
                        ref={(el) => {
                          if (el) el.indeterminate = n > 0 && n < paths.length;
                        }}
                        onChange={() => setMany(paths, n < paths.length)}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span className="cl-proj">{g.name}</span>
                      <span className="cl-gcount">
                        {paths.length} folder{paths.length === 1 ? "" : "s"}
                      </span>
                      <span className="cl-size">{g.unknown && !g.size ? "…" : (g.unknown ? "≥ " : "") + formatSize(g.size)}</span>
                    </div>
                    {!collapsed.has(g.root) &&
                      g.rows.map((i) => (
                      <Row
                        key={i.path}
                        item={i}
                        showProject={false}
                        checked={picked.has(i.path)}
                        onToggle={() => toggle(i.path)}
                        onSeen={() => measure(i.path)}
                      />
                    ))}
                  </div>
                );
              })
            : shown.map((i) => (
                <Row
                  key={i.path}
                  item={i}
                  showProject
                  checked={picked.has(i.path)}
                  onToggle={() => toggle(i.path)}
                  onSeen={() => measure(i.path)}
                />
              ))}
          {!scanning && items.length === 0 && <div className="hint">Nothing to clean up.</div>}
        </div>
        <div className="modal-actions cl-actions">
          {confirming ? (
            <>
              <span className="cl-warn">
                Delete {sel.length} folder{sel.length === 1 ? "" : "s"}
                {selSize ? ` (${unknown ? "≥ " : ""}${formatSize(selSize)})` : ""} permanently? No recycle bin.
              </span>
              <button disabled={busy} onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button className="danger" disabled={busy} autoFocus onClick={doDelete}>
                {busy ? "Deleting…" : "Delete permanently"}
              </button>
            </>
          ) : (
            <>
              <span className="cl-selinfo">
                {sel.length ? `${sel.length} selected${selSize ? ` · ${unknown ? "≥ " : ""}${formatSize(selSize)}` : ""}` : ""}
              </span>
              <button onClick={props.onClose}>Close</button>
              <button className="danger" disabled={!sel.length} onClick={() => setConfirming(true)}>
                Delete selected
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
