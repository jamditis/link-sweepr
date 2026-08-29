# LinkSweepr store listing copy

Everything needed to submit LinkSweepr to the Chrome Web Store and the Microsoft
Edge Add-ons store. The extension name and the short summary come from the
manifest automatically, so most fields below are paste-ready. Assets are in
`store/` (see the inventory at the bottom).

Privacy policy URL (both stores): `https://jamditis.github.io/link-sweepr/privacy.html`

---

## Name and summary (auto-filled from the manifest)

- **Name:** LinkSweepr
- **Summary / short description** (Chrome ≤132 chars, this is the manifest `description`, 113 chars):
  > Automatically removes chosen domains, all their subdomains, and every page under them from your browsing history.

You do not retype these in the dashboards; they are read from `manifest.json`. They are listed here only for reference.

---

## Single-purpose statement (both stores ask for this)

LinkSweepr has one purpose: to automatically remove visits to a user-chosen list of domains, including their subdomains and pages, from the browser's history, while leaving all other history and the sites themselves untouched.

---

## Detailed description (paste into both stores)

Fits Edge (250–10,000 chars) and Chrome (≤16,000 chars).

```
LinkSweepr keeps the sites you choose out of your browsing history, automatically and continuously.

Pick the domains you would rather not keep a record of. From then on, every visit to those domains, all of their subdomains, and every page beneath them is removed from your history the moment it is recorded. The sites keep working exactly as before. Your logins, cookies, and sessions are never touched. Only the history entry is removed.

Why LinkSweepr, instead of incognito or clearing your history:
- Incognito forgets an entire private session once you close it. LinkSweepr is selective and always on.
- Clearing history is a manual, all-or-nothing wipe. LinkSweepr removes only the domains you chose and leaves everything else recorded as usual.

Everything runs on your device:
- No servers, no accounts, no sync, and no analytics.
- No network requests of any kind. Nothing about your browsing is ever sent anywhere.
- No remote code. The extension ships as plain, unminified JavaScript you can read.

Minimal by design:
- No broad host permissions. LinkSweepr does not request access to the content of the websites you visit.
- It reads only the current tab's address, and only when you click the toolbar button to block a site.
- Your domain list stays in your browser's local storage and nowhere else.

How to use it:
- Click the toolbar button to add the site you are on to your list in one click.
- Or open the options page to edit the full list, one domain per line, with a live preview of exactly what will be filtered.
- Export your list to a text file and import it on another computer to move your setup.

LinkSweepr is free and open source under the MIT license. The full source, a setup guide, and the privacy policy are linked from the listing.
```

---

## Category

- **Chrome Web Store:** Privacy & Security.
- **Microsoft Edge:** Edge has no dedicated privacy category. Closest fit is Productivity (alt: Tools). Pick whichever the dropdown offers that reads best.

---

## Search terms / keywords

Edge allows up to 7 terms, each ≤30 characters. Chrome has no separate keyword field (it indexes the description).

1. browsing history
2. history cleaner
3. clear history
4. history filter
5. privacy
6. block history
7. auto delete history

---

## Per-permission justifications (privacy form, both stores)

| Permission | Justification |
|------------|---------------|
| `history` | Reads and deletes browsing-history entries locally to remove visits to the user's chosen domains. History is processed on the device only and is never transmitted. |
| `storage` | Stores the user's domain list and settings in local extension storage so they persist between sessions. No data leaves the device. |
| `webNavigation` | Detects same-page navigations inside single-page apps so a matching visit is removed the moment it is recorded, not only on a full page load. |
| `alarms` | Schedules a periodic local sweep so any history entry that was missed is cleaned up on the device. |
| `activeTab` | Reads only the current tab's address when the user acts to block a site (the toolbar button, the keyboard shortcut, or the right-click menu), which avoids requesting broad access to every website. |
| `contextMenus` | Adds a single right-click "Block this domain in LinkSweepr" item on ordinary web pages so the user can block the current site without opening the popup. It only reads the address of the page the user right-clicked, and only when they choose that item. |

No `host_permissions`, no `<all_urls>`, no `tabs`, and no `webRequest`. Lead the review notes with: no broad host permissions, all data stays local.

---

## Privacy practices / data use answers

- **Data collected:** none. Leave every data-type checkbox unchecked. LinkSweepr collects, transmits, syncs, sells, and shares nothing.
- **Remote code:** No. The extension runs only the code in the package; it loads nothing at runtime.
- **Chrome certifications (check all three):**
  - I do not sell or transfer user data to third parties, outside of the approved use cases.
  - I do not use or transfer user data for purposes unrelated to my item's single purpose.
  - I do not use or transfer user data to determine creditworthiness or for lending purposes.
- **Privacy policy URL:** `https://jamditis.github.io/link-sweepr/privacy.html`

---

## Support and homepage URLs

- **Homepage / website:** `https://jamditis.github.io/link-sweepr/`
- **Support / issues:** `https://github.com/jamditis/link-sweepr/issues`

---

## Asset inventory (files to upload)

All paths are under `store/`.

| Asset | File | Size | Where it goes |
|-------|------|------|---------------|
| Store logo (Edge) | `logos/logo-300.png` | 300x300 | Edge "Store logo" |
| Listing icon (Chrome) | `logos/logo-128.png` | 128x128 | Chrome "Store icon" |
| Screenshot 1 (cover) | `screenshots/01-hero.png` | 1280x800 | Both, upload first |
| Screenshot 2 | `screenshots/02-options.png` | 1280x800 | Both |
| Screenshot 3 | `screenshots/03-popup.png` | 1280x800 | Both |
| Screenshot 4 | `screenshots/04-privacy.png` | 1280x800 | Both |
| Small promo tile | `promo/promo-small-440x280.png` | 440x280 | Chrome small promo tile; Edge small promotional tile |
| Marquee / large tile | `promo/promo-marquee-1400x560.png` | 1400x560 | Chrome marquee; Edge large promotional tile |
| Package | `../dist/link-sweepr-1.2.0.zip` | - | Upload as the extension package |

Screenshot counts: Chrome takes 1 to 5, Edge takes up to 6. All four here work for both.

---

## Submission notes

- The same package zip goes to both stores with no manifest edits. The manifest name and description are browser-neutral (no "Chrome" branding), which Edge requires.
- There is no `update_url` in the manifest, which both stores require for store-hosted extensions.
- Edge certification takes up to 7 business days. Chrome review runs from a few days to a few weeks.
- Chrome Web Store: approved and live (v1.2.0) at `https://chrome.google.com/webstore/detail/flebgmilmmjcmkdkkemacmgkbcoholok`. The site and README buttons now point to it. Swap in the slug-based canonical URL from the developer dashboard if you prefer it.
- Microsoft Edge: Edge installs Chrome Web Store extensions directly, so the CWS listing already covers Edge users, and the site presents both browsers off that one listing. A dedicated Microsoft Edge Add-ons listing is optional and can be added later for discoverability inside the Edge store; the assets in `store/` are browser-neutral and ready if you decide to submit one.
