// Unit tests for the shared list helpers that back the popup and the options
// page: deriving a blockable domain from a tab URL, adding without duplicates,
// splitting input into filtered/ignored, and merging an imported list. Pure
// functions, so domain.js is required directly with no chrome mock.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  hostIsBlocked,
  domainMatchesQueryStrict,
  domainMatchesQueryPartial,
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

test("domainMatchesQueryStrict matches the way the sweep does", () => {
  // A parent query surfaces the domain itself and its subdomains, the same way
  // blocking reddit.com would cover old.reddit.com - but never a lookalike or a
  // different registrable domain that only shares a label prefix.
  assert.equal(domainMatchesQueryStrict("reddit.com", "reddit.com"), true);
  assert.equal(domainMatchesQueryStrict("old.reddit.com", "reddit.com"), true);
  assert.equal(domainMatchesQueryStrict("notreddit.com", "reddit.com"), false);
  assert.equal(domainMatchesQueryStrict("reddit.company", "reddit.com"), false);

  // A subdomain query surfaces the parent that covers it.
  assert.equal(domainMatchesQueryStrict("reddit.com", "old.reddit.com"), true);

  // The query is normalized the same as a stored domain, so a full URL shape
  // still matches by host.
  assert.equal(domainMatchesQueryStrict("old.reddit.com", "https://www.Reddit.com/r/x"), true);

  // A half-typed query is not a complete host, so strict does not match it; the
  // partial tier below is what narrows while typing.
  assert.equal(domainMatchesQueryStrict("github.com", "github.co"), false);
  assert.equal(domainMatchesQueryStrict("reddit.com", "red"), false);

  // An empty or unreadable query matches nothing under the strict rule.
  assert.equal(domainMatchesQueryStrict("reddit.com", ""), false);
  assert.equal(domainMatchesQueryStrict("reddit.com", "   "), false);
  assert.equal(domainMatchesQueryStrict("example.org", "reddit.com"), false);
});

test("domainMatchesQueryPartial narrows by a label-aligned prefix", () => {
  // Narrows while a label is half-typed, including a dotted partial.
  assert.equal(domainMatchesQueryPartial("reddit.com", "red"), true);
  assert.equal(domainMatchesQueryPartial("github.com", "github.co"), true);
  assert.equal(domainMatchesQueryPartial("old.reddit.com", "old.red"), true);
  assert.equal(domainMatchesQueryPartial("example.org", "red"), false);

  // Normalized before searching, so a "www.", scheme, or "*." prefix narrows the
  // same way a bare host would.
  assert.equal(domainMatchesQueryPartial("reddit.com", "www.red"), true);
  assert.equal(domainMatchesQueryPartial("reddit.com", "https://red"), true);
  assert.equal(domainMatchesQueryPartial("reddit.com", "*.red"), true);

  // Label-aligned, so it never matches across a label seam: a lookalike is left
  // alone even by a partial query.
  assert.equal(domainMatchesQueryPartial("notreddit.com", "red"), false);
  assert.equal(domainMatchesQueryPartial("notreddit.com", "reddit"), false);
  assert.equal(domainMatchesQueryPartial("notreddit.com", "www.reddit.com"), false);

  // An empty query is not a partial match (the caller shows the full list).
  assert.equal(domainMatchesQueryPartial("reddit.com", ""), false);
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
