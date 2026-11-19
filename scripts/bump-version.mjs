import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];
assert.match(version ?? '', /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'Usage: just bump-version MAJOR.MINOR.PATCH');
const [major, minor, patch] = version.split('.').map(Number);

function readJson(file) {
    return JSON.parse(readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

for (const file of ['package.json', 'tasks/PoofInstall/package.json', 'vss-extension.json']) {
    const manifest = readJson(file);
    manifest.version = version;
    writeJson(file, manifest);
}

const taskFile = 'tasks/PoofInstall/task.json';
const task = readJson(taskFile);
task.version = { Major: major, Minor: minor, Patch: patch };
writeJson(taskFile, task);

const lockFile = 'package-lock.json';
const lock = readJson(lockFile);
lock.version = version;
lock.packages[''].version = version;
lock.packages['tasks/PoofInstall'].version = version;
writeJson(lockFile, lock);

console.log(`Updated extension and task versions to ${version}.`);
