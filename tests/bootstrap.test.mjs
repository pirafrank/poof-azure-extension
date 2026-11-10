import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const bootstrap = path.join(root, 'tasks/PoofInstall/install_poof.sh');

function fixture(context, options = {}) {
    const directory = mkdtempSync(path.join(tmpdir(), 'poof-task-'));
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    const bin = path.join(directory, 'bin');
    const payload = path.join(directory, 'payload');
    const install = path.join(directory, 'install');
    mkdirSync(bin); mkdirSync(payload); mkdirSync(install);
    const executable = version => `#!/bin/sh\nprintf '%s\\n' 'https://github.com/pirafrank/poof/releases/tag/${version}'\n`;
    writeFileSync(path.join(payload, 'poof'), options.invalidBinary ? '#!/bin/sh\necho unrelated\n' : executable(options.binaryVersion || 'v0.6.0'), { mode: 0o755 });
    const archive = path.join(directory, 'release.tar.gz');
    execFileSync('tar', ['-czf', archive, '-C', payload, 'poof']);
    const filename = 'poof-0.6.0-x86_64-unknown-linux-gnu.tar.gz';
    const digest = options.badChecksum ? '0'.repeat(64) : createHash('sha256').update(readFileSync(archive)).digest('hex');
    const manifest = path.join(directory, 'checksums.txt');
    writeFileSync(manifest, `${digest}  ${filename}\n`);
    const metadata = path.join(directory, 'release.json');
    writeFileSync(metadata, JSON.stringify({ tag_name: 'v0.6.0', assets: options.noChecksum ? [] : [{ name: 'poof-0.6.0-checksums.txt' }] }));
    const log = path.join(directory, 'curl.log');
    writeFileSync(path.join(bin, 'curl'), `#!${process.execPath}\nconst fs = require('node:fs');
const args = process.argv.slice(2); const url = args.find(arg => arg.startsWith('https://'));
fs.appendFileSync(process.env.TEST_LOG, url + '\\n');
const output = args[args.indexOf('-o') + 1];
if (url.includes('api.github.com')) fs.copyFileSync(process.env.TEST_METADATA, output);
else if (url.endsWith('checksums.txt')) { if (process.env.TEST_CHECKSUM_FAILURE) process.exit(22); fs.copyFileSync(process.env.TEST_MANIFEST, output); }
else fs.copyFileSync(process.env.TEST_ARCHIVE, output);
`, { mode: 0o755 });
    writeFileSync(path.join(bin, 'uname'), '#!/bin/sh\nif [ "$1" = -s ]; then echo Linux; else echo x86_64; fi\n', { mode: 0o755 });
    writeFileSync(path.join(bin, 'ldd'), '#!/bin/sh\necho "GNU libc"\n', { mode: 0o755 });
    if (options.existing) writeFileSync(path.join(install, 'poof'), executable(options.existing), { mode: 0o755 });
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, POOF_NODE: process.execPath, POOF_INSTALL_DIR: install,
        POOF_VERSION: options.version || 'v0.6.0', GITHUB_TOKEN: '', TEST_METADATA: metadata, TEST_MANIFEST: manifest, TEST_ARCHIVE: archive, TEST_LOG: log,
        TEST_CHECKSUM_FAILURE: options.checksumFailure ? 'yes' : '' };
    return { directory, install, env, log, run: () => spawnSync('bash', [bootstrap], { env, encoding: 'utf8' }) };
}

test('downloads a pre-built executable, validates checksum and version, and installs it', context => {
    const item = fixture(context);
    const result = item.run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(execFileSync(path.join(item.install, 'poof'), ['--version'], { encoding: 'utf8' }), /v0\.6\.0/);
});

test('a pinned version replaces a different installed version only after validation', context => {
    const item = fixture(context, { existing: 'v0.5.2' });
    assert.equal(item.run().status, 0);
    assert.match(readFileSync(path.join(item.install, 'poof'), 'utf8'), /v0\.6\.0/);
});

test('latest reuses an existing recognized poof without downloading', context => {
    const item = fixture(context, { version: 'latest', existing: 'v0.5.2' });
    assert.equal(item.run().status, 0);
    assert.equal(existsSync(item.log), false);
});

test('checksum mismatch leaves the existing executable untouched', context => {
    const item = fixture(context, { badChecksum: true, existing: 'v0.5.2' });
    const result = item.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /checksum mismatch/);
    assert.match(readFileSync(path.join(item.install, 'poof'), 'utf8'), /v0\.5\.2/);
});

test('a declared checksum download failure cannot silently downgrade validation', context => {
    const item = fixture(context, { checksumFailure: true });
    assert.notEqual(item.run().status, 0);
    assert.equal(existsSync(path.join(item.install, 'poof')), false);
});

test('rejects a downloaded executable with the wrong identity or version', context => {
    for (const options of [{ invalidBinary: true }, { binaryVersion: 'v0.5.2' }]) {
        const item = fixture(context, options);
        assert.notEqual(item.run().status, 0);
        assert.equal(existsSync(path.join(item.install, 'poof')), false);
    }
});

test('historical releases without checksums explicitly warn and still verify version', context => {
    const item = fixture(context, { noChecksum: true });
    const result = item.run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /no checksum manifest/);
});

test('invalid requested versions fail before any download', context => {
    const item = fixture(context, { version: '../bad' });
    assert.notEqual(item.run().status, 0);
    assert.equal(existsSync(item.log), false);
});

test('does not overwrite an unrelated executable', context => {
    const item = fixture(context);
    const binary = path.join(item.install, 'poof');
    writeFileSync(binary, '#!/bin/sh\necho unrelated\n', { mode: 0o755 });
    assert.notEqual(item.run().status, 0);
    assert.match(readFileSync(binary, 'utf8'), /unrelated/);
    assert.equal(existsSync(item.log), false);
});

test('package wrapper passes the last entry and tags directly to poof', context => {
    const item = fixture(context);
    const log = path.join(item.directory, 'packages.log');
    const bin = path.join(item.directory, 'bin');
    writeFileSync(path.join(bin, 'poof'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$TEST_PACKAGE_LOG"\n', { mode: 0o755 });
    const result = spawnSync('bash', [path.join(root, 'tasks/PoofInstall/install_packages.sh')], {
        env: { ...item.env, TEST_PACKAGE_LOG: log, POOF_PACKAGES: ' ms-jpq/sad,\r\n dandavison/delta@0.18.0' }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(log, 'utf8'), 'install ms-jpq/sad\ninstall dandavison/delta --tag 0.18.0\n');
});

test('package wrapper propagates poof failure instead of continuing', context => {
    const item = fixture(context);
    writeFileSync(path.join(item.directory, 'bin', 'poof'), '#!/bin/sh\nexit 23\n', { mode: 0o755 });
    const result = spawnSync('bash', [path.join(root, 'tasks/PoofInstall/install_packages.sh')], {
        env: { ...item.env, POOF_PACKAGES: 'owner/repo' }, encoding: 'utf8',
    });
    assert.equal(result.status, 23);
});
