import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const root = fileURLToPath(new URL('../', import.meta.url));
const mode = process.argv[2] || 'preview';
assert.ok(['preview', 'production'].includes(mode), 'Use preview or production');
execFileSync(process.execPath, [path.join(root, 'scripts/validate.mjs')], { stdio: 'inherit' });
const stage = path.join(root, '.stage', mode);
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
const dependencies = path.join(stage, 'dependencies');
mkdirSync(path.join(dependencies, 'tasks/PoofInstall'), { recursive: true });
for (const filename of ['package.json', 'package-lock.json', 'tasks/PoofInstall/package.json']) {
    cpSync(path.join(root, filename), path.join(dependencies, filename));
}
execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: dependencies, stdio: 'inherit' });
rmSync(path.join(dependencies, 'node_modules/poof-install-task'), { force: true });
rmSync(path.join(dependencies, 'node_modules/.bin'), { recursive: true, force: true });
const taskDirectory = path.join(stage, 'tasks/PoofInstall');
cpSync(path.join(root, 'build/task'), taskDirectory, { recursive: true });
cpSync(path.join(dependencies, 'node_modules'), path.join(taskDirectory, 'node_modules'), { recursive: true });
rmSync(dependencies, { recursive: true, force: true });
cpSync(path.join(root, 'images'), path.join(stage, 'images'), { recursive: true });
cpSync(path.join(root, 'images/poof_tx_bg_128x128.png'), path.join(taskDirectory, 'icon.png'));
for (const filename of ['README.md', 'LICENSE.md']) cpSync(path.join(root, filename), path.join(stage, filename));
const manifest = JSON.parse(readFileSync(path.join(root, 'vss-extension.json'), 'utf8'));
const task = JSON.parse(readFileSync(path.join(taskDirectory, 'task.json'), 'utf8'));
if (mode === 'preview') {
    manifest.id += '-preview';
    manifest.name += ' (Preview)';
    task.id = 'ff8a97db-4c4a-4164-815a-82fb217a8af2';
    task.name = 'SetupPoofPreview';
    task.friendlyName += ' (Preview)';
} else if (process.env.MARKETPLACE_PUBLIC === 'true') {
    manifest.galleryFlags = ['Public'];
}
if (process.env.MARKETPLACE_PUBLISHER) manifest.publisher = process.env.MARKETPLACE_PUBLISHER;
writeFileSync(path.join(taskDirectory, 'task.json'), JSON.stringify(task, null, 2));
writeFileSync(path.join(stage, 'vss-extension.json'), JSON.stringify(manifest, null, 2));
const destination = path.join(root, 'dist', mode);
rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
execFileSync(process.execPath, [path.join(root, 'node_modules/tfx-cli/_build/tfx-cli.js'), 'extension', 'create', '--manifest-globs', 'vss-extension.json', '--output-path', destination], { cwd: stage, stdio: 'inherit' });
const files = readdirSync(destination).filter(filename => filename.endsWith('.vsix'));
assert.equal(files.length, 1);
const vsix = path.join(destination, files[0]);
const archive = new AdmZip(vsix);
const names = archive.getEntries().map(entry => entry.entryName);
for (const filename of ['index.js', 'install_poof.sh', 'install_packages.sh', 'node_modules/azure-pipelines-task-lib/task.js']) {
    assert.ok(names.includes(`tasks/PoofInstall/${filename}`), `Missing runtime file: ${filename}`);
}
assert.ok(!names.some(name => /(^|\/)(?:\.env|\.git|tests|typescript|tfx-cli)(\/|$)/.test(name)), 'VSIX contains development or sensitive files');
assert.ok(readFileSync(vsix).length < 50 * 1024 * 1024, 'VSIX exceeds 50 MB');
const extracted = mkdtempSync(path.join(tmpdir(), 'poof-vsix-'));
try {
    archive.extractAllTo(extracted);
    const result = spawnSync(process.execPath, [path.join(extracted, 'tasks/PoofInstall/index.js')], {
        cwd: extracted,
        env: { PATH: process.env.PATH, HOME: extracted, INPUT_TOKEN: '$(UNRESOLVED)', AGENT_TEMPDIRECTORY: extracted },
        encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /task\.complete result=Failed/);
    assert.match(result.stdout, /GitHub token is unresolved or invalid/);
    assert.doesNotMatch(result.stderr, /Cannot find module/);
} finally {
    rmSync(extracted, { recursive: true, force: true });
}
console.log(`Verified self-contained ${mode} VSIX: ${vsix}`);
