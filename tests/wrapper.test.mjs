import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const handler = fileURLToPath(new URL('../build/task/index.js', import.meta.url));

function fixture(context, options = {}) {
    const home = mkdtempSync(path.join(tmpdir(), 'poof wrapper '));
    context.after(() => rmSync(home, { recursive: true, force: true }));
    mkdirSync(path.join(home, '.local/bin'), { recursive: true });
    const log = path.join(home, 'calls.jsonl');
    writeFileSync(path.join(home, '.local/bin/poof'), `#!${process.execPath}
const fs = require('node:fs');
if (process.argv[2] === '--version') console.log('https://github.com/pirafrank/poof/releases/tag/v0.6.0');
else {
    fs.appendFileSync(process.env.TEST_LOG, JSON.stringify({args: process.argv.slice(2), token: process.env.GITHUB_TOKEN}) + '\\n');
    process.exit(Number(process.env.TEST_EXIT || 0));
}
`, { mode: 0o755 });
    const data = path.join(home, 'custom data');
    const env = { ...process.env, HOME: home, XDG_DATA_HOME: data, INPUT_VERSION: 'latest',
        INPUT_PACKAGES: options.packages ?? 'ms-jpq/sad,dandavison/delta@0.18.0', INPUT_TOKEN: options.token || '',
        INPUT_GITHUBTOKEN: '', GITHUB_TOKEN: '', TEST_LOG: log, TEST_EXIT: String(options.exit || 0),
        AGENT_TEMPDIRECTORY: home, SYSTEM_DEBUG: 'false' };
    return { home, data, log, run: () => spawnSync(process.execPath, [handler], { env, encoding: 'utf8' }) };
}

test('compiled task calls pre-built poof with package arguments and child token', context => {
    const item = fixture(context, { token: 'fixture-secret' });
    const result = item.run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /task\.complete result=Succeeded/);
    assert.deepEqual(readFileSync(item.log, 'utf8').trim().split('\n').map(line => JSON.parse(line)), [
        { args: ['install', 'ms-jpq/sad'], token: 'fixture-secret' },
        { args: ['install', 'dandavison/delta', '--tag', '0.18.0'], token: 'fixture-secret' },
    ]);
    assert.ok(result.stdout.includes(`##vso[task.prependpath]${path.join(item.home, '.local/bin')}`));
    const packagesBin = process.platform === 'darwin'
        ? path.join(item.home, 'Library/Application Support/poof/bin')
        : path.join(item.data, 'poof/bin');
    assert.ok(result.stdout.includes(`##vso[task.prependpath]${packagesBin}`));
});

test('setup-only does not invoke package installation', context => {
    const item = fixture(context, { packages: '' });
    assert.match(item.run().stdout, /task\.complete result=Succeeded/);
    assert.equal(existsSync(item.log), false);
});

test('poof package failure becomes a failed Azure task', context => {
    const item = fixture(context, { exit: 23 });
    const result = item.run();
    assert.match(result.stdout, /task\.complete result=Failed/);
    assert.match(result.stdout, /Package installation failed with exit code 23/);
    assert.equal(readFileSync(item.log, 'utf8').trim().split('\n').length, 1);
});

test('unresolved token macros fail before running poof', context => {
    const item = fixture(context, { token: '$(MISSING)' });
    assert.match(item.run().stdout, /GitHub token is unresolved or invalid/);
    assert.equal(existsSync(item.log), false);
});
