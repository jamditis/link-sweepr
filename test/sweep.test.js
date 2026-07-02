// Unit tests for the history filter's core logic: domain normalization, host
// matching, and the paginated sweep. A chrome.history mock is installed on the
// global before the service worker is required, so the real background.js code
// under test runs unchanged.
const test = require("node:test");
const assert = require("node:assert/strict");

// The service worker registers listeners against chrome.* at load, so a mock
// must exist before it is required. These stubs are no-ops; the history methods
// are replaced per test by historyStore().
const noop = () => {};
// Capture the worker's storage.onChanged listeners so a test can drive them and
// assert which key triggers a sweep.
const onChangedListeners = [];
global.chrome = {
  history: {
    onVisited: { addListener: noop },
    search: async () => [],
    deleteUrl: async () => {},
  },
  webNavigation: {
    onHistoryStateUpdated: { addListener: noop },
    onReferenceFragmentUpdated: { addListener: noop },
  },
  runtime: {
    onInstalled: { addListener: noop },
    onStartup: { addListener: noop },
  },
  storage: {
    local: { get: async () => ({}) },
    onChanged: { addListener: (fn) => onChangedListeners.push(fn) },
  },
  alarms: { create: noop, onAlarm: { addListener: noop } },
};

// The service worker pulls its domain helpers in with importScripts("domain.js").
// Node has no importScripts, so load that module's exports onto the global (where
// the worker reaches them) and stub the call to a no-op before requiring it.
Object.assign(global, require("../domain.js"));
global.importScripts = () => {};

const bg = require("../background.js");

// Back the chrome.history mock with a mutable item store. search honors the real
// contract: results in the [startTime, endTime) window whose url or title
// contains the text, newest first (id ascending as a stable tiebreak), capped at
// maxResults. deleteUrl removes every visit to that url, as Chrome does, and
// records it so a test can assert exactly what was deleted.
function historyStore(items) {
  let store = items.map((it) => ({ title: "", ...it }));
  const deleted = [];
  global.chrome.history.search = async ({
    text = "",
    startTime = 0,
    endTime = Infinity,
    maxResults = 100,
  }) => {
    const needle = text.toLowerCase();
    return store
      .filter((it) => it.lastVisitTime >= startTime && it.lastVisitTime < endTime)
      .filter(
        (it) =>
          needle === "" || (it.url + " " + it.title).toLowerCase().includes(needle)
      )
      .sort((a, b) => b.lastVisitTime - a.lastVisitTime || a.id - b.id)
      .slice(0, maxResults)
      .map((it) => ({
        id: it.id,
        url: it.url,
        lastVisitTime: it.lastVisitTime,
        title: it.title,
      }));
  };
  global.chrome.history.deleteUrl = async ({ url }) => {
    deleted.push(url);
    store = store.filter((it) => it.url !== url);
  };
  return { deleted, remaining: () => store };
}

test("normalizeDomain collapses every input shape to the bare host", () => {
  const cases = [
    ["https://*.example.com", "example.com"], // scheme + wildcard (the 5.5 bug)
    ["https://.example.com", "example.com"], // scheme + leading dot
    ["http://*.example.com", "example.com"],
    ["*.example.com", "example.com"],
    [".example.com", "example.com"],
    ["https://www.Example.com/path?q=1", "example.com"],
    ["reddit.com", "reddit.com"],
    ["OLD.Reddit.com", "old.reddit.com"], // subdomains preserved
    ["exämple.com", "xn--exmple-cua.com"], // Unicode to punycode
    ["https://www.xn--exmple-cua.com", "xn--exmple-cua.com"], // already punycode
    ["under_score.com", "under_score.com"], // underscore host is kept
    ["[::1]", "[::1]"], // IPv6 loopback literal, kept bracketed
    ["http://[2001:db8::1]/path", "[2001:db8::1]"], // IPv6 literal with scheme/path
    ["   ", ""],
    // Chromium percent-encodes spaces into the host rather than throwing the way
    // Node does; the charset gate rejects the result in both runtimes.
    ["not a domain", ""],
    ["a b.com", ""],
    ["http:// bad", ""],
  ];
  for (const [input, want] of cases) {
    assert.equal(
      bg.normalizeDomain(input),
      want,
      `normalizeDomain(${JSON.stringify(input)})`
    );
  }
});

test("urlIsBlocked matches host, subdomains and paths but not lookalikes", () => {
  const domains = ["reddit.com"];
  assert.equal(bg.urlIsBlocked("https://reddit.com/", domains), true);
  assert.equal(bg.urlIsBlocked("https://reddit.com/r/x?y=1", domains), true);
  assert.equal(bg.urlIsBlocked("https://old.reddit.com/r/x", domains), true);
  assert.equal(bg.urlIsBlocked("https://notreddit.com/", domains), false);
  assert.equal(bg.urlIsBlocked("https://reddit.com.evil.test/", domains), false);
  assert.equal(bg.urlIsBlocked("not a url", domains), false);

  // IPv6 literal hosts are matched exactly (no subdomain notion).
  assert.equal(bg.urlIsBlocked("http://[::1]/dash", ["[::1]"]), true);
  assert.equal(bg.urlIsBlocked("http://[2001:db8::1]/", ["[2001:db8::1]"]), true);
  assert.equal(bg.urlIsBlocked("http://[2001:db8::2]/", ["[2001:db8::1]"]), false);
});

test("sweep deletes matching history and leaves everything else", async () => {
  const { deleted, remaining } = historyStore([
    { id: 1, url: "https://reddit.com/", lastVisitTime: 5000 },
    { id: 2, url: "https://old.reddit.com/r/x", lastVisitTime: 4000 },
    { id: 3, url: "https://reddit.com/r/y?z=1", lastVisitTime: 3000 },
    { id: 4, url: "https://notreddit.com/", lastVisitTime: 2500 }, // text hit, host no
    { id: 5, url: "https://example.org/reddit.com", lastVisitTime: 2000 }, // path hit, host no
    { id: 6, url: "https://example.org/", lastVisitTime: 1000 },
  ]);

  await bg.sweep(["reddit.com"]);

  assert.deepEqual(deleted.slice().sort(), [
    "https://old.reddit.com/r/x",
    "https://reddit.com/",
    "https://reddit.com/r/y?z=1",
  ]);
  assert.deepEqual(
    remaining()
      .map((it) => it.url)
      .sort(),
    ["https://example.org/", "https://example.org/reddit.com", "https://notreddit.com/"]
  );
});

test("sweep drains a same-timestamp collision larger than one page", async () => {
  const N = 2500; // greater than the 1000-row page size
  const items = [];
  for (let i = 1; i <= N; i++) {
    items.push({ id: i, url: `https://example.com/${i}`, lastVisitTime: 1000 });
  }
  // Unrelated rows that must survive, including one sharing the timestamp.
  items.push({ id: N + 1, url: "https://keep.test/", lastVisitTime: 1000 });
  items.push({ id: N + 2, url: "https://another.test/", lastVisitTime: 900 });

  const { deleted, remaining } = historyStore(items);

  await bg.sweep(["example.com"]);

  assert.equal(deleted.length, N, `expected ${N} deletions, got ${deleted.length}`);
  assert.deepEqual(
    remaining()
      .map((it) => it.url)
      .sort(),
    ["https://another.test/", "https://keep.test/"]
  );
});

test("sweep deletes future-dated history rows", async () => {
  // A visit timestamped in the future (clock skew or imported history) sorts to
  // the top of history. Capping the first page at the wall clock would never
  // reach it, so the sweep must start from the maximum time value.
  const FUTURE = 4102444800000; // 2100-01-01, safely beyond any real "now"
  const { deleted, remaining } = historyStore([
    { id: 1, url: "https://example.com/future", lastVisitTime: FUTURE },
    { id: 2, url: "https://example.com/past", lastVisitTime: 1000 },
    { id: 3, url: "https://example.org/", lastVisitTime: 2000 },
  ]);

  await bg.sweep(["example.com"]);

  assert.deepEqual(deleted.slice().sort(), [
    "https://example.com/future",
    "https://example.com/past",
  ]);
  assert.deepEqual(
    remaining().map((it) => it.url),
    ["https://example.org/"]
  );
});

test("sweep normalizes raw domain shapes before searching", async () => {
  // A caller may pass an unnormalized shape (scheme + wildcard). sweep must
  // reduce it to the bare host, or the text search and host match find nothing.
  const { deleted, remaining } = historyStore([
    { id: 1, url: "https://example.com/", lastVisitTime: 3000 },
    { id: 2, url: "https://sub.example.com/x", lastVisitTime: 2000 },
    { id: 3, url: "https://example.org/", lastVisitTime: 1000 },
  ]);

  await bg.sweep(["https://*.example.com"]);

  assert.deepEqual(deleted.slice().sort(), [
    "https://example.com/",
    "https://sub.example.com/x",
  ]);
  assert.deepEqual(
    remaining().map((it) => it.url),
    ["https://example.org/"]
  );
});

test("sweepDomain ignores a non-numeric lastVisitTime when paging", async () => {
  // A row reporting no lastVisitTime sits inside a full first page; more rows
  // sit below it. Treating the missing time as 0 would collapse the window and
  // skip the lower rows, so paging must ignore non-numeric times for the window
  // while still deleting the row itself. `sortKey` is the mock's own ordering;
  // the returned row keeps its real (here missing) lastVisitTime.
  const rows = [];
  for (let i = 1; i <= 999; i++) {
    rows.push({ id: i, sortKey: 5000, url: `https://example.com/a${i}`, lastVisitTime: 5000 });
  }
  rows.push({ id: 1000, sortKey: 5000, url: "https://example.com/missing" }); // no lastVisitTime
  for (let i = 1; i <= 10; i++) {
    rows.push({ id: 1000 + i, sortKey: 4000, url: `https://example.com/b${i}`, lastVisitTime: 4000 });
  }

  let store = rows.slice();
  const deleted = new Set();
  global.chrome.history.search = async ({ startTime = 0, endTime = Infinity, maxResults = 100 }) => {
    return store
      .filter((r) => r.sortKey >= startTime && r.sortKey < endTime)
      .sort((a, b) => b.sortKey - a.sortKey || a.id - b.id)
      .slice(0, maxResults)
      .map((r) => ({ id: r.id, url: r.url, lastVisitTime: r.lastVisitTime }));
  };
  global.chrome.history.deleteUrl = async ({ url }) => {
    deleted.add(url);
    store = store.filter((r) => r.url !== url);
  };

  await bg.sweepDomain("example.com", ["example.com"]);

  assert.equal(deleted.size, 1010, `expected 1010 deletions, got ${deleted.size}`);
  assert.ok(
    deleted.has("https://example.com/b10"),
    "rows below the missing-timestamp row must still be deleted"
  );
});

test("only a sweepRequest change sweeps; a list write alone does not", async () => {
  // The list is saved on every keystroke, so a list change must not sweep (it
  // would rescan history on every partial edit). The UI writes sweepRequest once
  // the list settles, and only that triggers the existing-history sweep.
  const { deleted } = historyStore([
    { id: 1, url: "https://reddit.com/", lastVisitTime: 3000 },
    { id: 2, url: "https://example.org/", lastVisitTime: 2000 },
  ]);
  // The worker reads the current list from storage when it sweeps.
  global.chrome.storage.local.get = async () => ({ blockedDomains: ["reddit.com"] });

  const fire = (changes) =>
    Promise.all(onChangedListeners.map((fn) => fn(changes, "local")));

  await fire({ blockedDomains: { newValue: ["reddit.com"] } });
  assert.deepEqual(deleted, [], "a list-only change must not sweep");

  await fire({ sweepRequest: { newValue: 1 } });
  assert.deepEqual(deleted, ["https://reddit.com/"], "a sweepRequest change sweeps");

  // Restore the default so later tests are unaffected.
  global.chrome.storage.local.get = async () => ({});
});
