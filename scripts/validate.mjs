import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = filename => JSON.parse(readFileSync(path.join(root, filename), 'utf8'));
const pkg = read('package.json');
const extension = read('vss-extension.json');
const task = read('tasks/PoofInstall/task.json');
const runtime = read('tasks/PoofInstall/package.json');
assert.equal(extension.version, pkg.version);
assert.equal(Object.values(task.version).join('.'), pkg.version);
assert.equal(runtime.version, pkg.version);
assert.equal(task.name, 'SetupPoof');
assert.equal(task.category, 'Utility');
assert.match(task.id, /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i);
assert.deepEqual(task.execution, { Node24: { target: 'index.js' } });
assert.deepEqual(task.restrictions.settableVariables.allowed, []);
assert.deepEqual(extension.galleryFlags, []);
assert.equal(extension.contributions[0].properties.name, 'tasks/PoofInstall');
assert.equal(task.inputs.find(input => input.name === 'token').defaultValue, '');
const image = readFileSync(path.join(root, extension.icons.default));
assert.equal(image.subarray(1, 4).toString(), 'PNG');
assert.ok(image.readUInt32BE(16) >= 128 && image.readUInt32BE(20) >= 128);
if (process.env.RELEASE_TAG) assert.equal(process.env.RELEASE_TAG, `v${pkg.version}`);
for (const filename of ['.github/workflows/ci.yml', '.github/workflows/publish.yml', '.github/dependabot.yml', 'azure-pipelines.test.yml']) {
	const document = YAML.parseDocument(readFileSync(path.join(root, filename), 'utf8'));
	assert.deepEqual(document.errors, [], `Invalid YAML: ${filename}`);
}
console.log(`Validated extension and task ${pkg.version}; publisher: ${extension.publisher}`);
