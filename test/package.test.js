const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const AdmZip = require('adm-zip');

test('packages are byte-identical across source timestamps and timezones', () => {
  const root = path.resolve(__dirname, '..');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'linksweepr-package-'));
  try {
    for (const name of ['manifest.json', 'background.js', 'domain.js', 'options.html',
      'options.js', 'popup.html', 'popup.js', 'icons']) {
      fs.cpSync(path.join(root, name), path.join(tmp, name), { recursive: true });
    }
    const build = (tz) => execFileSync(process.execPath, [path.join(root, 'scripts/package.mjs')],
      { cwd: tmp, env: { ...process.env, TZ: tz } });
    build('Pacific/Honolulu');
    const manifest = JSON.parse(fs.readFileSync(path.join(tmp, 'manifest.json')));
    const archive = path.join(tmp, 'dist', `link-sweepr-${manifest.version}.zip`);
    const first = fs.readFileSync(archive);
    fs.utimesSync(path.join(tmp, 'background.js'), new Date(2000, 0, 1), new Date(2000, 0, 1));
    fs.chmodSync(path.join(tmp, 'background.js'), 0o600);
    build('Asia/Tokyo');
    assert.deepEqual(fs.readFileSync(archive), first);
    const entries = new AdmZip(first).getEntries();
    assert.ok(entries.some(entry => entry.entryName === 'manifest.json'));
    assert.ok(entries.every(entry => !entry.isDirectory));
    for (const entry of entries) {
      assert.equal((entry.attr >>> 16) & 0o777, 0o644);
      assert.equal(entry.header.made, 0x0314);
      assert.deepEqual(entry.getData(), fs.readFileSync(path.join(tmp, entry.entryName)));
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
