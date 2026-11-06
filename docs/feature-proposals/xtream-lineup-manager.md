# Xtream Live TV lineup manager

## Motivation

Xtream providers can expose thousands of channels and dozens of categories. Before
this feature AIOStreams passed the provider's categories and channel order through
unchanged. Users could favourite channels but could not remove unwanted channel
groups, exclude single streams, or choose a preferred order. CSS hiding did not
affect search, EPG, channel numbers or playback.

## Scope

The manager is specific to the built-in **Xtream** preset. It does not rewrite the
provider's account, change unrelated Stremio addons, or add a separate TV server.

- **Categories:** show/hide, order with Up/Down, and browse each category.
- **Channels:** search/browse by pages of 100, show/hide individual channel IDs,
  and move selected channels into a prioritized order.
- **Persistence:** rules live in `preset.options.lineup`; the ordinary
  Install/Update and Save workflow persists them in the configuration.
- **Application:** the resulting builtin manifest, catalog pages, guide
  (`metasDetailed`), metadata, and stream access all respect the rules.
- **Isolation:** Xtream's shared provider response/cache is never changed; a
  derived view is cached per source lineup and rules. The cache holds at most
  eight rule variants per provider lineup and is weakly referenced.
- **Compatibility:** accounts without rules return channels/categories in the
  upstream order. Stale provider IDs/names are ignored. They remain in the
  saved rule object so a temporarily missing channel can return with its prior
  preference after a provider refresh.

## UI instructions

1. Configure → Addons → Marketplace → Xtream (or Installed → Edit).
2. Enter the Xtream server, username and password.
3. Expand **Manage Live TV categories and channels** and click **Load provider
   channels**. This queries the existing server, *not* the provider directly
   from the browser.
4. Uncheck a category to hide it from Live TV and use its arrow buttons to
   reorder categories. Click a category to browse its channels.
5. Search for a channel, uncheck it to hide it, or click **Top** to prioritize
   it. Up/Down adjust the order within the prioritized subset. Channels not
   explicitly prioritized retain their source order.
6. Click **Install**/**Update**, then save the AIOStreams configuration.

The manager searches raw provider data, including hidden entries, so changes can
always be reversed. **Reset all lineup preferences** restores provider defaults.

## Data contract

```json
{
  "lineup": {
    "hiddenGroups": ["International"],
    "hiddenChannels": [1201, 1202],
    "groupOrder": ["UK Sports", "UK News"],
    "channelOrder": [2003, 2001]
  }
}
```

The four arrays are optional inside the `lineup` object and default to
empty. Group keys are provider **category names** (the existing Xtream addon
combines duplicate category names); channel keys are numeric provider
`stream_id` values. The schema imposes size/type limits.

**Semantics:**
- A hidden group disappears from the genre filter and EPG group selector.
- A channel present in multiple groups remains if any group is visible.
- A channel belonging only to hidden groups disappears from All channels,
  channel search, EPG and direct stream lookup.
- Ungrouped channels stay visible unless individually hidden.
- A hidden channel never appears in another visible group.
- Explicit ordered IDs appear first; remaining channels preserve provider
  order. Group ordering is handled similarly.
- Provider-supplied channel numbers are unchanged. For streams without numbers,
  the original provider position is used instead of renumbering on every hide.
- The built-in Xtream stream and archive URLs remain unchanged for visible
  channels, preserving EPG and catch-up behaviour.

## Architecture

**Core:** `packages/core/src/builtins/xtream/lineup-manager.ts` derives a
visibility/order view from `Lineup`. It does not mutate the provider-owned
typed arrays. `addon.ts` uses that view in manifest, catalogs (including
`date` and `ids` guides), meta and streams. `xtream.ts` carries rules into
the URL-encoded builtin config on generation.

**Server:** `POST /builtins/xtream/preview` returns only raw provider category
names/counts and a page of stream IDs/names/numbers/logos. The browser submits
credentials in a request body rather than a URL. It follows the existing
`/newznab/test` route pattern: session auth when required, the user API rate
limiter, validation of input lengths, and explicit internal-route whitelist.
No credentials are returned, and the preview cannot alter provider data.

**Frontend:** the existing Add/Edit addon modal conditionally renders
`xtream-lineup-manager.tsx` for the Xtream preset. No new global
configuration or changes to player CSS are needed.

## Test and reviewer checklist

- [x] Unit tests added for default behaviour, category hiding with overlapping
      memberships, hidden channels, stable ordering, stale IDs, invalid IDs,
      and no mutation of shared lineups.
- [ ] Run `pnpm -F core test`.
- [ ] Run `pnpm -F core build`, `pnpm -F server build`,
      `pnpm -F frontend typecheck`, and `pnpm -F frontend build`.
- [ ] Test two Xtream accounts with independent preferences on one server.
- [ ] Test provider lineups containing tens of thousands of streams and long
      category lists.
- [ ] Confirm saved preferences survive config reload, server restart and
      provider lineup refresh.
- [ ] Verify live search, Jellyfin /LiveTv/Channels, /LiveTv/Programs, guide
      date/ids lookups, direct /meta and /stream requests, and catch-up.
- [ ] Confirm the preview route is forbidden without a session when
      configuration-session authentication is enabled.
- [ ] Check malformed input, external account errors and rate limiting.
- [ ] Review SSRF controls and whether an authenticated config-scoped API
      endpoint is preferred to the existing builtin-test convention.
- [ ] Review channel numbering when a provider supplies duplicate numbers.
- [ ] Review the per-view cache and category traversal performance.

## Known limitations and decisions for upstream review

- Categories use their **names**, not their provider category IDs, because the
  existing Live TV API groups by name. A provider rename loses the category
  preference; moving to stable category IDs would require changing that
  grouping contract.
- Channel reordering is *priority-first* rather than dragging all 50,000
  entries. This avoids loading the whole lineup in the browser.
- A provider-side channel that has been removed permanently remains in saved
  rules until the user resets them; it has no effect on playback.
- Other Stremio Live TV addons are unaffected; a generic per-user lineup manager
  would be a separate feature.
- This feature does **not** add DVR recording, timers, or playlist export.

## CodeRabbit and upstream PR review

Keep the change focused on Xtream and Live TV only. Allow the existing upstream
CodeRabbit installation to review the pull request rather than adding a new
repository-wide CodeRabbit configuration. Review bot findings for security,
privacy, hidden direct-resource access, performance and regression cases;
resolve actionable comments with follow-up commits and rerun checks. Human
maintainer approval remains necessary.

If the upstream maintainers prefer smaller PRs, split the frontend and preview
route from the pure core rules engine, preserving the same data contract.
