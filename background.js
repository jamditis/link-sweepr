// Removes visits to blocked domains from history the moment they are recorded.
// The domain list lives in chrome.storage.local (key: "blockedDomains"),
// edited from the options page. A blocked domain also matches its subdomains
// and every path under it.

async function getDomains() {
  const { blockedDomains } = await chrome.storage.local.get("blockedDomains");
  return Array.isArray(blockedDomains) ? blockedDomains : [];
}

// Normalize a user-entered pattern: lowercase, strip scheme, "www.",
// leading "*." or ".", and any path so "https://www.Example.com/x" -> "example.com".
function normalizeDomain(input) {
  let d = String(input).trim().toLowerCase();
  if (!d) return "";
  d = d.replace(/^https?:\/\//, "");
  d = d.replace(/\/.*$/, "");
  d = d.replace(/^\*\./, "").replace(/^\./, "");
  d = d.replace(/^www\./, "");
  return d;
}

function hostMatches(hostname, domain) {
  hostname = hostname.toLowerCase();
  return hostname === domain || hostname.endsWith("." + domain);
}

function isBlocked(url, domains) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return domains.some((d) => d && hostMatches(host, d));
}

// Delete any existing history entries for the given domains (past visits).
async function sweep(domains) {
  const clean = domains.map(normalizeDomain).filter(Boolean);
  if (clean.length === 0) return;
  for (const domain of clean) {
    const results = await chrome.history.search({
      text: domain,
      startTime: 0,
      maxResults: 100000,
    });
    for (const item of results) {
      if (isBlocked(item.url, clean)) {
        await chrome.history.deleteUrl({ url: item.url });
      }
    }
  }
}

// Going forward: catch each new visit as it is written and remove it.
chrome.history.onVisited.addListener(async (item) => {
  const domains = (await getDomains()).map(normalizeDomain).filter(Boolean);
  if (isBlocked(item.url, domains)) {
    await chrome.history.deleteUrl({ url: item.url });
  }
});

// Clear existing history for the list on install and on browser startup.
chrome.runtime.onInstalled.addListener(async () => sweep(await getDomains()));
chrome.runtime.onStartup.addListener(async () => sweep(await getDomains()));

// When the list changes, immediately clear existing history for it.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.blockedDomains) {
    sweep(changes.blockedDomains.newValue || []);
  }
});
