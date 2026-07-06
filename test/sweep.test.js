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
// Capture the worker's storage.onChanged, runtime.onMessage, commands, install,
// and context-menu listeners so a test can drive them and assert which key
// triggers a sweep, what the popup's count request replies, and that the shortcut
// and menu block the active tab.
const onChangedListeners = [];
const messageListeners = [];
const commandListeners = [];
const menuClickListeners = [];
const installedListeners = [];
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
    onInstalled: { addListener: (fn) => installedListeners.push(fn) },
    onStartup: { addListener: noop },
    onMessage: { addListener: (fn) => messageListeners.push(fn) },
  },
  storage: {
    local: { get: async () => ({}), set: async () => {} },
    onChanged: { addListener: (fn) => onChangedListeners.push(fn) },
  },
  alarms: { create: noop, onAlarm: { addListener: noop } },
  commands: { onCommand: { addListener: (fn) => commandListeners.push(fn) } },
  contextMenus: {
    // Model the pre-Chrome-123 callback-only API: removeAll invokes the callback
    // and returns undefined, never a promise. A .then()-on-the-return
    // implementation of ensureBlockMenu would throw here, so the "install
    // registers the menu" test below is a real regression guard for that.
    removeAll: (cb) => {
      if (cb) cb();
      return undefined;
    },
    create: noop,
    onClicked: { addListener: (fn) => menuClickListeners.push(fn) },
  },
  tabs: { query: async () => [] },
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
        visitCount: it.visitCount,
      }));
  };
  global.chrome.history.deleteUrl = async ({ url }) => {
    deleted.push(url);
    store = store.filter((it) => it.url !== url);
  };
  return { deleted, remaining: () => store };
}

// Back chrome.storage.local with a real object so blockUrlDomain can read the list
// and write the updated one. get honors the single-key form the worker uses;
// returns the backing object so a test can assert what was written.
function storageStore(initial = {}) {
  const data = { ...initial };
  global.chrome.storage.local.get = async (key) =>
    typeof key === "string" ? (key in data ? { [key]: data[key] } : {}) : { ...data };
  global.chrome.storage.local.set = async (obj) => {
    Object.assign(data, obj);
  };
  return data;
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

test("the session counter tracks visits removed, not just URLs", async () => {
  bg.resetSweptCount();
  // deleteUrl removes every visit to a URL, so a row visited several times counts
  // for all of them; a row with no visitCount counts as one.
  const { deleted } = historyStore([
    { id: 1, url: "https://reddit.com/", lastVisitTime: 3000, visitCount: 4 },
    { id: 2, url: "https://old.reddit.com/r/x", lastVisitTime: 2000 }, // no visitCount
    { id: 3, url: "https://example.org/", lastVisitTime: 1000, visitCount: 9 }, // not blocked
  ]);

  await bg.sweep(["reddit.com"]);

  assert.equal(deleted.length, 2, "two URLs removed");
  assert.equal(bg.getSweptCount(), 5, "4 visits + 1 fallback = 5 entries counted");
});

test("a live blocked visit counts its visits, an unblocked one does not", async () => {
  bg.resetSweptCount();
  const { deleted } = historyStore([]); // deleteUrl records what it was asked to remove
  global.chrome.storage.local.get = async () => ({ blockedDomains: ["reddit.com"] });

  // No visit count known (an SPA navigation) falls back to one.
  await bg.deleteUrlIfBlocked("https://old.reddit.com/r/x");
  assert.deepEqual(deleted, ["https://old.reddit.com/r/x"]);
  assert.equal(bg.getSweptCount(), 1);

  // onVisited supplies a count, and deleteUrl removes all of those visits at once.
  await bg.deleteUrlIfBlocked("https://reddit.com/", undefined, 3);
  assert.equal(bg.getSweptCount(), 4, "1 + 3 visits removed");

  await bg.deleteUrlIfBlocked("https://example.org/", undefined, 5); // not blocked
  assert.equal(bg.getSweptCount(), 4, "an unblocked visit neither deletes nor counts");

  global.chrome.storage.local.get = async () => ({});
});

test("getSweepCount message replies with the count; other messages are ignored", async () => {
  bg.resetSweptCount();
  historyStore([{ id: 1, url: "https://reddit.com/", lastVisitTime: 1000 }]);
  await bg.sweep(["reddit.com"]);

  let reply;
  const respond = (value) => (reply = value);

  for (const fn of messageListeners) fn({ type: "getSweepCount" }, {}, respond);
  assert.deepEqual(reply, { count: 1 }, "the popup's request gets the live count");

  reply = undefined;
  for (const fn of messageListeners) fn({ type: "somethingElse" }, {}, respond);
  assert.equal(reply, undefined, "an unrelated message draws no response");

  global.chrome.history.deleteUrl = async () => {};
});

test("blockUrlDomain adds a new domain and requests a sweep", async () => {
  const store = storageStore({ blockedDomains: ["example.org"] });

  const res = await bg.blockUrlDomain("https://www.reddit.com/r/x");

  assert.equal(res.status, "added");
  assert.equal(res.host, "reddit.com", "www. is normalized off the host");
  assert.deepEqual(store.blockedDomains, ["example.org", "reddit.com"]);
  assert.equal(typeof store.sweepRequest, "number", "a sweep was requested");
});

test("blockUrlDomain no-ops on internal and non-web pages", async () => {
  const store = storageStore({ blockedDomains: ["example.org"] });

  for (const url of [
    "chrome://extensions",
    "edge://settings",
    "about:blank",
    "file:///tmp/x.html",
    "not a url",
    "",
  ]) {
    const res = await bg.blockUrlDomain(url);
    assert.equal(res.status, "unblockable", url);
  }

  assert.deepEqual(store.blockedDomains, ["example.org"], "list unchanged");
  assert.equal(store.sweepRequest, undefined, "no sweep requested");
});

test("blockUrlDomain skips a domain already covered by the list", async () => {
  const store = storageStore({ blockedDomains: ["reddit.com"] });

  // Exact match is already covered.
  let res = await bg.blockUrlDomain("https://reddit.com/");
  assert.equal(res.status, "covered");

  // A subdomain of a listed parent is covered too - the same suffix-aware skip the
  // popup applies, so the sweep already removes it and nothing is added.
  res = await bg.blockUrlDomain("https://old.reddit.com/r/x");
  assert.equal(res.status, "covered");

  assert.deepEqual(store.blockedDomains, ["reddit.com"], "nothing added");
  assert.equal(store.sweepRequest, undefined, "no redundant sweep");
});

test("the keyboard command blocks the active tab's domain", async () => {
  const store = storageStore({ blockedDomains: [] });
  global.chrome.tabs.query = async () => [
    { url: "https://news.ycombinator.com/item?id=1" },
  ];

  for (const fn of commandListeners) await fn("block-current-site");
  assert.deepEqual(store.blockedDomains, ["news.ycombinator.com"]);

  // An unrelated command name does nothing.
  global.chrome.tabs.query = async () => [{ url: "https://example.com/" }];
  for (const fn of commandListeners) await fn("some-other-command");
  assert.deepEqual(
    store.blockedDomains,
    ["news.ycombinator.com"],
    "only the block command blocks"
  );
});

test("the context menu blocks the page it was opened on", async () => {
  const store = storageStore({ blockedDomains: [] });

  const info = { menuItemId: "block-current-site", pageUrl: "https://twitter.com/home" };
  for (const fn of menuClickListeners) await fn(info, { url: "https://twitter.com/home" });
  assert.deepEqual(store.blockedDomains, ["twitter.com"]);

  // A click on a different menu item is ignored.
  const other = { menuItemId: "something-else", pageUrl: "https://example.com/" };
  for (const fn of menuClickListeners) await fn(other, {});
  assert.deepEqual(store.blockedDomains, ["twitter.com"], "only our item blocks");
});

test("two rapid worker blocks both land (serialized queue, no stale overwrite)", async () => {
  const store = storageStore({ blockedDomains: [] });

  // Fire two blocks without awaiting between them. blockQueue must serialize the
  // read-modify-write so the second reads the first's result rather than the empty
  // list it started from - otherwise the later write would drop the earlier host.
  const [a, b] = await Promise.all([
    bg.blockUrlDomain("https://a.example/"),
    bg.blockUrlDomain("https://b.example/"),
  ]);

  assert.equal(a.status, "added");
  assert.equal(b.status, "added");
  assert.deepEqual(store.blockedDomains.slice().sort(), ["a.example", "b.example"]);
});

test("same-millisecond worker blocks write distinct sweep tokens", async () => {
  storageStore({ blockedDomains: [] });
  const tokens = [];
  const realSet = global.chrome.storage.local.set;
  global.chrome.storage.local.set = async (obj) => {
    if ("sweepRequest" in obj) tokens.push(obj.sweepRequest);
    return realSet(obj);
  };
  // Freeze the clock so both blocks see the same millisecond; the monotonic token,
  // not the wall clock, must keep the two writes distinct so storage.onChanged
  // fires for each and both new domains get swept.
  const realNow = Date.now;
  Date.now = () => 1000;
  try {
    await Promise.all([
      bg.blockUrlDomain("https://a.example/"),
      bg.blockUrlDomain("https://b.example/"),
    ]);
  } finally {
    Date.now = realNow;
    global.chrome.storage.local.set = realSet;
  }

  assert.equal(tokens.length, 2, "both blocks requested a sweep");
  assert.notEqual(tokens[0], tokens[1], "distinct tokens despite the shared millisecond");
});

test("install registers the context-menu item within the event lifetime", async () => {
  storageStore({ blockedDomains: [] });
  const created = [];
  global.chrome.contextMenus.create = (props) => created.push(props);

  // Drive onInstalled and await it, as the runtime does. The menu create must have
  // run by the time the handler resolves - not be left dangling in a removeAll
  // callback the worker might outlive.
  for (const fn of installedListeners) await fn({ reason: "install" });

  assert.equal(created.length, 1, "one menu item created");
  assert.equal(created[0].id, "block-current-site");
  assert.deepEqual(created[0].contexts, ["page"]);
  assert.deepEqual(created[0].documentUrlPatterns, ["http://*/*", "https://*/*"]);
});
