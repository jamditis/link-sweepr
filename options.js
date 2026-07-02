// Options page: edit the blocked-domain list with a live preview of what will be
// filtered, save-on-input, and text-file import/export. Domain logic lives in
// domain.js (loaded first); this file is the UI layer.
const STORAGE_KEY = "blockedDomains";
// Writing this token asks the service worker to clear existing history. It is
// separate from the list write so the list can be saved on every keystroke while
// the sweep only runs once the list settles.
const SWEEP_REQUEST_KEY = "sweepRequest";
const SWEEP_REQUEST_DELAY_MS = 800;

const el = (id) => document.getElementById(id);
const textarea = el("domains");
const countEl = el("count");
const countLabelEl = el("count-label");
const chipsEl = el("chips");
const warnEl = el("warn");
const statusEl = el("status");
const fileInput = el("file");

function parseLines(text) {
  return text.split("\n").map((line) => line.trim()).filter(Boolean);
}

// The distinct domains that will be filtered plus the lines that resolve to
// nothing, so the preview shows exactly what the sweep will act on.
function analyze(text) {
  return partitionDomains(text.split("\n"));
}

function renderPreview() {
  const { domains, ignored } = analyze(textarea.value);

  countEl.textContent = String(domains.length);
  countLabelEl.textContent = domains.length === 1 ? "domain filtered" : "domains filtered";

  // Rebuild chips with createElement/textContent; never innerHTML on input text.
  const chips = domains.map((domain) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = domain;
    return chip;
  });
  chipsEl.replaceChildren(...chips);

  if (ignored.length) {
    warnEl.textContent = `Ignored (not a readable domain): ${ignored.join(", ")}`;
    warnEl.hidden = false;
  } else {
    warnEl.hidden = true;
  }
}

// Persist on every edit. Writing immediately (rather than on a debounce) means no
// edit can be lost by closing the tab. Writes are serialized through one queue so
// a slower earlier write can never land after a newer one and overwrite it: each
// call captures the current text and chains an ordered write, and the returned
// promise resolves once that write completes.
let saveQueue = Promise.resolve();
function save() {
  const value = textarea.value;
  saveQueue = saveQueue.then(async () => {
    const list = parseLines(value.toLowerCase());
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: list });
    } catch {
      statusEl.textContent = "Could not save. Check extension storage.";
      return;
    }
    const count = analyze(value).domains.length;
    statusEl.textContent =
      count === 1 ? "Saved. 1 domain filtered." : `Saved. ${count} domains filtered.`;
  });
  return saveQueue;
}

// Ask the service worker to clear existing history for the current list. Routed
// through the same queue as save() so the token always lands after the pending
// list writes; the worker then reads the up-to-date list rather than a stale one.
// Cheap and idempotent; the returned promise resolves once the token is written.
function requestSweep() {
  saveQueue = saveQueue.then(() =>
    chrome.storage.local.set({ [SWEEP_REQUEST_KEY]: Date.now() }).catch(() => {})
  );
  return saveQueue;
}

// Debounce the sweep request (not the save): the list is already saved on every
// keystroke, so this only decides when the one-time history sweep runs. Debounce
// here is safe because a page keeps its timers, unlike a service worker.
let sweepTimer = null;
function scheduleSweep() {
  clearTimeout(sweepTimer);
  sweepTimer = setTimeout(() => {
    sweepTimer = null;
    requestSweep();
  }, SWEEP_REQUEST_DELAY_MS);
}

// If the page is hidden or closed mid-debounce, fire the pending request now.
// Only a sweep trigger rides on this, never the list (already saved), so if this
// write does not land before teardown the periodic worker sweep still catches it.
function flushPendingSweep() {
  if (sweepTimer !== null) {
    clearTimeout(sweepTimer);
    sweepTimer = null;
    requestSweep();
  }
}

function onInput() {
  renderPreview();
  save(); // queued, ordered write; not awaited so the sweep timer is set this tick
  scheduleSweep(); // set synchronously so a hide-flush always has a pending request
}

function exportList() {
  const text = parseLines(textarea.value).join("\n") + "\n";
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "blocked-domains.txt";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function importList() {
  const file = fileInput.files[0];
  if (!file) return;
  const text = await file.text();
  const { list, added } = mergeDomainLists(parseLines(textarea.value), parseLines(text));
  textarea.value = list.join("\n");
  renderPreview();
  await save();
  await requestSweep(); // import is a settled edit; sweep now rather than on a debounce
  statusEl.textContent =
    added === 1 ? "Imported 1 new domain." : `Imported ${added} new domains.`;
  fileInput.value = ""; // reset so re-importing the same file fires change again
}

async function load() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const list = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
  textarea.value = list.join("\n");
  renderPreview();
}

textarea.addEventListener("input", onInput);
el("export").addEventListener("click", exportList);
el("import").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", importList);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) flushPendingSweep();
});
load();
