import { useEffect, useMemo, useRef, useState } from "react";
import { type Commit, type Entry, type Hit, gitLog, openCodeAt, searchProject } from "./api";
import { ageLabel, formatDate, parentOf } from "./util";

interface Group {
  root: string;
  name: string;
  hits: Hit[];
}

const MAX_ROWS = 600;

function Highlight({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

/** Ctrl+Shift+F: find a file name or a piece of code in every project. Projects are searched three at a time. */
export function SearchPanel(props: {
  projects: Entry[];
  ignore: string[];
  onClose: () => void;
  onOpenFolder: (path: string) => void;
  onError: (msg: string) => void;
}) {
  const [q, setQ] = useState("");
  const [content, setContent] = useState(true);
  const [groups, setGroups] = useState<Group[]>([]);
  const [done, setDone] = useState(0);
  const [running, setRunning] = useState(false);
  const [ran, setRan] = useState("");
  const run = useRef(0);

  const start = (query: string, byContent: boolean) => {
    const id = ++run.current;
    const term = query.trim();
    setGroups([]);
    setDone(0);
    if (term.length < 2) {
      setRunning(false);
      setRan("");
      return;
    }
    setRunning(true);
    setRan(term);
    const queue = [...props.projects];
    const worker = async () => {
      while (queue.length && run.current === id) {
        const p = queue.shift()!;
        try {
          const hits = await searchProject(p.path, term, byContent, props.ignore);
          if (run.current === id && hits.length)
            setGroups((g) => [...g, { root: p.path, name: p.name, hits }].sort((a, b) => b.hits.length - a.hits.length));
        } catch {
          /* unreadable project: skip */
        }
        if (run.current === id) setDone((n) => n + 1);
      }
    };
    void Promise.all([worker(), worker(), worker()]).then(() => run.current === id && setRunning(false));
  };

  // Search shortly after typing stops, and again when the scope changes.
  useEffect(() => {
    const t = setTimeout(() => start(q, content), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, content]);
  useEffect(
    () => () => {
      run.current++;
    },
    [],
  );

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const total = groups.reduce((n, g) => n + g.hits.length, 0);
  const rows = useMemo(() => {
    const out: ({ kind: "head"; g: Group } | { kind: "hit"; g: Group; h: Hit })[] = [];
    let n = 0;
    for (const g of groups) {
      out.push({ kind: "head", g });
      for (const h of g.hits) {
        if (n++ >= MAX_ROWS) return out;
        out.push({ kind: "hit", g, h });
      }
    }
    return out;
  }, [groups]);

  const open = (h: Hit) => openCodeAt(h.path, h.line).catch((e) => props.onError(String(e)));

  return (
    <div className="qj-back" onMouseDown={props.onClose}>
      <div className="qj sp" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sp-top">
          <input
            autoFocus
            placeholder={content ? "Search code in all projects…" : "Find a file by name in all projects…"}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") props.onClose();
              else if (e.key === "Enter") start(q, content);
            }}
          />
          <div className="seg sp-seg">
            <button className={content ? "on" : ""} onClick={() => setContent(true)}>
              Contents
            </button>
            <button className={!content ? "on" : ""} onClick={() => setContent(false)}>
              File names
            </button>
          </div>
        </div>
        <div className="sp-status">
          {!ran
            ? "Type at least 2 characters. Skips node_modules, .git and your ignored folders; binary and very large files are skipped."
            : `${total} match${total === 1 ? "" : "es"} in ${groups.length} project${groups.length === 1 ? "" : "s"}` +
              (running ? ` · searching ${done}/${props.projects.length}…` : "") +
              (total > MAX_ROWS ? ` · showing the first ${MAX_ROWS}` : "")}
        </div>
        <div className="qj-list sp-list">
          {rows.map((r, i) =>
            r.kind === "head" ? (
              <div key={"g" + r.g.root} className="sp-head" title={r.g.root}>
                <span className="cl-proj">{r.g.name}</span>
                <span className="cl-gcount">{r.g.hits.length >= 200 ? "200+ (limit)" : r.g.hits.length}</span>
              </div>
            ) : (
              <div key={i} className="sp-hit" onClick={() => open(r.h)} title={`Open in VS Code: ${r.h.path}`}>
                <span className="sp-file">
                  {r.h.path.slice(r.g.root.length).replace(/^[\\/]+/, "")}
                  {r.h.line ? <span className="sp-line">:{r.h.line}</span> : null}
                </span>
                {r.h.line > 0 && (
                  <span className="sp-text">
                    <Highlight text={r.h.text} q={ran} />
                  </span>
                )}
                <button
                  className="sp-folder"
                  title="Show this folder in a new tab"
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onOpenFolder(parentOf(r.h.path));
                  }}
                >
                  folder
                </button>
              </div>
            ),
          )}
          {ran && !running && total === 0 && <div className="hint">No matches.</div>}
        </div>
        <div className="qj-foot">Click a result to open it in VS Code at that line · Esc closes</div>
      </div>
    </div>
  );
}

/** Last commits of a project. */
export function CommitsModal(props: { path: string; name: string; onClose: () => void }) {
  const [list, setList] = useState<Commit[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    gitLog(props.path, 25)
      .then(setList)
      .catch((e) => setErr(String(e).split("\n")[0]));
  }, [props.path]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });
  return (
    <div className="modal-backdrop" onMouseDown={props.onClose}>
      <div className="modal neutral commits" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Recent commits · {props.name}</h3>
        {err && <p className="cl-warn">{err}</p>}
        {!list && !err && <p className="cl-sub">Loading…</p>}
        {list && list.length === 0 && <p className="cl-sub">No commits yet.</p>}
        <div className="cm-list">
          {list?.map((c) => (
            <div key={c.hash} className="cm-row" title={formatDate(c.when)}>
              <code>{c.hash}</code>
              <span className="cm-subject">{c.subject}</span>
              <span className="cm-meta">
                {c.author} · {ageLabel(c.when)}
              </span>
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button autoFocus onClick={props.onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
