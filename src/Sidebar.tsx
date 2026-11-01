import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type Entry,
  type GitInfo,
  type ProjectInfo,
  type ProjectMeta,
  type Status,
  STATUSES,
  gitInfo,
  listDir,
  projectInfo,
  projectStack,
} from "./api";
import { attentionReasons, totalWeight } from "./attention";
import { STACKS, stackLabel } from "./stacks";
import { VirtualList } from "./components";
import { ageClass, baseName, ageLabel, dragState, formatDate } from "./util";

export function useProjects(root: string | null, ignore: string[], gitOk: boolean | null, version: number, listVersion = 0) {
  const [list, setList] = useState<Entry[]>([]);
  const [info, setInfo] = useState<Record<string, ProjectInfo>>({});
  const [git, setGit] = useState<Record<string, GitInfo | null>>({});
  const [stacks, setStacks] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (!root || gitOk === null) {
      setList([]);
      return;
    }
    let cancelled = false;
    (async () => {
      let entries: Entry[] = [];
      try {
        entries = (await listDir(root)).filter((x) => x.isDir && !x.name.startsWith("."));
      } catch {
        /* unreadable root: show empty list */
      }
      if (cancelled) return;
      setList(entries);
      // Fill in badges in the background with a small worker pool.
      const queue = [...entries];
      const worker = async () => {
        while (queue.length && !cancelled) {
          const p = queue.shift()!;
          try {
            const pi = await projectInfo(p.path, ignore);
            if (!cancelled) setInfo((m) => ({ ...m, [p.path]: pi }));
          } catch {
            if (!cancelled) setInfo((m) => ({ ...m, [p.path]: { folderModified: 0, contentModified: 0 } }));
          }
          try {
            const st = await projectStack(p.path);
            if (!cancelled) setStacks((m) => ({ ...m, [p.path]: st }));
          } catch {
            /* ignore */
          }
          if (gitOk) {
            try {
              const g = await gitInfo(p.path);
              if (!cancelled) setGit((m) => ({ ...m, [p.path]: g }));
            } catch {
              /* ignore */
            }
          }
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
    })();
    return () => {
      cancelled = true;
    };
  }, [root, ignore, gitOk, version]);

  // Light refresh (window focus, F5, any file operation): re-list the root and load badges only for folders that are new.
  const firstLight = useRef(true);
  const listRef = useRef<Entry[]>([]);
  listRef.current = list;
  useEffect(() => {
    if (firstLight.current) {
      firstLight.current = false;
      return;
    }
    if (!root || gitOk === null) return;
    let cancelled = false;
    (async () => {
      let entries: Entry[];
      try {
        entries = (await listDir(root)).filter((x) => x.isDir && !x.name.startsWith("."));
      } catch {
        return;
      }
      if (cancelled) return;
      const oldPaths = new Set(listRef.current.map((x) => x.path));
      const added = entries.filter((x) => !oldPaths.has(x.path));
      if (added.length || entries.length !== oldPaths.size) setList(entries);
      for (const p of entries) {
        if (cancelled) return;
        if (!added.some((a) => a.path === p.path)) continue;
        try {
          const pi = await projectInfo(p.path, ignore);
          if (!cancelled) setInfo((m) => ({ ...m, [p.path]: pi }));
        } catch {
          /* ignore */
        }
        try {
          const st = await projectStack(p.path);
          if (!cancelled) setStacks((m) => ({ ...m, [p.path]: st }));
        } catch {
          /* ignore */
        }
        if (gitOk) {
          try {
            const g = await gitInfo(p.path);
            if (!cancelled) setGit((m) => ({ ...m, [p.path]: g }));
          } catch {
            /* ignore */
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listVersion]);

  const refreshGit = useCallback(async (path: string) => {
    try {
      const g = await gitInfo(path);
      setGit((m) => ({ ...m, [path]: g }));
    } catch {
      /* ignore */
    }
  }, []);

  return { list, info, git, stacks, refreshGit };
}

/** Card data for pinned folders that are not direct children of the projects folder; loaded one at a time, only when pinned. */
function usePinData(pins: string[], ignore: string[], gitOk: boolean | null, known: Record<string, ProjectInfo>, version: number) {
  const [info, setInfo] = useState<Record<string, ProjectInfo>>({});
  const [git, setGit] = useState<Record<string, GitInfo | null>>({});
  const [stacks, setStacks] = useState<Record<string, string[]>>({});
  const key = pins.join("|");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const p of pins) {
        if (cancelled) return;
        if (known[p]) continue;
        try {
          const pi = await projectInfo(p, ignore);
          if (!cancelled) setInfo((m) => ({ ...m, [p]: pi }));
        } catch {
          if (!cancelled) setInfo((m) => ({ ...m, [p]: { folderModified: 0, contentModified: 0 } }));
        }
        try {
          const st = await projectStack(p);
          if (!cancelled) setStacks((m) => ({ ...m, [p]: st }));
        } catch {
          /* ignore */
        }
        if (gitOk) {
          try {
            const g = await gitInfo(p);
            if (!cancelled) setGit((m) => ({ ...m, [p]: g }));
          } catch {
            /* ignore */
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, gitOk, ignore, Object.keys(known).length > 0, version]);
  return { info, git, stacks };
}

const gitOk = (p: { gitOk: boolean | null }) => p.gitOk === true;

type ProjSort = "name" | "folderNew" | "contentNew" | "contentOld" | "status";

export function Sidebar(props: {
  cwd: string;
  width: number;
  root: string | null;
  pins: string[];
  pinVersion: number;
  meta: Record<string, ProjectMeta>;
  thresholds: [number, number, number];
  ignore: string[];
  projects: ReturnType<typeof useProjects>;
  gitOk: boolean | null;
  gitBannerDismissed: boolean;
  onOpen: (path: string) => void;
  onOpenNewTab: (path: string) => void;
  onChooseRoot: () => void;
  onCleanup: () => void;
  onSearch: () => void;
  onFetchAll: () => void;
  onScripts: (ev: React.MouseEvent, path: string) => void;
  onUnpin: (path: string) => void;
  onReorderPins: (path: string, before: string | null) => void;
  onPinContextMenu: (ev: React.MouseEvent, path: string) => void;
  onPinDropped: (paths: string[]) => void;
  onMeta: (path: string, patch: ProjectMeta) => void;
  onDropInto: (dest: string, ev: React.DragEvent) => void;
  onContextMenu: (ev: React.MouseEvent, path: string) => void;
  onDismissGit: () => void;
  onInstallGit: () => void;
}) {
  const { list, info, git, stacks } = props.projects;
  const pinData = usePinData(props.pins, props.ignore, props.gitOk, info, props.pinVersion);
  const [q, setQ] = useState("");
  const [attnOnly, setAttnOnly] = useState(false);
  const [stackFilter, setStackFilter] = useState("all");
  const [sort, setSort] = useState<ProjSort>("name");
  const [filter, setFilter] = useState<Status | "all" | "none">("all");
  const [dropPath, setDropPath] = useState<string | null>(null);
  const [pinOver, setPinOver] = useState(false);
  const [editNote, setEditNote] = useState<string | null>(null);
  const [pinInsert, setPinInsert] = useState<{ path: string; after: boolean } | null>(null);

  // A drag can end anywhere (drop on a pin, cancelled, outside the window): never leave highlights stuck.
  useEffect(() => {
    const reset = () => {
      setPinOver(false);
      setDropPath(null);
      setPinInsert(null);
    };
    window.addEventListener("dragend", reset);
    window.addEventListener("drop", reset);
    return () => {
      window.removeEventListener("dragend", reset);
      window.removeEventListener("drop", reset);
    };
  }, []);
  const cancelNote = useRef(false);

  const reasonsOf = (path: string) =>
    attentionReasons(git[path], info[path], props.meta[path]?.status, props.thresholds[2]);
  const attnCount = list.filter((p) => reasonsOf(p.path).length > 0).length;

  const view = useMemo(() => {
    const ql = q.toLowerCase();
    let a = list.filter((p) => p.name.toLowerCase().includes(ql));
    if (filter !== "all") a = a.filter((p) => (props.meta[p.path]?.status ?? "none") === filter);
    if (stackFilter !== "all") a = a.filter((p) => stacks[p.path]?.includes(stackFilter));
    if (attnOnly) a = a.filter((p) => reasonsOf(p.path).length > 0);
    const order = (s?: Status) => (s ? STATUSES.findIndex((x) => x.id === s) : 99);
    const content = (p: Entry) => info[p.path]?.contentModified ?? 0;
    a = [...a].sort((x, y) => {
      if (attnOnly) {
        const d = totalWeight(reasonsOf(y.path)) - totalWeight(reasonsOf(x.path));
        if (d) return d;
      }
      switch (sort) {
        case "folderNew":
          return y.modified - x.modified;
        case "contentNew":
          return content(y) - content(x);
        case "contentOld":
          return (content(x) || Infinity) - (content(y) || Infinity);
        case "status":
          return order(props.meta[x.path]?.status) - order(props.meta[y.path]?.status) || x.name.localeCompare(y.name);
        default:
          return x.name.localeCompare(y.name, undefined, { numeric: true, sensitivity: "base" });
      }
    });
    return a;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, info, git, stacks, q, sort, filter, attnOnly, stackFilter, props.meta, props.thresholds]);

  const stackCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of list) for (const s of stacks[p.path] ?? []) c[s] = (c[s] ?? 0) + 1;
    return c;
  }, [list, stacks]);

  const t = props.thresholds;

  return (
    <aside className="sidebar" style={{ width: props.width, minWidth: props.width }}>
      <div
        className={"pinzone" + (pinOver ? " over" : "")}
        onDragOver={(e) => {
          if ((e.target as HTMLElement).closest(".pin")) return; // pins handle their own drags
          if (dragState.pin) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            return;
          }
          if (!dragState.paths.length) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setPinOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPinOver(false);
        }}
        onDrop={(e) => {
          setPinOver(false);
          if ((e.target as HTMLElement).closest(".pin")) return;
          e.preventDefault();
          if (dragState.pin) {
            props.onReorderPins(dragState.pin, null); // dropped on empty space: send to the end
            dragState.pin = null;
            setPinInsert(null);
            return;
          }
          props.onPinDropped(dragState.paths);
          dragState.paths = [];
        }}
      >
      <div className="side-head">Pinned{pinOver ? " — drop to pin" : ""}</div>
      <div className="pins">
        {props.pins.length === 0 && <div className="hint">Drag a folder here to pin it</div>}
        {props.pins.map((p, idx) => (
          <div
            key={p}
            className={
              "pin" +
              (props.cwd === p ? " active" : "") +
              (dropPath === p ? " drop" : "") +
              (pinInsert?.path === p ? (pinInsert.after ? " ins-after" : " ins-before") : "")
            }
            title={p}
            draggable
            onClick={() => props.onOpen(p)}
            onAuxClick={(e) => e.button === 1 && props.onOpenNewTab(p)}
            onContextMenu={(e) => {
              e.preventDefault();
              props.onPinContextMenu(e, p);
            }}
            onDragStart={(e) => {
              dragState.pin = p;
              dragState.paths = [];
              e.dataTransfer.setData("text/plain", p);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragEnd={() => {
              dragState.pin = null;
              setPinInsert(null);
              setDropPath(null);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragState.pin) {
                if (dragState.pin === p) return;
                e.dataTransfer.dropEffect = "move";
                const r = e.currentTarget.getBoundingClientRect();
                const after = e.clientY > r.top + r.height / 2;
                if (pinInsert?.path !== p || pinInsert.after !== after) setPinInsert({ path: p, after });
              } else {
                setDropPath(p);
              }
            }}
            onDragLeave={() => {
              setDropPath((d) => (d === p ? null : d));
              setPinInsert((i) => (i?.path === p ? null : i));
            }}
            onDrop={(e) => {
              e.stopPropagation();
              setDropPath(null);
              setPinOver(false);
              if (dragState.pin) {
                e.preventDefault();
                const from = dragState.pin;
                const after = pinInsert?.path === p ? pinInsert.after : false;
                dragState.pin = null;
                setPinInsert(null);
                if (from !== p) props.onReorderPins(from, after ? (props.pins[idx + 1] ?? null) : p);
              } else {
                props.onDropInto(p, e);
              }
            }}
          >
            {(() => {
              const pi = info[p] ?? pinData.info[p];
              const g = git[p] ?? pinData.git[p];
              const st = stacks[p] ?? pinData.stacks[p] ?? [];
              const m = props.meta[p] ?? {};
              return (
                <>
                  <div className="proj-top">
                    <span
                      className={"dot " + ageClass(pi?.contentModified ?? 0, props.thresholds)}
                      title={`Content changed ${formatDate(pi?.contentModified ?? 0)}`}
                    />
                    <span className="proj-name" title={p}>
                      {baseName(p)}
                    </span>
                    <select
                      className={"status s-" + (m.status ?? "none")}
                      value={m.status ?? ""}
                      title="Project status"
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => props.onMeta(p, { status: (e.target.value || undefined) as Status | undefined })}
                    >
                      <option value="">+ tag</option>
                      {STATUSES.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                    <button
                      className="x run"
                      title="Run a script (npm, cargo)"
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onScripts(e, p);
                      }}
                    >
                      ▶
                    </button>
                    <button
                      className="x"
                      title="Unpin"
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onUnpin(p);
                      }}
                    >
                      ×
                    </button>
                  </div>
                  <div className="proj-meta">
                    <span>{!pi ? "Scanning…" : pi.contentModified ? `Edited ${ageLabel(pi.contentModified)}` : "No files"}</span>
                    {pi?.folderModified ? <span className="muted">· folder {ageLabel(pi.folderModified)}</span> : null}
                    {g && (
                      <span className={"gitinfo" + (g.dirty ? " dirty" : "")} title={`Branch ${g.branch}`}>
                        ⎇ {g.branch}
                        {g.dirty ? " ●" : ""}
                        {g.ahead ? ` ↑${g.ahead}` : ""}
                      </span>
                    )}
                  </div>
                  {st.length > 0 && (
                    <div className="note-line">
                      <span className="chips" title={st.map(stackLabel).join(", ")}>
                        {st.slice(0, 3).map((id) => (
                          <span key={id} className="chip" style={{ ["--c" as string]: STACKS[id]?.color }}>
                            {stackLabel(id)}
                          </span>
                        ))}
                      </span>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        ))}
      </div>

      </div>

      <div className="side-head">
        <span>{props.root && baseName(props.root).toLowerCase() !== "projects" ? `Projects · ${baseName(props.root)}` : "Projects"}</span>
        <span className="side-actions">
          {props.root && (
            <button className="link" onClick={props.onSearch} title="Search file names and contents in all projects (Ctrl+Shift+F)">
              search
            </button>
          )}
          {props.root && gitOk(props) && (
            <button className="link" onClick={props.onFetchAll} title="git fetch in every project, then refresh the git badges">
              fetch all
            </button>
          )}
          {props.root && (
            <button className="link" onClick={props.onCleanup} title="Find node_modules, build output and virtual environments to delete">
              clean up
            </button>
          )}
          <button className="link" onClick={props.onChooseRoot}>
            {props.root ? "change" : "choose"}
          </button>
        </span>
      </div>

      {props.gitOk === false && !props.gitBannerDismissed && (
        <div className="banner">
          Git not found, so git info is off. Everything else works.{" "}
          <button className="link" onClick={props.onInstallGit}>
            Install git
          </button>{" "}
          <button className="link" onClick={props.onDismissGit}>
            Dismiss
          </button>
        </div>
      )}

      {!props.root ? (
        <div className="empty-side">
          <p>Pick the folder that contains all your projects.</p>
          <button className="primary" onClick={props.onChooseRoot}>
            Choose projects folder
          </button>
        </div>
      ) : (
        <>
          <div className="filters">
            <div className="search-wrap">
              <input
                placeholder="Search projects…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && q && (e.stopPropagation(), setQ(""))}
              />
              {q && (
                <button className="search-clear" title="Clear search" onClick={() => setQ("")}>
                  ×
                </button>
              )}
            </div>
            <select value={sort} onChange={(e) => setSort(e.target.value as ProjSort)} title="Sort">
              <option value="name">Name</option>
              <option value="contentOld">Stalest content</option>
              <option value="contentNew">Newest content</option>
              <option value="folderNew">Newest folder</option>
              <option value="status">Status</option>
            </select>
            <select value={filter} onChange={(e) => setFilter(e.target.value as Status | "all" | "none")} title="Filter">
              <option value="all">All tags</option>
              {STATUSES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
              <option value="none">Untagged</option>
            </select>
          </div>
          <div className="filters2">
            <div className="seg">
              <button className={!attnOnly ? "on" : ""} onClick={() => setAttnOnly(false)}>
                All
              </button>
              <button className={attnOnly ? "on" : ""} onClick={() => setAttnOnly(true)}>
                Needs attention{git && Object.keys(git).length ? ` (${attnCount})` : ""}
              </button>
            </div>
            <select value={stackFilter} onChange={(e) => setStackFilter(e.target.value)} title="Filter by stack">
              <option value="all">All stacks</option>
              {Object.keys(stackCounts)
                .sort((x, y) => stackCounts[y] - stackCounts[x])
                .map((id) => (
                  <option key={id} value={id}>
                    {stackLabel(id)} ({stackCounts[id]})
                  </option>
                ))}
            </select>
          </div>
          <VirtualList
            className="projects"
            count={view.length}
            rowHeight={68}
            keyOf={(i) => view[i].path}
            render={(i) => {
              const p = view[i];
              const m = props.meta[p.path] ?? {};
              const pi = info[p.path];
              const g = git[p.path];
              return (
                <div
                  className={"proj" + (props.cwd === p.path ? " active" : "") + (dropPath === p.path ? " drop" : "")}
                  draggable
                  onDragStart={(e) => {
                    dragState.paths = [p.path];
                    e.dataTransfer.setData("text/plain", p.path);
                    e.dataTransfer.effectAllowed = "copyMove";
                  }}
                  onDragEnd={() => {
                    dragState.paths = [];
                    setDropPath(null);
                    setPinOver(false);
                  }}
                  onClick={() => props.onOpen(p.path)}
                  onAuxClick={(e) => e.button === 1 && props.onOpenNewTab(p.path)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    props.onContextMenu(e, p.path);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDropPath(p.path);
                  }}
                  onDragLeave={() => setDropPath(null)}
                  onDrop={(e) => {
                    setDropPath(null);
                    props.onDropInto(p.path, e);
                  }}
                >
                  <div className="proj-top">
                    <span
                      className={"dot " + ageClass(pi?.contentModified ?? 0, t)}
                      title={`Content changed ${formatDate(pi?.contentModified ?? 0)}`}
                    />
                    <span className="proj-name" title={p.path}>
                      {p.name}
                    </span>
                    <select
                      className={"status s-" + (m.status ?? "none")}
                      value={m.status ?? ""}
                      title="Project status"
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => props.onMeta(p.path, { status: (e.target.value || undefined) as Status | undefined })}
                    >
                      <option value="">+ tag</option>
                      {STATUSES.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="proj-meta">
                    {attnOnly ? (
                      <span className="attn-reasons" title={g?.lastMessage ? `Last commit: ${g.lastMessage}` : undefined}>
                        {reasonsOf(p.path)
                          .map((r) => r.text)
                          .join(" · ")}
                      </span>
                    ) : (
                      <>
                        <span title={`Content changed ${formatDate(pi?.contentModified ?? 0)}`}>
                          {!pi ? "Scanning…" : pi.contentModified ? `Edited ${ageLabel(pi.contentModified)}` : "No files"}
                        </span>
                        <span className="muted" title={`Folder modified ${formatDate(p.modified)}`}>
                          · folder {ageLabel(p.modified)}
                        </span>
                      </>
                    )}
                    {g && (
                      <span
                        className={"gitinfo" + (g.dirty ? " dirty" : "")}
                        title={`Branch ${g.branch}${g.dirty ? ", uncommitted changes" : ""}${g.ahead ? `, ${g.ahead} unpushed` : ""}
Last commit: ${formatDate(g.lastCommit)}`}
                      >
                        ⎇ {g.branch}
                        {g.dirty ? " ●" : ""}
                        {g.ahead ? ` ↑${g.ahead}` : ""}
                      </span>
                    )}
                  </div>
                  {editNote === p.path ? (
                    <input
                      className="note editing"
                      autoFocus
                      placeholder="Add a note…"
                      defaultValue={m.note ?? ""}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") e.currentTarget.blur();
                        else if (e.key === "Escape") {
                          cancelNote.current = true;
                          e.currentTarget.blur();
                        }
                      }}
                      onBlur={(e) => {
                        if (!cancelNote.current) props.onMeta(p.path, { note: e.currentTarget.value.trim() });
                        cancelNote.current = false;
                        setEditNote(null);
                      }}
                    />
                  ) : (
                    <div className="note-line">
                      {(stacks[p.path]?.length ?? 0) > 0 && (
                        <span className="chips" title={stacks[p.path].map(stackLabel).join(", ")}>
                          {stacks[p.path].slice(0, 3).map((id) => (
                            <span key={id} className="chip" style={{ ["--c" as string]: STACKS[id]?.color }}>
                              {stackLabel(id)}
                            </span>
                          ))}
                        </span>
                      )}
                      <span className="note-text" title={m.note}>
                        {m.note}
                      </span>
                      <button
                        className="note-edit run"
                        title="Run a script (npm, cargo)"
                        onClick={(e) => {
                          e.stopPropagation();
                          props.onScripts(e, p.path);
                        }}
                      >
                        ▶
                      </button>
                      <button
                        className="note-edit"
                        title={m.note ? "Edit note" : "Add a note"}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditNote(p.path);
                        }}
                      >
                        ✎
                      </button>
                    </div>
                  )}
                </div>
              );
            }}
          />
          {view.length === 0 && <div className="hint">No projects match.</div>}
        </>
      )}
    </aside>
  );
}
