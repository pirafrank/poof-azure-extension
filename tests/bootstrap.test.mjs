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
    const filename = 'poof-0.6.0-x86_64-unknown-linux-musl.tar.gz';
    const digest = options.badChecksum ? '0'.repeat(64) : createHash('sha256').update(readFileSync(archive)).digest('hex');
    const archiveDigest = createHash('sha256').update(readFileSync(archive)).digest('hex');
    const manifest = path.join(directory, 'checksums.txt');
    writeFileSync(manifest, `${digest}  ${filename}\n`);
    const bundle = path.join(directory, 'checksums.sigstore.json');
    writeFileSync(bundle, JSON.stringify({ mediaType: 'invalid-test-bundle' }));
    const metadata = path.join(directory, 'release.json');
    const assets = [{
        name: filename,
        ...(options.noApiDigest ? {} : { digest: Object.hasOwn(options, 'apiDigest') ? options.apiDigest : `sha256:${options.badApiDigest ? '0'.repeat(64) : archiveDigest}` }),
    }];
    if (!options.noChecksum) assets.push({ name: 'poof-0.6.0-checksums.txt' });
    if (options.withSignature) assets.push({ name: 'poof-0.6.0-checksums.txt.sigstore.json' });
    writeFileSync(metadata, JSON.stringify({ tag_name: 'v0.6.0', assets }));
    const log = path.join(directory, 'curl.log');
    writeFileSync(path.join(bin, 'curl'), `#!${process.execPath}\nconst fs = require('node:fs');
const args = process.argv.slice(2); const url = args.find(arg => arg.startsWith('https://'));
fs.appendFileSync(process.env.TEST_LOG, url + '\\n');
const output = args[args.indexOf('-o') + 1];
if (process.env.TEST_DOWNLOAD_FAILURE && url.endsWith(process.env.TEST_DOWNLOAD_FAILURE)) process.exit(22);
if (url.includes('api.github.com')) fs.copyFileSync(process.env.TEST_METADATA, output);
else if (url.endsWith('.sigstore.json')) fs.copyFileSync(process.env.TEST_BUNDLE, output);
else if (url.endsWith('checksums.txt')) { if (process.env.TEST_CHECKSUM_FAILURE) process.exit(22); fs.copyFileSync(process.env.TEST_MANIFEST, output); }
else fs.copyFileSync(process.env.TEST_ARCHIVE, output);
`, { mode: 0o755 });
    writeFileSync(path.join(bin, 'uname'), '#!/bin/sh\nif [ "$1" = -s ]; then echo Linux; else echo x86_64; fi\n', { mode: 0o755 });
    if (options.existing) writeFileSync(path.join(install, 'poof'), executable(options.existing), { mode: 0o755 });
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, POOF_NODE: process.execPath, POOF_INSTALL_DIR: install,
        TF_BUILD: options.azure ? 'True' : '',
        POOF_VERSION: options.version || 'v0.6.0', GITHUB_TOKEN: '', TEST_METADATA: metadata, TEST_MANIFEST: manifest, TEST_ARCHIVE: archive, TEST_LOG: log,
        TEST_CHECKSUM_FAILURE: options.checksumFailure ? 'yes' : '', TEST_BUNDLE: bundle,
        TEST_DOWNLOAD_FAILURE: options.downloadFailure || '' };
    return { directory, install, payload, archive, env, log, run: () => spawnSync('bash', [bootstrap], { env, encoding: 'utf8', timeout: 15000 }) };
}

test('downloads a pre-built executable, validates checksum and version, and installs it', context => {
    const item = fixture(context);
    const result = item.run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /no available Sigstore signature bundle/);
    assert.match(result.stdout, /Verified poof archive SHA256 against the release checksum manifest/);
    assert.match(execFileSync(path.join(item.install, 'poof'), ['--version'], { encoding: 'utf8' }), /v0\.6\.0/);
});

test('a pinned version replaces a different installed version only after validation', context => {
    const item = fixture(context, { existing: 'v0.5.2' });
    assert.equal(item.run().status, 0);
    assert.match(readFileSync(path.join(item.install, 'poof'), 'utf8'), /v0\.6\.0/);
});

test('latest and matching pinned versions reuse poof without metadata or digests', context => {
    for (const version of ['latest', 'v0.5.2']) {
        const item = fixture(context, { version, existing: 'v0.5.2', noApiDigest: true });
        rmSync(item.env.TEST_METADATA);
        assert.equal(item.run().status, 0);
        assert.equal(existsSync(item.log), false);
    }
});

test('checksum mismatch leaves the existing executable untouched', context => {
    const item = fixture(context, { badChecksum: true, existing: 'v0.5.2' });
    const result = item.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /checksum mismatch/);
    assert.match(readFileSync(path.join(item.install, 'poof'), 'utf8'), /v0\.5\.2/);
});

test('a missing manifest does not disable the GitHub API archive digest check', context => {
    const item = fixture(context, { noChecksum: true });
    const result = item.run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /has no checksum manifest/);
    assert.match(result.stdout, /Verified poof archive SHA256 against GitHub release metadata/);
});

test('verification fallbacks register Azure task warnings on stdout', context => {
    for (const options of [{}, { noChecksum: true }, { checksumFailure: true }]) {
        const item = fixture(context, { ...options, azure: true });
        const result = item.run();
        assert.equal(result.status, 0, result.stderr);
        const warnings = result.stdout.split('\n').filter(line => line.startsWith('##vso[task.logissue type=warning;]'));
        assert.ok(warnings.some(line => /Sigstore signature/.test(line)), result.stdout);
        if (options.checksumFailure) {
            assert.ok(warnings.some(line => /manifest could not be downloaded/.test(line)));
        }
        assert.doesNotMatch(result.stderr, /Warning:/);
    }
});

test('GitHub API archive digest mismatch prevents installation', context => {
    const item = fixture(context, { badApiDigest: true });
    const result = item.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /digest from GitHub API does not match/);
    assert.equal(existsSync(path.join(item.install, 'poof')), false);
});

test('a failed manifest download can fall back to the verified API digest', context => {
    const item = fixture(context, { checksumFailure: true });
    const result = item.run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /manifest could not be downloaded/);
    assert.match(result.stdout, /Verified poof archive SHA256 against GitHub release metadata/);
});

test('missing, null, empty, or malformed API digests fail before archive downloads', context => {
    for (const digestOption of [{ noApiDigest: true }, { apiDigest: null }, { apiDigest: '' }, { apiDigest: 'sha256:invalid' }]) {
        for (const noChecksum of [false, true]) {
            const item = fixture(context, { ...digestOption, noChecksum, existing: 'v0.5.2' });
            const result = item.run();
            assert.equal(result.error, undefined);
            assert.notEqual(result.status, 0);
            assert.match(result.stderr, /(?:Missing|Invalid) GitHub asset.*digest/);
            assert.equal(readFileSync(item.log, 'utf8').trim().split('\n').length, 1);
            assert.match(readFileSync(path.join(item.install, 'poof'), 'utf8'), /v0\.5\.2/);
        }
    }
});

test('the archive verifier independently rejects absent API digests', context => {
    const item = fixture(context);
    for (const digest of ['', '-']) {
        const result = spawnSync(process.execPath, [path.join(root, 'tasks/PoofInstall/verify-release.mjs'),
            item.archive, 'archive.tar.gz', digest, '-', '-', 'v0.6.0'], { encoding: 'utf8' });
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Missing or invalid GitHub asset SHA256 digest/);
    }
});

test('a present but invalid Sigstore bundle prevents installation', context => {
    const item = fixture(context, { withSignature: true });
    const result = item.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Sigstore signature verification failed/);
    assert.equal(existsSync(path.join(item.install, 'poof')), false);
});

test('advertised signatures cannot be bypassed by failed or missing downloads', context => {
    for (const options of [
        { downloadFailure: '.sigstore.json' },
        { checksumFailure: true },
        { noChecksum: true },
    ]) {
        const item = fixture(context, { withSignature: true, existing: 'v0.5.2', ...options });
        const result = item.run();
        assert.equal(result.error, undefined);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /signature/);
        assert.match(readFileSync(path.join(item.install, 'poof'), 'utf8'), /v0\.5\.2/);
    }
});

test('metadata and archive download failures preserve the existing executable', context => {
    for (const downloadFailure of ['/tags/v0.6.0', '.tar.gz']) {
        const item = fixture(context, { downloadFailure, existing: 'v0.5.2' });
        const result = item.run();
        assert.equal(result.error, undefined);
        assert.notEqual(result.status, 0);
        assert.match(readFileSync(path.join(item.install, 'poof'), 'utf8'), /v0\.5\.2/);
    }
});

for (const location of ['existing', 'downloaded']) {
    test(`a stalled ${location} version check fails within its timeout`, context => {
        const item = fixture(context, location === 'downloaded' ? { noChecksum: true } : {});
        // Ignore SIGTERM so the check must forcibly terminate the executable.
        const stalled = `#!${process.execPath}\nprocess.on('SIGTERM', () => {}); setInterval(() => {}, 1000);\n`;
        const binary = path.join(location === 'existing' ? item.install : item.payload, 'poof');
        writeFileSync(binary, stalled, { mode: 0o755 });
        if (location === 'downloaded') {
            execFileSync('tar', ['-czf', item.archive, '-C', item.payload, 'poof']);
            const metadata = JSON.parse(readFileSync(item.env.TEST_METADATA, 'utf8'));
            metadata.assets[0].digest = `sha256:${createHash('sha256').update(readFileSync(item.archive)).digest('hex')}`;
            writeFileSync(item.env.TEST_METADATA, JSON.stringify(metadata));
        }
        const started = Date.now();
        const result = item.run();
        assert.equal(result.error, undefined, 'bootstrap exceeded the outer test timeout');
        assert.notEqual(result.status, 0);
        assert.ok(Date.now() - started < 14000);
        if (location === 'existing') {
            assert.equal(readFileSync(binary, 'utf8'), stalled);
            assert.equal(existsSync(item.log), false);
        } else {
            assert.match(result.stderr, /version check timed out/);
            assert.equal(existsSync(path.join(item.install, 'poof')), false);
        }
    });
}

test('rejects a downloaded executable with the wrong identity or version', context => {
    for (const options of [{ invalidBinary: true }, { binaryVersion: 'v0.5.2' }]) {
        const item = fixture(context, options);
        assert.notEqual(item.run().status, 0);
        assert.equal(existsSync(path.join(item.install, 'poof')), false);
    }
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
