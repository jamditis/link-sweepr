# Contributing to LinkSweepr

Thanks for your interest in improving LinkSweepr. This is a small, single-purpose
extension: it keeps chosen domains out of browsing history, entirely on-device,
with nothing sent anywhere. Changes that hold to that purpose are the easiest to
review and land.

## Ground rules

- Keep the single purpose. LinkSweepr manages what enters browsing history. It
  does not collect data, make network requests, or add analytics, and it should
  not grow broad host permissions.
- Prefer the smallest change that fixes the problem at its root. No temporary
  workarounds left in place.
- Match the surrounding code: plain Manifest V3, no bundler, no runtime
  dependencies in the shipped extension.

## Project layout

- `background.js` - the service worker: deletes matching visits in real time
  (`history.onVisited` plus `webNavigation` for single-page-app navigations) and
  runs backstop sweeps on an alarm, on install, and on startup.
- `domain.js` - the shared module for domain normalization, matching, and list
  operations. The service worker loads it with `importScripts`, the pages load it
  with a `<script>` tag, and the tests `require` it. Keep the options preview, the
  popup, and the sweep agreeing by putting shared logic here.
- `options.html` / `options.js` - the options page: the domain list, live preview,
  and import/export.
- `popup.html` / `popup.js` - the toolbar popup: filtered count and one-click block.
- `manifest.json` - Manifest V3 for both Edge and Chrome (no browser-specific keys).
- `test/` - unit tests. `scripts/` - build and check tooling. `docs/` - the site.

## Development setup

Requires Node.js 20 or newer.

```
npm install        # dev tooling only (addons-linter, sharp); the extension ships zero deps
npm test           # unit tests, Node's built-in runner with a chrome.history mock
npm run validate   # confirms manifest references and icons resolve
npm run package    # assembles dist/ext and zips it for store upload
npm run lint       # addons-linter over the assembled bundle (Chrome/Edge errors only)
```

To try a change in the browser:

1. Open `edge://extensions` or `chrome://extensions`.
2. Turn on Developer mode.
3. Choose Load unpacked and select this folder.
4. Reload the extension after each edit.

## Before you open a pull request

- Run `npm test` and `npm run validate`; both must pass.
- If you changed extension code, load it unpacked and smoke-test the popup, the
  options page, and the sweep against a test domain.
- Add a `CHANGELOG.md` entry under `[Unreleased]` for any user-facing change.
- Keep the pull request focused on one thing. Every change is reviewed before it
  merges, and small diffs are far easier to review well.

## Reporting bugs and requesting features

Use the issue forms (bug report or feature request). For anything that looks like
a security concern, follow `SECURITY.md` instead of opening a public issue.
