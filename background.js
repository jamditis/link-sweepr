// Removes visits to blocked domains from browsing history.
//
// The domain list lives in chrome.storage.local (key: "blockedDomains"), edited
// from the options page. A blocked domain also matches its subdomains and every
// path under it. Matching is suffix-based against the user-entered domain, so no
// Public Suffix List is required; hosts are normalized to ASCII (punycode) first
// so Unicode and xn-- forms compare equal.
//
// Coverage comes from three sources, all registered synchronously at the top
// level so the MV3 service worker can be woken to dispatch them:
//   1. history.onVisited                     - ordinary page loads and redirects
//   2. webNavigation.onHistoryStateUpdated   - SPA pushState/replaceState URLs
//      and webNavigation.onReferenceFragmentUpdated for #fragment changes
//   3. a periodic alarm + startup/install/list-change sweeps - a backstop that
//      clears anything a wake race missed, and existing history for new domains.
//
// Domain normalization and matching live in domain.js, shared with the options
// and popup pages so their preview and block action agree with the sweep.

importScripts("domain.js");

const STORAGE_KEY = "blockedDomains";
// A separate key the UI writes to request an existing-history sweep. The list
// (STORAGE_KEY) is written on every keystroke so no edit is lost, but sweeping on
// each partial edit would rescan all history repeatedly (a text search for "r"
// matches nearly every row). So the list write does not trigger a sweep; the UI
// writes this token once the list settles, and the worker sweeps on it with an
// await, which keeps the worker alive until the sweep finishes.
const SWEEP_REQUEST_KEY = "sweepRequest";
const SWEEP_ALARM = "history-filter-resweep";
const SWEEP_PERIOD_MINUTES = 30;
const SEARCH_PAGE_SIZE = 1000;
// Id of the page context-menu item that blocks the current site. Also the command
// name declared in manifest.json for the keyboard shortcut.
const BLOCK_MENU_ID = "block-current-site";
const BLOCK_COMMAND = "block-current-site";

// Upper bound for the first history query. history.search excludes rows at or
// after endTime, and a visit can carry a future lastVisitTime (system clock
// correction, or history imported or synced from another machine), so the
// window must start above any real timestamp rather than at the wall clock.
// This is the maximum ECMAScript time value; no visit can exceed it.
const MAX_HISTORY_TIME = 8640000000000000;

// How many history entries this worker has removed since it started, shown in the
// popup as visible feedback that the extension is working. In-memory only and
// deliberately never written to storage: it may reset when the MV3 service worker
// is torn down, which is acceptable and preferable to persisting anything. It
// holds only an integer - no URLs, domains, or timestamps - so it keeps the
// listing's promise that nothing beyond the domain list is stored.
let sweptCount = 0;

async function getNormalizedDomains() {
  let stored;
  try {
    stored = await chrome.storage.local.get(STORAGE_KEY);
  } catch {
    return [];
  }
  const list = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
  return list.map(normalizeDomain).filter(Boolean);
}

// Serialize the worker's own list writes (the keyboard shortcut and the context
// menu) through one chain, the same guard the options page uses for its writes: a
// slower earlier write can never land after a newer one and overwrite it, so two
// rapid blocks both land. This chain orders only the writes made here in the
// worker; coordinating with the popup's and options page's own writes is the
// separate, pre-existing cross-context race tracked in issue #12.
let blockQueue = Promise.resolve();

// A strictly increasing sweep-request token. storage.onChanged fires only when the
// value actually changes, so two blocks in the same millisecond writing a bare
// Date.now() would collide and the second would not trigger a sweep. Seeding from
// the clock keeps the value a meaningful timestamp; the +1 floor guarantees each
// worker write differs from the last, so every back-to-back block sweeps.
let lastSweepToken = 0;
function nextSweepToken() {
  lastSweepToken = Math.max(Date.now(), lastSweepToken + 1);
  return lastSweepToken;
}

// Add a page's domain to the blocked list and request a history sweep. This is the
// one routine behind both the keyboard shortcut and the context menu, so the add
// logic lives in exactly one place and reuses domain.js the way the popup does.
// blockableHost returns "" for anything that is not an ordinary http(s) page, so
// this no-ops on chrome://, edge://, about: and other unfilterable URLs. A host
// already covered by the list (suffix-aware, via hostIsBlocked) is left as-is.
// Returns a promise resolving to what happened, so a caller or test can react.
function blockUrlDomain(url) {
  const host = blockableHost(url);
  if (!host) return Promise.resolve({ status: "unblockable", host: "" });
  blockQueue = blockQueue.then(async () => {
    let list = [];
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      if (Array.isArray(stored[STORAGE_KEY])) list = stored[STORAGE_KEY];
    } catch {
      return { status: "error", host };
    }
    // Suffix-aware skip, the same one the popup applies before it offers the
    // block: if a parent domain already on the list covers this host (reddit.com
    // covers old.reddit.com), the sweep already removes it, so adding the
    // subdomain would be redundant. This also covers the exact-match case.
    if (hostIsBlocked(host, partitionDomains(list).domains)) {
      return { status: "covered", host };
    }
    const { list: next, status } = addBlockedDomain(list, host);
    if (status !== "added") return { status, host };
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: next });
      // Ask the worker to clear existing history for the just-added domain. A
      // strictly increasing token (not a bare Date.now()) so two same-millisecond
      // blocks each fire storage.onChanged. The list write above lands first (this
      // chain is serialized), so the sweep reads the new list.
      await chrome.storage.local.set({ [SWEEP_REQUEST_KEY]: nextSweepToken() });
    } catch {
      return { status: "error", host };
    }
    return { status, host };
  });
  return blockQueue;
}

async function deleteUrlIfBlocked(url, domains, visitCount) {
  if (!url) return;
  try {
    const list = domains || (await getNormalizedDomains());
    if (list.length && urlIsBlocked(url, list)) {
      await chrome.history.deleteUrl({ url });
      // deleteUrl removes every visit to the URL, so count them all when the
      // caller knows the count (onVisited provides it, and can carry older visits
      // an earlier sweep missed or that were later synced in). A same-document
      // SPA navigation is a single visit, so it omits the count and falls back to
      // one.
      sweptCount += visitCount > 0 ? visitCount : 1;
    }
  } catch {
    // Storage or history can fail transiently (or the URL is already gone);
    // the periodic sweep is the backstop.
  }
}

// Delete every history entry that matches any blocked domain. Each domain is
// scanned on its own through history.search's text filter, so only that
// domain's candidate rows are read instead of the whole database; urlIsBlocked
// then re-checks the host and drops substring matches on unrelated URLs (a
// search for "reddit.com" also returns "notreddit.com"). Text search never
// misses a true match, because any host ending in the domain contains it.
async function sweep(domainsInput) {
  const raw = domainsInput || (await getNormalizedDomains());
  const domains = raw.map(normalizeDomain).filter(Boolean);
  if (!domains.length) return;
  for (const domain of domains) {
    try {
      await sweepDomain(domain, domains);
    } catch {
      // A transient history error on one domain shouldn't stop the others;
      // the periodic sweep retries.
    }
  }
}

// Page through the history rows that mention one domain, deleting matches.
// history.search has no cursor, so the window is paged by endTime: pinned to 0
// at the low end and moved to just past the oldest row seen (oldest + 1) so rows
// sharing that timestamp are re-included rather than skipped, with a Set of
// visit ids dropping the resulting overlap. If a full page sits entirely on one
// timestamp (more rows than a page can hold), the page grows until the query
// reaches past the collision, so no rows are lost.
async function sweepDomain(domain, domains) {
  const seen = new Set();
  let endTime = MAX_HISTORY_TIME;
  let pageSize = SEARCH_PAGE_SIZE;

  // Guard against a pathological loop if many rows share one timestamp.
  for (let guard = 0; guard < 100000; guard++) {
    const batch = await chrome.history.search({
      text: domain,
      startTime: 0,
      endTime,
      maxResults: pageSize,
    });
    if (batch.length === 0) break;

    let oldest = Infinity;
    for (const item of batch) {
      const visitTime =
        typeof item.lastVisitTime === "number" ? item.lastVisitTime : Infinity;
      if (visitTime < oldest) oldest = visitTime;

      if (item.id !== undefined) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
      }
      if (urlIsBlocked(item.url, domains)) {
        try {
          await chrome.history.deleteUrl({ url: item.url });
          // deleteUrl removes every visit to this URL at once, and search returns
          // one row per URL, so count the visits that row carried rather than one
          // per URL. This keeps the metric consistent with the live path, which
          // counts one per onVisited visit. visitCount is absent in some rows, so
          // fall back to one.
          sweptCount += item.visitCount > 0 ? item.visitCount : 1;
        } catch {
          // Ignore; the row may already be gone.
        }
      }
    }

    if (!Number.isFinite(oldest)) break;

    // A short page means every row mentioning this domain up to endTime is in.
    if (batch.length < pageSize) break;

    // Move the window just past the oldest row. Re-including that timestamp
    // (oldest + 1) keeps rows that share it from being skipped.
    const nextEnd = oldest + 1;
    if (nextEnd < endTime) {
      endTime = nextEnd;
      pageSize = SEARCH_PAGE_SIZE;
    } else {
      // The whole full page sits on a single timestamp, so the window cannot
      // advance. Grow the page to reach the rows beyond the collision.
      pageSize += SEARCH_PAGE_SIZE;
    }
    if (endTime <= 0) break;
  }
}

function ensureSweepAlarm() {
  chrome.alarms.create(SWEEP_ALARM, { periodInMinutes: SWEEP_PERIOD_MINUTES });
}

// Register the "block this domain" page context-menu item. removeAll first so a
// reinstall or update never trips over a duplicate id. documentUrlPatterns limits
// the item to http(s) pages, so it does not even appear on chrome:// or edge://
// pages; the keyboard shortcut, which can fire anywhere, is guarded separately in
// blockUrlDomain. Returns a promise (awaited from onInstalled) so the create call
// is part of the event's lifetime - otherwise the worker could shut down between
// removeAll and create and the menu would be missing until the next update.
function ensureBlockMenu() {
  return chrome.contextMenus.removeAll().then(() => {
    chrome.contextMenus.create({
      id: BLOCK_MENU_ID,
      title: "Block this domain in LinkSweepr",
      contexts: ["page"],
      documentUrlPatterns: ["http://*/*", "https://*/*"],
    });
  });
}

// --- Event registration (synchronous, top level) ---
//
// The addListener calls run synchronously so the MV3 service worker can be woken
// to dispatch them. Each callback awaits its async cleanup: the chained history
// and storage calls keep the worker active until the delete resolves instead of
// leaving it dangling after the callback returns. The cleanup helpers swallow
// their own transient errors, so awaiting them never leaves an unhandled
// rejection, and the periodic sweep is the backstop for any work a worker
// teardown still drops.

// Ordinary visits and redirect hops. Pass the row's visit count so the session
// counter reflects every visit deleteUrl removes, not just the one that fired.
chrome.history.onVisited.addListener(async (item) => {
  await deleteUrlIfBlocked(item.url, undefined, item.visitCount);
});

// Same-document SPA navigations, which persist in history but may not fire
// onVisited. Only the top frame (frameId 0) is recorded in history.
if (chrome.webNavigation) {
  const onSpaNavigation = async (details) => {
    if (details.frameId !== 0) return;
    await deleteUrlIfBlocked(details.url);
  };
  chrome.webNavigation.onHistoryStateUpdated.addListener(onSpaNavigation);
  chrome.webNavigation.onReferenceFragmentUpdated.addListener(onSpaNavigation);
}

// Clear existing history, arm the backstop alarm, and register the context-menu
// item on install and update. The menu persists across worker restarts, so only
// install/update needs to (re)create it.
chrome.runtime.onInstalled.addListener(async () => {
  ensureSweepAlarm();
  await ensureBlockMenu();
  await sweep();
});
chrome.runtime.onStartup.addListener(async () => {
  ensureSweepAlarm();
  await sweep();
});

// Clear existing history when the UI requests a sweep. The list write itself is
// deliberately not a trigger (see SWEEP_REQUEST_KEY): the options page writes the
// list on every keystroke but only requests a sweep once it settles, so this
// never runs on a half-typed domain. Awaiting the sweep keeps the worker alive
// until it finishes; the periodic alarm is the backstop if a request is missed.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === "local" && changes[SWEEP_REQUEST_KEY]) {
    await sweep();
  }
});

// Periodic backstop for anything a service-worker wake race missed.
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === SWEEP_ALARM) await sweep();
});

// The popup asks for the session sweep count to show visible feedback. The reply
// is synchronous, so this listener does not return true (no open response port).
// Sending the message is also what wakes a torn-down worker; the count it reports
// is therefore the total since that wake, which is the intended, non-persistent
// behavior.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "getSweepCount") {
    sendResponse({ count: sweptCount });
  }
});

// Keyboard shortcut (manifest commands): block the active tab's domain. activeTab
// is granted for the current tab when the user invokes the command, so the query
// can read its url without the broad "tabs" permission.
if (chrome.commands) {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== BLOCK_COMMAND) return;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) await blockUrlDomain(tab.url);
  });
}

// Right-click page menu: block the domain of the page the menu was opened on.
// info.pageUrl is the page's url; fall back to the tab's url just in case.
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== BLOCK_MENU_ID) return;
  const url = info.pageUrl || (tab && tab.url) || "";
  if (url) await blockUrlDomain(url);
});

// Exposed for Node unit tests. In the browser service worker `module` is
// undefined, so this block is skipped and has no effect on the extension.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    normalizeDomain,
    hostMatchesDomain,
    urlIsBlocked,
    sweep,
    sweepDomain,
    deleteUrlIfBlocked,
    getSweptCount: () => sweptCount,
    resetSweptCount: () => {
      sweptCount = 0;
    },
    blockUrlDomain,
  };
}
