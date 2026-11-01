import type { GitInfo, ProjectInfo, Status } from "./api";

export interface Reason {
  text: string;
  weight: number;
}

const DAY = 86_400_000;

/** Why a project needs a look. Empty list means all is well. Repos with no remote are not flagged for being unpushed. */
export function attentionReasons(
  git: GitInfo | null | undefined,
  info: ProjectInfo | undefined,
  status: Status | undefined,
  staleDays: number,
  now = Date.now(),
): Reason[] {
  const out: Reason[] = [];
  if (git) {
    if (git.dirty) out.push({ text: `${git.dirtyCount} uncommitted`, weight: 3 });
    if (git.hasUpstream && git.ahead > 0) out.push({ text: `${git.ahead} unpushed`, weight: 3 });
    else if (!git.hasUpstream && git.hasRemote && git.lastCommit) out.push({ text: "branch not pushed", weight: 2 });
    if (git.behind > 0) out.push({ text: `${git.behind} behind`, weight: 1 });
  }
  if ((status === "active" || status === "unfinished") && info?.contentModified) {
    const days = Math.floor((now - info.contentModified) / DAY);
    if (days > staleDays) out.push({ text: `untouched ${days}d`, weight: 2 });
  }
  return out;
}

export const totalWeight = (r: Reason[]) => r.reduce((n, x) => n + x.weight, 0);
