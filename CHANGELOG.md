# Changelog

All notable changes to LinkSweepr are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Options page: a filter box and an A-Z sort toggle above the domain preview.
  Typing narrows the previewed domains using the shared `domain.js` matching, so
  a query of `reddit.com` surfaces `old.reddit.com` the same way the sweep covers
  it (and does not surface the lookalike `notreddit.com`). Filtering and sorting
  are display-only and never change the stored list.
- Popup: a session sweep counter showing how many history entries have been
  removed since the service worker started, as visible feedback that the
  extension is working. The count is held in memory in the worker and is never
  persisted (it may reset when the worker is torn down, which is acceptable), so
  no URLs, domains, or timestamps are stored as a result.
- Two faster ways to block the current site, alongside the toolbar popup: a
  keyboard shortcut (default `Ctrl+Shift+L`, `Command+Shift+L` on macOS, and
  user-rebindable) and a right-click "Block this domain in LinkSweepr" page menu.
  Both route through the same serialized list write and the shared suffix-aware
  matching, and both no-op on internal pages like `chrome://` and `edge://`. Adds
  the `contextMenus` permission.

## [1.1.0] - 2026-07-02

### Added

- Toolbar popup: shows how many domains are filtered and blocks the current site
  in one click (suffix-match aware, and it leaves internal `chrome://` and
  `edge://` pages alone since those cannot be filtered). Adds the `activeTab`
  permission.
- Options page live preview of the domains that will be filtered, with a warning
  for any line that does not resolve to a domain, plus import and export of the
  list as a text file.
- Shared `domain.js` module for domain normalization, matching, and list
  operations, loaded by the service worker (`importScripts`), the pages
  (`<script>`), and the tests (`require`), so the preview, the popup, and the
  sweep always agree.
- Single-page-app navigation coverage through `webNavigation`, so a matching
  visit is removed the moment it is recorded, not only on a full page load.
- Backstop sweep on a periodic `alarms` schedule, so any missed history entry is
  cleaned up on-device.
- Unit tests (Node's test runner with a `chrome.history` mock) and continuous
  integration: syntax checks, tests, manifest validation, and addons-linter
  filtered to Chrome and Edge relevant errors.

### Changed

- Renamed the extension from "History domain filter" to LinkSweepr.
- Rebuilt the options page around the live preview and save-on-input.
- Made the history sweep collision-safe by paginating `history.search` per domain.

### Fixed

- Serialized the list writes through one queue so a slow earlier write cannot
  overwrite a newer one.
- Routed the sweep trigger through that same queue so the worker never sweeps
  against a stale list, and armed the debounce synchronously so hiding the tab
  mid-edit still flushes the sweep.
- Correct punycode suffix matching and IPv6 literal host handling, and reject
  Chromium's percent-encoded host values.

## [1.0.0] - 2026-07-02

### Added

- Initial Manifest V3 baseline for Microsoft Edge and Google Chrome: delete each
  visit to a listed domain, all its subdomains, and every path under it as
  history records it.
- Options page for editing the domain list, stored in `chrome.storage.local`.
- Sweep of existing history on install and on browser startup.

[Unreleased]: https://github.com/jamditis/link-sweepr/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/jamditis/link-sweepr/releases/tag/v1.1.0
[1.0.0]: https://github.com/jamditis/link-sweepr/commit/ad8964e
