# LinkSweepr

A Microsoft Edge and Google Chrome extension (Manifest V3) that keeps chosen
domains out of your browsing history. You list the domains; the extension removes
each visit to those domains, all their subdomains, and every path under them from
history the moment it is recorded. The sites keep working normally and you stay
signed in - they just leave no trail in the history page or the address bar.

## How it works
- Reads a domain list you edit on the options page, stored locally in
  `chrome.storage.local`.
- On each visit to a matching domain, deletes that entry from history.
- On install, on browser startup, and whenever you change the list, sweeps
  existing history for matches and removes them.

## Managing the list
- **Options page** - one domain per line. A live preview shows the distinct
  domains that will be filtered and flags any line that doesn't resolve to a
  domain. Changes save automatically. You can export the list to a text file and
  import one back to move it between machines.
- **Toolbar popup** - click the toolbar icon to see how many domains are
  filtered and block the current site in one click. Blocking a site adds its
  domain to the list; the current page is left for internal pages like
  `chrome://` or `edge://`, which can't be filtered.

## Privacy
Everything runs locally. The extension does not transmit, sync, or share any
browsing data with any server or third party. Its only stored data is the domain
list you enter, held in your browser's local extension storage.

## Install for development
1. Open `edge://extensions` or `chrome://extensions`.
2. Turn on Developer mode.
3. Choose Load unpacked, and select this folder.
4. Open the extension's options and add domains, one per line.

## Development
- Zero build step for the extension: plain Manifest V3, no bundler and no runtime
  dependencies.
- Domain normalization, matching, and the list operations that back the options
  preview and the popup live in one shared module, `domain.js`, so the preview
  and the block action agree with what the sweep actually does. The service
  worker pulls it in with `importScripts`; the pages load it with a `<script>`
  tag; the tests require it directly.
- Icons are generated from `icons/icon.svg` into the PNG sizes the manifest
  references. Regenerate them with `npm run icons` after editing the source
  (needs the dev-only `sharp` dependency; the committed PNGs mean CI does not
  run this).
- Unit tests: `npm test` (Node's test runner, a `chrome.history` mock).
- Plan and phases: `PLAN.md`.
- Review process required before any pull request: `REVIEW.md`.

## Status
Pre-release. Preparing for submission to the Microsoft Edge Add-ons store and the
Chrome Web Store from one shared codebase.
