// Shared domain helpers used in three places, so the options-page preview and
// the popup's block action normalize a domain exactly the way the sweep matches
// it:
//   - the service worker, via importScripts("domain.js")
//   - the options and popup pages, via <script src="domain.js">
//   - the Node tests, via require("./domain.js")
// In the worker and pages the functions attach to the global; in Node they are
// also exported through module.exports.
(function (root) {
  // Normalize a user-entered pattern to a lowercase ASCII (punycode) host.
  // Routes the value through the URL parser so "https://www.Ex*mple.com/x"
  // becomes the canonical host used in the history database, then strips a
  // leading "*." or "." wildcard and "www." The strips run after parsing so a
  // schemed input like "https://*.example.com" reduces to "example.com" rather
  // than leaving the wildcard on the host.
  function normalizeDomain(input) {
    const value = String(input).trim().toLowerCase();
    if (!value) return "";
    let host;
    try {
      host = new URL(value.includes("://") ? value : "http://" + value).hostname;
    } catch {
      return "";
    }
    const stripped = host
      .replace(/^\*\./, "")
      .replace(/^\./, "")
      .replace(/^www\./, "");
    // A real host (after punycode) holds only letters, digits, dots, hyphens,
    // and underscores; an IPv6 literal arrives bracketed ("[::1]") from URL
    // parsing, so ":" and "[]" are allowed too. Chromium's URL parser
    // percent-encodes spaces and other junk into the host instead of throwing the
    // way Node does ("not a domain" becomes "not%20a%20domain"); that junk always
    // carries "%", which is outside this set, so gating on it rejects the junk
    // while keeping behavior identical across the worker, the pages, and the tests.
    return /^[a-z0-9._:[\]-]+$/.test(stripped) ? stripped : "";
  }

  // A blocked domain matches itself and any subdomain, but not a lookalike
  // (host "notreddit.com" does not match domain "reddit.com").
  function hostMatchesDomain(host, domain) {
    return host === domain || host.endsWith("." + domain);
  }

  // True when a host is, or is a subdomain of, any blocked domain. The single
  // matching path used by the worker's sweep, urlIsBlocked, and the popup, so
  // "is this site covered" means the same thing everywhere.
  function hostIsBlocked(host, domains) {
    return domains.some((domain) => hostMatchesDomain(host, domain));
  }

  // True when a URL's host is, or is a subdomain of, any blocked domain.
  function urlIsBlocked(url, domains) {
    let host;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      return false;
    }
    return hostIsBlocked(host, domains);
  }

  // The domain to block for a browser tab, or "" if the tab is not an ordinary
  // web page. Internal pages (chrome://, edge://, about:) parse to a bogus host
  // like "extensions", so only http(s) URLs yield a blockable domain.
  function blockableHost(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return "";
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return normalizeDomain(parsed.hostname);
  }

  // Add a domain to a list, comparing by normalized form so no duplicate shape
  // slips in. Returns the (possibly unchanged) list and what happened.
  function addBlockedDomain(list, host) {
    const domain = normalizeDomain(host);
    if (!domain) return { list, status: "invalid", domain: "" };
    const seen = new Set(list.map(normalizeDomain).filter(Boolean));
    if (seen.has(domain)) return { list, status: "exists", domain };
    return { list: [...list, domain], status: "added", domain };
  }

  // Split raw input lines into the distinct domains that will be filtered (by
  // normalized form, first occurrence wins) and the non-empty lines that resolve
  // to nothing. Blank lines are skipped entirely. Drives the options preview and
  // the popup count so both agree on what "filtered" means.
  function partitionDomains(lines) {
    const domains = [];
    const seen = new Set();
    const ignored = [];
    for (const raw of lines) {
      const line = String(raw).trim();
      if (!line) continue;
      const domain = normalizeDomain(line);
      if (!domain) {
        ignored.push(line);
      } else if (!seen.has(domain)) {
        seen.add(domain);
        domains.push(domain);
      }
    }
    return { domains, ignored };
  }

  // Union of two domain lists, deduped by normalized form. Existing entries are
  // kept verbatim; only incoming lines whose normalized form is new are appended
  // (lowercased), so an import merges without dropping or reordering what is
  // already there. Returns the merged list and how many were newly added.
  function mergeDomainLists(existing, incoming) {
    const list = existing.map((line) => String(line));
    const seen = new Set(list.map(normalizeDomain).filter(Boolean));
    let added = 0;
    for (const line of incoming) {
      const raw = String(line).trim();
      const key = normalizeDomain(raw);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      list.push(raw.toLowerCase());
      added++;
    }
    return { list, added };
  }

  root.normalizeDomain = normalizeDomain;
  root.hostMatchesDomain = hostMatchesDomain;
  root.hostIsBlocked = hostIsBlocked;
  root.urlIsBlocked = urlIsBlocked;
  root.blockableHost = blockableHost;
  root.addBlockedDomain = addBlockedDomain;
  root.partitionDomains = partitionDomains;
  root.mergeDomainLists = mergeDomainLists;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      normalizeDomain,
      hostMatchesDomain,
      hostIsBlocked,
      urlIsBlocked,
      blockableHost,
      addBlockedDomain,
      partitionDomains,
      mergeDomainLists,
    };
  }
})(typeof self !== "undefined" ? self : globalThis);
