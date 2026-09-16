const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function optionsPage(initial) {
  let stored = [...initial];
  const elements = new Map();
  const changes = [];
  const messages = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', disabled: false, listeners: {}, selectionStart: 0, selectionEnd: 0,
      setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
      addEventListener(type, fn) { this.listeners[type] = fn; },
      replaceChildren() {}, setAttribute() {},
    });
    return elements.get(id);
  };
  const context = vm.createContext({
    URL, Blob, setTimeout, clearTimeout,
    document: { getElementById: element, createElement: () => ({}), addEventListener() {} },
    chrome: {
      storage: {
        local: { get: async () => ({ blockedDomains: [...stored] }), set: async () => {} },
        onChanged: { addListener: fn => changes.push(fn) },
      },
      runtime: { sendMessage: message => new Promise(resolve => messages.push({ message, resolve })) },
    },
  });
  for (const file of ['domain.js', 'options.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  }
  return {
    element, messages,
    async tick() { await new Promise(resolve => setImmediate(resolve)); },
    async edit(value) {
      element('domains').value = value;
      const saved = vm.runInContext('save()', context);
      await new Promise(resolve => setImmediate(resolve));
      return { saved };
    },
    external(list) {
      const oldValue = stored;
      stored = [...list];
      changes.forEach(fn => fn({ blockedDomains: { oldValue, newValue: stored } }, 'local'));
    },
  };
}

test('open options page receives external additions and does not overwrite a pending edit', async () => {
  const page = optionsPage(['old.example']);
  await page.tick();
  assert.equal(page.element('domains').value, 'old.example');
  const { saved } = await page.edit('edited.example');
  page.external(['old.example', 'popup.example']);
  await page.tick();
  assert.equal(page.element('domains').value, 'edited.example');
  assert.deepEqual(Array.from(page.messages[0].message.before), ['old.example']);
  page.external(['edited.example', 'popup.example']);
  page.messages[0].resolve({ status: 'saved' });
  await saved;
  assert.equal(page.element('domains').value, 'edited.example\npopup.example');
  page.external(['edited.example', 'popup.example', 'shortcut.example']);
  await page.tick();
  assert.match(page.element('domains').value, /shortcut.example/);
});

test('failed save preserves the draft and retries from the acknowledged base', async () => {
  const page = optionsPage(['old.example']);
  await page.tick();
  const first = await page.edit('one.example');
  page.messages[0].resolve({ status: 'error' });
  await first.saved;
  page.external(['old.example', 'popup.example']);
  await page.tick();
  assert.equal(page.element('domains').value, 'one.example');
  const second = await page.edit('one.example\ntwo.example');
  assert.deepEqual(Array.from(page.messages[1].message.before), ['old.example']);
  page.external(['one.example', 'two.example', 'popup.example']);
  page.messages[1].resolve({ status: 'saved' });
  await second.saved;
  assert.match(page.element('domains').value, /popup.example/);
});


test('saving preserves trailing newlines, draft order, and caret', async () => {
  const page = optionsPage(['old.example', 'last.example']);
  await page.tick();
  const textarea = page.element('domains');
  const draft = 'edited.example\nlast.example\n';
  textarea.selectionStart = textarea.selectionEnd = draft.length;
  const { saved } = await page.edit(draft);
  // The worker stores a normalized list in its existing order.
  page.external(['last.example', 'edited.example']);
  page.messages[0].resolve({ status: 'saved' });
  await saved;
  assert.equal(textarea.value, draft);
  assert.equal(textarea.selectionStart, draft.length);
});
