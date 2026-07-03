<p align="center">
  <img src="docs/assets/wordmark.png" alt="LinkSweepr" width="480">
</p>

<p align="center">
  Keep chosen domains out of your browsing history, automatically, on-device.
</p>

<p align="center">
  <a href="https://chrome.google.com/webstore/detail/flebgmilmmjcmkdkkemacmgkbcoholok"><img src="https://img.shields.io/chrome-web-store/v/flebgmilmmjcmkdkkemacmgkbcoholok?label=Chrome%20Web%20Store" alt="Chrome Web Store"></a>
  <a href="https://github.com/jamditis/link-sweepr/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/jamditis/link-sweepr/ci.yml?branch=main&label=CI" alt="CI status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/jamditis/link-sweepr" alt="License: MIT"></a>
  <a href="https://github.com/jamditis/link-sweepr/releases"><img src="https://img.shields.io/github/v/release/jamditis/link-sweepr?sort=semver&display_name=tag" alt="Latest release"></a>
</p>

# LinkSweepr

A Microsoft Edge and Google Chrome extension (Manifest V3). You list the domains;
LinkSweepr removes each visit to those domains, all their subdomains, and every
path under them from history the moment it is recorded. The sites keep working
normally and you stay signed in - they just leave no trail in the history page or
the address bar. Everything runs locally, and nothing is ever sent anywhere.

## Get it

LinkSweepr is live on the [Chrome Web Store](https://chrome.google.com/webstore/detail/flebgmilmmjcmkdkkemacmgkbcoholok).
It installs on both Google Chrome and Microsoft Edge, since Edge adds Chrome Web Store extensions directly. You can
also [install it from source](#install-for-development).

Project site and full guide: <https://jamditis.github.io/link-sweepr/>

## How it works

- Reads a domain list you edit on the options page, stored locally in
  `chrome.storage.local`.
- On each visit to a matching domain, deletes that entry from history, including
  same-page navigations inside single-page apps.
- On install, on browser startup, on a periodic alarm, and whenever you change
  the list, sweeps existing history for matches and removes them.

## Managing the list

- **Options page** - one domain per line. A live preview shows the distinct
  domains that will be filtered and flags any line that does not resolve to a
  domain. Changes save automatically. You can export the list to a text file and
  import one back to move it between machines.
- **Toolbar popup** - click the toolbar icon to see how many domains are
  filtered and block the current site in one click. Blocking a site adds its
  domain to the list; the current page is left alone for internal pages like
  `chrome://` or `edge://`, which cannot be filtered.

## Privacy

Everything runs locally. LinkSweepr does not transmit, sync, or share any
browsing data with any server or third party. Its only stored data is the domain
list you enter, held in your browser's local extension storage. The full policy
is at <https://jamditis.github.io/link-sweepr/privacy.html>.

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
- Icons are generated into the PNG sizes the manifest references: 16 and 32 from
  `icons/mark.svg` (a simplified broom-and-link mark that stays legible at
  toolbar sizes), 48 and 128 from `icons/linksweepr.png` (the full logo, its
  white background flood-filled to transparent). Regenerate them with
  `npm run icons` after editing a source (needs the dev-only `sharp` dependency;
  the committed PNGs mean CI does not run this).
- Unit tests: `npm test` (Node's test runner with a `chrome.history` mock).
- Package for the stores: `npm run package` assembles the extension into
  `dist/ext` and writes `dist/link-sweepr-<version>.zip`.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development guide and
[SECURITY.md](SECURITY.md) for reporting a vulnerability.

## Status

Live on the Chrome Web Store, which installs on both Google Chrome and Microsoft
Edge. Changes are tracked in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE) (c) 2026 Joe Amditis.
