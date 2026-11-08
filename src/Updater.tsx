import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

const RELEASES = "https://github.com/suhailaleryani/DevFileExplorer/releases/latest";

type Phase =
  | { k: "idle" }
  | { k: "checking" }
  | { k: "uptodate" }
  | { k: "available"; update: Update }
  | { k: "installing"; done: number; total: number }
  | { k: "error"; msg: string };

/** Footer button that checks GitHub Releases for a newer signed build and installs it. */
export function UpdateButton() {
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState("");
  const [portable, setPortable] = useState(false);

  const run = useCallback(async (manual: boolean) => {
    setPhase({ k: "checking" });
    try {
      const update = await check();
      if (update) {
        setPhase({ k: "available", update });
        if (manual) setOpen(true);
      } else {
        setPhase({ k: "uptodate" });
        if (manual) setOpen(true);
      }
    } catch (e) {
      // offline, no release published yet, or running from `tauri dev`: stay quiet unless the user asked
      setPhase({ k: "error", msg: String(e) });
      if (manual) setOpen(true);
    }
  }, []);

  useEffect(() => {
    void getVersion().then(setVersion).catch(() => {});
    void invoke<boolean>("is_portable").then(setPortable).catch(() => {});
    const t = setTimeout(() => void run(false), 4000); // silent check shortly after launch
    return () => clearTimeout(t);
  }, [run]);

  const install = async (update: Update) => {
    let total = 0;
    let done = 0;
    setPhase({ k: "installing", done, total });
    try {
      await update.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        else if (ev.event === "Progress") done += ev.data.chunkLength;
        setPhase({ k: "installing", done, total });
      });
      await relaunch();
    } catch (e) {
      setPhase({ k: "error", msg: String(e) });
    }
  };

  const available = phase.k === "available";
  const busy = phase.k === "checking" || phase.k === "installing";

  return (
    <>
      <button
        className={"theme-btn hist-btn" + (available ? " upd-avail" : "")}
        title={available ? `Version ${phase.update.version} is available` : `Check for updates (this is ${version || "?"})`}
        disabled={busy}
        onClick={() => (available ? setOpen(true) : void run(true))}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 2.5v8M4.8 7.6 8 10.8l3.2-3.2M3 13.2h10" />
        </svg>
        {available ? `Update ${phase.update.version}` : phase.k === "checking" ? "Checking…" : "Update"}
      </button>
      {open && (
        <div className="modal-backdrop" onMouseDown={() => !busy && setOpen(false)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            {phase.k === "available" && (
              <>
                <h3>Update available</h3>
                <p>
                  Version {phase.update.version} is ready (you have {version}).
                  {portable && " This is the portable copy: download the new zip from the release page instead."}
                </p>
                {phase.update.body && <p className="upd-notes">{phase.update.body}</p>}
                <div className="modal-actions">
                  <button onClick={() => setOpen(false)}>Later</button>
                  {portable ? (
                    <button autoFocus onClick={() => void openUrl(RELEASES)}>Open release page</button>
                  ) : (
                    <button autoFocus onClick={() => void install(phase.update)}>Install and restart</button>
                  )}
                </div>
              </>
            )}
            {phase.k === "installing" && (
              <>
                <h3>Installing update…</h3>
                <p>
                  {phase.total > 0 ? `${Math.round((phase.done / phase.total) * 100)}% downloaded.` : "Downloading…"} The app restarts
                  when it is done.
                </p>
              </>
            )}
            {phase.k === "uptodate" && (
              <>
                <h3>You are up to date</h3>
                <p>Version {version} is the latest release.</p>
                <div className="modal-actions">
                  <button autoFocus onClick={() => setOpen(false)}>OK</button>
                </div>
              </>
            )}
            {phase.k === "error" && (
              <>
                <h3>Could not check for updates</h3>
                <p>{phase.msg}</p>
                <div className="modal-actions">
                  <button onClick={() => void openUrl(RELEASES)}>Open release page</button>
                  <button autoFocus onClick={() => setOpen(false)}>Close</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
