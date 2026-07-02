// Toolbar popup: shows how many domains are filtered and lets you block the
// current tab's site in one click. Domain logic lives in domain.js (loaded
// first); this file is the thin UI layer over it.
const STORAGE_KEY = "blockedDomains";
// Written after a block to ask the service worker to clear existing history for
// the newly blocked domain (see background.js).
const SWEEP_REQUEST_KEY = "sweepRequest";
const el = (id) => document.getElementById(id);
const countEl = el("count");
const countLabelEl = el("count-label");
const hostEl = el("host");
const blockBtn = el("block");
const statusEl = el("status");

// Count distinct domains by normalized form, matching what the sweep acts on.
function domainCount(list) {
  return partitionDomains(list).domains.length;
}

async function getList() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
}

// activeTab (granted when the popup opens) makes the active tab's url readable
// without the broad "tabs" permission.
async function activeTabUrl() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab && tab.url ? tab.url : "";
  } catch {
    return "";
  }
}

let currentHost = "";

function setCount(list) {
  const n = domainCount(list);
  countEl.textContent = String(n);
  countLabelEl.textContent = n === 1 ? "domain filtered" : "domains filtered";
}

async function render() {
  const list = await getList();
  setCount(list);

  currentHost = blockableHost(await activeTabUrl());
  if (!currentHost) {
    hostEl.textContent = "This page can't be filtered.";
    hostEl.classList.add("muted");
    blockBtn.disabled = true;
    blockBtn.textContent = "Block this site";
    return;
  }

  // Suffix match, not exact: if a parent domain like reddit.com is already on
  // the list, old.reddit.com is covered by the sweep and must not be re-added.
  const alreadyBlocked = hostIsBlocked(currentHost, partitionDomains(list).domains);
  hostEl.classList.remove("muted");
  if (alreadyBlocked) {
    hostEl.textContent = currentHost + " is filtered.";
    blockBtn.disabled = true;
    blockBtn.textContent = "Already filtered";
  } else {
    hostEl.textContent = currentHost;
    blockBtn.disabled = false;
    blockBtn.textContent = "Block this site";
  }
}

blockBtn.addEventListener("click", async () => {
  if (!currentHost) return;
  const list = await getList();
  const { list: next, status } = addBlockedDomain(list, currentHost);
  if (status === "added") {
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
    await chrome.storage.local.set({ [SWEEP_REQUEST_KEY]: Date.now() });
    statusEl.textContent = "Filtered.";
  } else if (status === "exists") {
    statusEl.textContent = "Already filtered.";
  }
  await render();
  setTimeout(() => (statusEl.textContent = ""), 2500);
});

el("manage").addEventListener("click", (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
  window.close();
});

render();
