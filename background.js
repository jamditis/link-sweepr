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

const STORAGE_KEY = "blockedDomains";
const SWEEP_ALARM = "history-filter-resweep";
const SWEEP_PERIOD_MINUTES = 30;
const SEARCH_PAGE_SIZE = 1000;

// Upper bound for the first history query. history.search excludes rows at or
// after endTime, and a visit can carry a future lastVisitTime (system clock
// correction, or history imported or synced from another machine), so the
// window must start above any real timestamp rather than at the wall clock.
// This is the maximum ECMAScript time value; no visit can exceed it.
const MAX_HISTORY_TIME = 8640000000000000;

// Normalize a user-entered pattern to a lowercase ASCII (punycode) host.
// Routes the value through the URL parser so "https://www.Exämple.com/x" becomes
// the canonical "xn--exmple-cua.com" form used in the history database, then
// strips a leading "*." or "." wildcard and "www." from the parsed host. The
// strips run after parsing so a schemed input like "https://*.example.com" is
// reduced to "example.com" rather than leaving the wildcard on the host.
function normalizeDomain(input) {
  const value = String(input).trim().toLowerCase();
  if (!value) return "";
  let host;
  try {
    host = new URL(value.includes("://") ? value : "http://" + value).hostname;
  } catch {
    return "";
  }
  return host
    .replace(/^\*\./, "")
    .replace(/^\./, "")
    .replace(/^www\./, "");
}

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

function hostMatchesDomain(host, domain) {
  return host === domain || host.endsWith("." + domain);
}

function urlIsBlocked(url, domains) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return domains.some((domain) => hostMatchesDomain(host, domain));
}

async function deleteUrlIfBlocked(url, domains) {
  if (!url) return;
  try {
    const list = domains || (await getNormalizedDomains());
    if (list.length && urlIsBlocked(url, list)) {
      await chrome.history.deleteUrl({ url });
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

// --- Event registration (synchronous, top level) ---
//
// The addListener calls run synchronously so the MV3 service worker can be woken
// to dispatch them. Each callback awaits its async cleanup: the chained history
// and storage calls keep the worker active until the delete resolves instead of
// leaving it dangling after the callback returns. The cleanup helpers swallow
// their own transient errors, so awaiting them never leaves an unhandled
// rejection, and the periodic sweep is the backstop for any work a worker
// teardown still drops.

// Ordinary visits and redirect hops.
chrome.history.onVisited.addListener(async (item) => {
  await deleteUrlIfBlocked(item.url);
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

// Clear existing history and arm the backstop alarm on install and startup.
chrome.runtime.onInstalled.addListener(async () => {
  ensureSweepAlarm();
  await sweep();
});
chrome.runtime.onStartup.addListener(async () => {
  ensureSweepAlarm();
  await sweep();
});

// When the list changes, immediately clear existing history for the new list.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === "local" && changes[STORAGE_KEY]) {
    const next = Array.isArray(changes[STORAGE_KEY].newValue)
      ? changes[STORAGE_KEY].newValue
      : [];
    await sweep(next.map(normalizeDomain).filter(Boolean));
  }
});

// Periodic backstop for anything a service-worker wake race missed.
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === SWEEP_ALARM) await sweep();
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
  };
}
