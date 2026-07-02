# History domain filter

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
- Zero build step: plain Manifest V3, no bundler and no dependencies.
- Plan and phases: `PLAN.md`.
- Review process required before any pull request: `REVIEW.md`.

## Status
Pre-release. Preparing for submission to the Microsoft Edge Add-ons store and the
Chrome Web Store from one shared codebase.
