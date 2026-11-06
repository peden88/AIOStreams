import React, { useEffect, useState } from 'react';
import { Button } from '@aiostreams/ui/button';

interface Rules {
  hiddenGroups: string[];
  hiddenChannels: number[];
  groupOrder: string[];
  channelOrder: number[];
}
interface Preview {
  groups: { name: string; count: number }[];
  channels: { id: number; name: string; number: number; logo?: string }[];
  total: number;
}

const EMPTY: Rules = {
  hiddenGroups: [],
  hiddenChannels: [],
  groupOrder: [],
  channelOrder: [],
};
const PER_PAGE = 100;

/** Config-page-only manager. The server never shares these rules between logins. */
export function XtreamLineupManager({
  server,
  username,
  password,
  value,
  onChange,
}: {
  server?: string;
  username?: string;
  password?: string;
  value?: Partial<Rules>;
  onChange: (rules: Rules) => void;
}) {
  const rules: Rules = { ...EMPTY, ...value };
  const [preview, setPreview] = useState<Preview | null>(null);
  const [group, setGroup] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const ready = !!(server && username && password);
  const update = (patch: Partial<Rules>) => onChange({ ...rules, ...patch });

  useEffect(() => {
    // A preview from an old account must never appear under new credentials.
    setPreview(null);
    setOffset(0);
    setGroup('');
    setError('');
  }, [server, username, password]);

  const load = async (nextOffset = offset, nextGroup = group, nextSearch = search) => {
    if (!ready) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/builtins/xtream/preview', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          server,
          username,
          password,
          group: nextGroup || undefined,
          search: nextSearch.trim() || undefined,
          offset: nextOffset,
          limit: PER_PAGE,
        }),
      });
      if (!response.ok) throw new Error('Could not retrieve channels from this Xtream account.');
      const next = (await response.json()) as Preview;
      setPreview(next);
      setOffset(nextOffset);
      setGroup(nextGroup);
    } catch {
      setError('Could not load channels. Check your provider address and credentials.');
    } finally {
      setLoading(false);
    }
  };

  const groupNames = preview?.groups.map((g) => g.name) ?? [];
  const orderedGroups = [
    ...rules.groupOrder.filter((name) => groupNames.includes(name)),
    ...groupNames.filter((name) => !rules.groupOrder.includes(name)),
  ];
  const moveGroup = (name: string, direction: number) => {
    const order = [...orderedGroups];
    const at = order.indexOf(name);
    const to = at + direction;
    if (at < 0 || to < 0 || to >= order.length) return;
    [order[at], order[to]] = [order[to], order[at]];
    update({ groupOrder: order });
  };
  const toggleGroup = (name: string) =>
    update({
      hiddenGroups: rules.hiddenGroups.includes(name)
        ? rules.hiddenGroups.filter((g) => g !== name)
        : [...rules.hiddenGroups, name],
    });
  const toggleChannel = (id: number) =>
    update({
      hiddenChannels: rules.hiddenChannels.includes(id)
        ? rules.hiddenChannels.filter((channelId) => channelId !== id)
        : [...rules.hiddenChannels, id],
    });
  const movePriority = (id: number, direction: number) => {
    const order = rules.channelOrder.filter((item) => item !== id);
    if (!rules.channelOrder.includes(id)) {
      order.unshift(id);
    } else {
      const current = rules.channelOrder.indexOf(id);
      const to = Math.max(0, Math.min(order.length, current + direction));
      order.splice(to, 0, id);
    }
    update({ channelOrder: order });
  };

  return (
    <details className="rounded-lg border border-[--border] p-3 space-y-3">
      <summary className="cursor-pointer font-semibold">Manage Live TV categories and channels</summary>
      <p className="text-sm text-[--muted] mt-2">
        Hide unwanted groups or channels and prioritise their order. Changes are
        saved with this Xtream addon when you select Install or Update below.
        Unlisted channels keep the provider's order.
      </p>
      <Button type="button" size="sm" disabled={!ready || loading} onClick={() => void load(0, '', '')}>
        {loading ? 'Loading channels…' : 'Load provider channels'}
      </Button>
      {!ready && <p className="text-sm text-[--muted]">Enter the provider URL, username and password first.</p>}
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      {preview && (
        <div className="space-y-3 mt-3">
          <div className="flex items-center justify-between">
            <strong className="text-sm">Categories</strong>
            <button type="button" className="text-xs underline" onClick={() => void load(0, '', search)}>
              All channels
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto rounded border p-2 space-y-2">
            {orderedGroups.map((name, position) => (
              <div key={name} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  aria-label={`Show category ${name}`}
                  checked={!rules.hiddenGroups.includes(name)}
                  onChange={() => toggleGroup(name)}
                />
                <button
                  type="button"
                  className="flex-1 min-w-0 text-left truncate hover:underline"
                  onClick={() => void load(0, name, search)}
                  title={name}
                >
                  {name} ({preview.groups.find((g) => g.name === name)?.count ?? 0})
                </button>
                <button type="button" aria-label={`Move ${name} up`} disabled={position === 0} onClick={() => moveGroup(name, -1)}>↑</button>
                <button type="button" aria-label={`Move ${name} down`} disabled={position === orderedGroups.length - 1} onClick={() => moveGroup(name, 1)}>↓</button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              aria-label="Search provider channels"
              className="min-w-0 flex-1 rounded border bg-transparent px-2 py-1 text-sm"
              placeholder="Search channel names"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void load(0, group, search);
                }
              }}
            />
            <Button type="button" size="sm" disabled={loading} onClick={() => void load(0, group, search)}>Search</Button>
          </div>
          <p className="text-xs text-[--muted]">
            {group || 'All channels'} · {preview.total.toLocaleString()} results ·
            {' '}{rules.hiddenChannels.length} individually hidden ·
            {' '}{rules.channelOrder.length} prioritised
          </p>
          <div className="max-h-64 overflow-y-auto rounded border p-2 space-y-2">
            {preview.channels.map((channel) => (
              <div key={channel.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!rules.hiddenChannels.includes(channel.id)}
                  aria-label={`Show ${channel.name}`}
                  onChange={() => toggleChannel(channel.id)}
                />
                <span className="min-w-0 flex-1 truncate" title={channel.name}>
                  {channel.number}. {channel.name}
                </span>
                <button
                  type="button"
                  className="text-xs underline"
                  title="Prioritise channel in the full lineup"
                  onClick={() => movePriority(channel.id, -1)}
                >
                  {rules.channelOrder.includes(channel.id) ? '↑' : 'Top'}
                </button>
                <button
                  type="button"
                  className="text-xs underline"
                  aria-label={`Move ${channel.name} down in priority`}
                  disabled={!rules.channelOrder.includes(channel.id)}
                  onClick={() => movePriority(channel.id, 1)}
                >↓</button>
              </div>
            ))}
            {!preview.channels.length && <p className="text-sm text-[--muted]">No matching channels.</p>}
          </div>
          <div className="flex items-center justify-between text-sm">
            <button type="button" disabled={offset === 0 || loading} onClick={() => void load(Math.max(0, offset - PER_PAGE))}>Previous</button>
            <span>{preview.total ? offset + 1 : 0}–{Math.min(preview.total, offset + PER_PAGE)}</span>
            <button type="button" disabled={loading || offset + PER_PAGE >= preview.total} onClick={() => void load(offset + PER_PAGE)}>Next</button>
          </div>
          <button type="button" className="text-xs underline" onClick={() => onChange({ ...EMPTY })}>
            Reset all lineup preferences
          </button>
        </div>
      )}
    </details>
  );
}
