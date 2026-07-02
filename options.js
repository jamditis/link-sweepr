const textarea = document.getElementById("domains");
const status = document.getElementById("status");

function parseList(text) {
  return text
    .split("\n")
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean);
}

async function load() {
  const { blockedDomains } = await chrome.storage.local.get("blockedDomains");
  const list = Array.isArray(blockedDomains) ? blockedDomains : [];
  textarea.value = list.join("\n");
}

async function save() {
  const list = parseList(textarea.value);
  await chrome.storage.local.set({ blockedDomains: list });
  status.textContent =
    list.length === 1
      ? "Saved. 1 domain filtered."
      : `Saved. ${list.length} domains filtered.`;
  setTimeout(() => (status.textContent = ""), 3000);
}

document.getElementById("save").addEventListener("click", save);
load();
