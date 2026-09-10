import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkVersions, VERSION_SOURCES } from '../audit-version.mjs';

test('the real CLI resolves sources from its own location, not the working directory', () => {
  const output = execFileSync(process.execPath, [fileURLToPath(new URL('../audit-version.mjs', import.meta.url))], {
    cwd: fileURLToPath(new URL('../../apps', import.meta.url)),
    encoding: 'utf8',
  });
  assert.match(output, /11\/11 surfaces/);
  assert.match(output, /committed release versions agree/);
});

function fixture(version = '0.28.0') {
  const files = Object.fromEntries(VERSION_SOURCES.map(([path]) => [path, JSON.stringify({ version })]));
  files['apps/mobile/app.json'] = JSON.stringify({ expo: { version } });
  files['apps/api/openapi.json'] = JSON.stringify({ info: { version } });
  files['packages/core/src/brand.ts'] = `export const APP_VERSION = "${version}";\n`;
  files['apps/api/app/core/config.py'] = `class Settings:\n    version: str = "${version}"\n`;
  files['.env.example'] = `POIPOIHISAB_VERSION=${version}\n`;
  files['apps/api/pyproject.toml'] = `[project]\nname = "poipoihisab-api"\nversion = "${version}"\n[tool.ruff]\ntarget-version = "py313"\n`;
  files['apps/api/uv.lock'] = `[[package]]\nname = "poipoihisab-api"\nversion = "${version}"\nsource = { editable = "." }\n`;
  return files;
}

test('all committed release surfaces agree, without reading any real .env', () => {
  const files = fixture();
  const result = checkVersions((file) => {
    assert.notEqual(file, '.env');
    assert.notEqual(file, 'apps/api/.env');
    return files[file];
  });
  assert.equal(result.expected, '0.28.0');
  assert.equal(result.checked, VERSION_SOURCES.length);
  assert.deepEqual(result.errors, []);
});

for (const [path] of VERSION_SOURCES) {
  test(`rejects version drift in ${path}`, () => {
    const files = fixture();
    files[path] = fixture('9.9.9')[path];
    const result = checkVersions((file) => files[file]);
    assert.ok(result.errors.length > 0);
    assert.ok(result.errors.some((message) => message.includes('does not match')));
  });
  test(`fails closed when ${path} is missing`, () => {
    const files = fixture();
    delete files[path];
    assert.ok(checkVersions((file) => files[file]).errors.some((message) => message.startsWith(path)));
  });
}

test('malformed JSON, missing fields, and duplicate declarations do not silently pass', () => {
  const files = fixture();
  files['apps/mobile/package.json'] = '{';
  files['packages/core/package.json'] = '{}';
  files['packages/core/src/brand.ts'] += files['packages/core/src/brand.ts'];
  assert.equal(checkVersions((file) => files[file]).errors.length, 3);
});

test('a coordinated release bump is accepted', () => {
  const files = fixture('1.2.3');
  assert.deepEqual(checkVersions((file) => files[file]).errors, []);
});

test('CRLF sources work on Windows too', () => {
  const files = fixture();
  assert.deepEqual(checkVersions((file) => files[file].replaceAll('\n', '\r\n')).errors, []);
});

test('rejects invalid canonical versions even if all surfaces repeat them', () => {
  for (const version of ['', 'v1.2.3', '01.2.3', '1.2', '1.2.3-dev']) {
    const files = fixture(version);
    assert.equal(checkVersions((file) => files[file]).errors.length, VERSION_SOURCES.length);
  }
});
