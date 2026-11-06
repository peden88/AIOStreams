# Suggested upstream pull request

**Title:** feat(xtream): manage Live TV categories, channel visibility and order

## Why

Xtream playlists can expose many unwanted categories and thousands of channels.
Without a lineup manager, providers' full lists appear in Live TV, search, EPG
and remote navigation. Hiding rows with CSS cannot solve this consistently.

## Changes

- New per-Xtream-installation visibility and order rules, saved in
  `preset.options.lineup`: `hiddenGroups`, `hiddenChannels`,
  `groupOrder`, `channelOrder`.
- Builtin Xtream catalog, guide, meta and streams use a filtered derived lineup.
  Source caches remain shared and unchanged across users.
- The existing Configure → Addons → Xtream dialog has a channel manager:
  category visibility/order, paged channel search and visibility, and priority
  ordering for selected channels.
- A rate-limited, session-guarded POST preview endpoint lets the editor ask the
  AIOStreams server for raw provider categories/channels without putting login
  credentials in a browser URL.
- Live TV documentation and a comprehensive design/QA/risks document.
- Core unit tests for visibility, overlapping categories, ordering, stale IDs,
  schema checks and cache isolation.

## Compatibility and limitations

- Existing Xtream installs without new rules keep their original behaviour.
- Provider channel numbers remain unchanged; for unnamed numbers the original
  source index remains stable as items are hidden.
- Hidden categories exclude their unique channels from all Live TV surfaces.
  Channels belonging to another visible category survive.
- Rules use category names and numeric Xtream stream IDs; if providers rename
  categories, the previous rule no longer applies to that name.
- Unprioritised channels retain provider ordering; this isn't a 50,000-row
  drag-and-drop editor.
- Other Live TV addons, recordings, DVR timers and M3U editing are out of scope.

## Test plan

- [x] Unit tests committed for pure managed-lineup logic.
- [ ] Run `pnpm -F core test`.
- [ ] Run `pnpm -F core build`, `pnpm -F server build`,
      `pnpm -F frontend typecheck` and `pnpm -F frontend build`.
- [ ] Verify configuration persistence and two distinct Xtream accounts.
- [ ] Verify hidden channels cannot leak via guide `ids`, direct meta/stream,
      Jellyfin Live TV /Channels, /Programs, search and catch-up.
- [ ] Load-test large provider lineups and category lists.
- [ ] Review security of browser-reachable POST route, especially authenticated
      sessions, rate limiting and SSRF exposure.

## CodeRabbit and maintainer review

The repository already uses CodeRabbit. No changes to its settings are needed.
Please review the authentication boundary, direct hidden-resource lookups,
cross-account cache isolation, pagination performance and compatibility with
existing Xtream installations. Human review and CI are still required.

## Detailed design

See `docs/feature-proposals/xtream-lineup-manager.md`.

## Disclosure

Prepared with AI assistance; manually verify all changes and test with real
provider accounts before considering the PR merge-ready.
