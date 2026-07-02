// Unit tests for the shared list helpers that back the popup and the options
// page: deriving a blockable domain from a tab URL, adding without duplicates,
// splitting input into filtered/ignored, and merging an imported list. Pure
// functions, so domain.js is required directly with no chrome mock.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  hostIsBlocked,
  blockableHost,
  addBlockedDomain,
  partitionDomains,
  mergeDomainLists,
} = require("../domain.js");

test("hostIsBlocked covers a host and its subdomains but not lookalikes", () => {
  const domains = ["reddit.com", "example.org"];
  assert.equal(hostIsBlocked("reddit.com", domains), true);
  // A subdomain is covered by its parent rule; the popup must treat it as
  // already filtered rather than offering to add a redundant entry.
  assert.equal(hostIsBlocked("old.reddit.com", domains), true);
  assert.equal(hostIsBlocked("news.ycombinator.com", domains), false);
  assert.equal(hostIsBlocked("notreddit.com", domains), false);
  assert.equal(hostIsBlocked("reddit.com.evil.test", domains), false);
});

test("blockableHost yields a domain only for ordinary web pages", () => {
  assert.equal(blockableHost("https://reddit.com/r/x"), "reddit.com");
  assert.equal(blockableHost("http://www.Example.com/path?q=1"), "example.com");
  assert.equal(blockableHost("https://old.reddit.com/"), "old.reddit.com");
  assert.equal(blockableHost("https://exämple.com/"), "xn--exmple-cua.com");
  // Internal and non-web schemes are not blockable, even though they parse.
  assert.equal(blockableHost("chrome://extensions"), "");
  assert.equal(blockableHost("edge://settings/privacy"), "");
  assert.equal(blockableHost("about:blank"), "");
  assert.equal(blockableHost("file:///C:/tmp/x.html"), "");
  assert.equal(blockableHost("not a url"), "");
  assert.equal(blockableHost(""), "");
});

test("addBlockedDomain adds once and reports status without mutating input", () => {
  const list = ["reddit.com"];

  const added = addBlockedDomain(list, "https://www.twitter.com/home");
  assert.equal(added.status, "added");
  assert.equal(added.domain, "twitter.com");
  assert.deepEqual(added.list, ["reddit.com", "twitter.com"]);

  // Same site in a different shape is a duplicate by normalized form.
  const dup = addBlockedDomain(list, "https://www.reddit.com/");
  assert.equal(dup.status, "exists");
  assert.equal(dup.domain, "reddit.com");
  assert.deepEqual(dup.list, ["reddit.com"]);

  const bad = addBlockedDomain(list, "about:blank");
  assert.equal(bad.status, "invalid");

  assert.deepEqual(list, ["reddit.com"], "input list must not be mutated");
});

test("partitionDomains splits into distinct filtered domains and ignored lines", () => {
  const { domains, ignored } = partitionDomains([
    "reddit.com",
    "  ",
    "https://www.Reddit.com/r/x", // duplicate of reddit.com by normalized form
    "OLD.reddit.com",
    "not a domain", // has a space, resolves to nothing
    "twitter.com",
  ]);
  assert.deepEqual(domains, ["reddit.com", "old.reddit.com", "twitter.com"]);
  assert.deepEqual(ignored, ["not a domain"]);
});

test("mergeDomainLists appends only new domains and keeps existing verbatim", () => {
  const existing = ["Reddit.com", "twitter.com"];
  const incoming = [
    "twitter.com", // already present
    "https://www.reddit.com", // already present by normalized form
    "Example.ORG", // new
    "   ", // blank, skipped
    "http:// bad", // unreadable, skipped
  ];
  const { list, added } = mergeDomainLists(existing, incoming);
  assert.equal(added, 1);
  assert.deepEqual(list, ["Reddit.com", "twitter.com", "example.org"]);
});
