#!/usr/bin/env node
/**
 * The UI said 0.6.0 while the API said 0.28.0. Bumping one constant fixed
 * today's label but left the same defect one release away. Compare every
 * committed release surface against the web package, without reading .env
 * or making production runtime overrides illegal.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { read, reporter } from './_lib.mjs';

const jsonVersion = (path) => (source) => path.reduce((value, key) => value?.[key], JSON.parse(source));
const oneMatch = (pattern) => (source) => {
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) throw new Error('expected exactly one release version');
  return matches[0][1];
};

export const VERSION_SOURCES = [
  ['apps/web/package.json', jsonVersion(['version'])],
  ['apps/mobile/package.json', jsonVersion(['version'])],
  ['packages/core/package.json', jsonVersion(['version'])],
  ['packages/api-client/package.json', jsonVersion(['version'])],
  ['apps/mobile/app.json', jsonVersion(['expo', 'version'])],
  ['packages/core/src/brand.ts', oneMatch(/^export const APP_VERSION = ["']([^"']+)["'];?\s*$/gm)],
  ['apps/api/app/core/config.py', oneMatch(/^\s+version:\s*str\s*=\s*["']([^"']+)["']\s*$/gm)],
  ['.env.example', oneMatch(/^POIPOIHISAB_VERSION=([^\s#]+)\s*$/gm)],
  ['apps/api/pyproject.toml', (source) => {
    const project = source.match(/^\[project\]\s*\r?\n([\s\S]*?)(?=^\[|(?![\s\S]))/m)?.[1];
    return oneMatch(/^version\s*=\s*"([^"]+)"\s*$/gm)(project ?? '');
  }],
  ['apps/api/uv.lock', oneMatch(/^name = "poipoihisab-api"\r?\nversion = "([^"]+)"\s*$/gm)],
  ['apps/api/openapi.json', jsonVersion(['info', 'version'])],
];

export function checkVersions(readSource = read) {
  const errors = [];
  const versions = new Map();
  for (const [file, extract] of VERSION_SOURCES) {
    try {
      const source = readSource(file);
      if (typeof source !== 'string') throw new Error('file missing');
      const version = extract(source);
      if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
        throw new Error('expected a stable MAJOR.MINOR.PATCH version');
      }
      versions.set(file, version);
    } catch (error) {
      errors.push(`${file}: ${error.message}`);
    }
  }
  const expected = versions.get(VERSION_SOURCES[0][0]);
  if (expected) {
    for (const [file, actual] of versions) {
      if (actual !== expected) errors.push(`${file}: ${actual} does not match web release ${expected}`);
    }
  }
  return { expected, checked: versions.size, errors };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkVersions();
  const r = reporter('version');
  for (const error of result.errors) r.error(error);
  console.log(`version: ${result.checked}/${VERSION_SOURCES.length} surfaces, web release ${result.expected ?? 'invalid'}`);
  if (r.finish()) r.ok('committed release versions agree (runtime overrides excluded)');
}
