import { z } from 'zod';
import type { Lineup } from './lineup.js';

/** Per-Xtream-installation preferences. Ids, not positions, survive provider refreshes. */
export const XtreamLineupRulesSchema = z.object({
  hiddenGroups: z.array(z.string().min(1).max(256)).max(10000).default([]),
  hiddenChannels: z.array(z.number().int().nonnegative()).max(100000).default([]),
  groupOrder: z.array(z.string().min(1).max(256)).max(10000).default([]),
  channelOrder: z.array(z.number().int().nonnegative()).max(100000).default([]),
});
export type XtreamLineupRules = z.infer<typeof XtreamLineupRulesSchema>;

export interface ManagedLineup {
  groups: string[];
  /** Visible provider indexes, in the user's order. */
  indices: number[];
  byGroup: Map<string, number[]>;
  visible: ReadonlySet<number>;
  /** The first visible group for each channel, respecting group order. */
  firstGroup: ReadonlyMap<number, string>;
}

function preferredFirst<T>(source: T[], preferred: T[]): T[] {
  const available = new Set(source);
  const used = new Set<T>();
  const result: T[] = [];
  for (const item of preferred) {
    if (!available.has(item) || used.has(item)) continue;
    used.add(item);
    result.push(item);
  }
  for (const item of source) {
    if (used.has(item)) continue;
    used.add(item);
    result.push(item);
  }
  return result;
}

/** Keep category visibility and ordering consistent between manifest and catalog calls. */
export function visibleGroupNames(
  groups: string[],
  rules: XtreamLineupRules
): string[] {
  const hidden = new Set(rules.hiddenGroups);
  return preferredFirst(groups.filter((g) => !hidden.has(g)), rules.groupOrder);
}

/** A small per-source cache, so pagination and guide calls don't rearrange large lineups. */
const cached = new WeakMap<Lineup, Map<string, ManagedLineup>>();
const MAX_VIEWS_PER_LINEUP = 8;

export function managedLineup(
  lineup: Lineup,
  rules: XtreamLineupRules
): ManagedLineup {
  const key = JSON.stringify(rules);
  let views = cached.get(lineup);
  const previous = views?.get(key);
  if (previous) return previous;

  const hiddenGroups = new Set(rules.hiddenGroups);
  const hiddenChannels = new Set(rules.hiddenChannels);
  const groups = preferredFirst(
    lineup.groups.filter((name) => !hiddenGroups.has(name)),
    rules.groupOrder
  );
  const present = new Uint8Array(lineup.streamIds.length);
  const inGroup = new Uint8Array(lineup.streamIds.length);
  const memberships = new Map<string, number[]>();

  // A channel with several categories survives when at least one remains visible.
  lineup.groups.forEach((name, group) => {
    const members = lineup.members[group] ?? [];
    for (const index of members) {
      inGroup[index] = 1;
      if (!hiddenGroups.has(name)) present[index] = 1;
    }
  });
  const allowed: number[] = [];
  for (let index = 0; index < lineup.streamIds.length; index++) {
    if (hiddenChannels.has(lineup.streamIds[index])) continue;
    if (inGroup[index] && !present[index]) continue;
    allowed.push(index);
  }
  const byId = new Map(allowed.map((index) => [lineup.streamIds[index], index]));
  const prioritized = rules.channelOrder
    .map((id) => byId.get(id))
    .filter((index): index is number => index !== undefined);
  const indices = preferredFirst(allowed, prioritized);
  const visible = new Set(indices);
  const order = new Map(indices.map((index, position) => [index, position]));
  const firstGroup = new Map<number, string>();
  for (const name of groups) {
    const group = lineup.groups.indexOf(name);
    const members = Array.from(lineup.members[group] ?? []).filter((index) =>
      visible.has(index)
    );
    members.sort((a, b) => order.get(a)! - order.get(b)!);
    memberships.set(name, members);
    for (const index of members)
      if (!firstGroup.has(index)) firstGroup.set(index, name);
  }
  const result: ManagedLineup = {
    groups,
    indices,
    byGroup: memberships,
    visible,
    firstGroup,
  };
  if (!views) {
    views = new Map();
    cached.set(lineup, views);
  }
  if (views.size >= MAX_VIEWS_PER_LINEUP)
    views.delete(views.keys().next().value!);
  views.set(key, result);
  return result;
}
