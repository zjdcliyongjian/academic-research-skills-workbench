import type { RunRecord } from "./types";

export interface RunConversation {
  id: string;
  root: RunRecord;
  latest: RunRecord;
  turns: RunRecord[];
}

function timestamp(run: RunRecord) {
  return Date.parse(run.startedAt || "") || 0;
}

export function conversationForRun(runs: RunRecord[], runId: string | null): RunRecord[] {
  if (!runId) return [];
  const byId = new Map(runs.map((run) => [run.id, run]));
  const lineage: RunRecord[] = [];
  const seen = new Set<string>();
  let current = byId.get(runId);
  while (current && !seen.has(current.id)) {
    lineage.unshift(current);
    seen.add(current.id);
    current = current.parentRunId ? byId.get(current.parentRunId) : undefined;
  }
  return lineage;
}

export function buildRunConversations(runs: RunRecord[]): RunConversation[] {
  const byId = new Map(runs.map((run) => [run.id, run]));
  const rootIdFor = (run: RunRecord) => {
    const seen = new Set<string>();
    let current = run;
    while (current.parentRunId && byId.has(current.parentRunId) && !seen.has(current.id)) {
      seen.add(current.id);
      current = byId.get(current.parentRunId)!;
    }
    return current.id;
  };
  const grouped = new Map<string, RunRecord[]>();
  for (const run of runs) {
    const rootId = rootIdFor(run);
    grouped.set(rootId, [...(grouped.get(rootId) || []), run]);
  }
  return [...grouped.entries()].map(([id, turns]) => {
    turns.sort((a, b) => timestamp(a) - timestamp(b));
    return { id, root: byId.get(id) || turns[0], latest: turns[turns.length - 1], turns };
  }).sort((a, b) => timestamp(b.latest) - timestamp(a.latest));
}

