#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

function warn(message) {
    if (process.env.TF_BUILD?.toLowerCase() === 'true') {
        const escaped = message.replaceAll('%', '%AZP25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
        console.log(`##vso[task.logissue type=warning;]${escaped}`);
    } else {
        console.warn(message);
    }
}

const [archivePath, archiveName, apiDigest, manifestPath, bundlePath, tag] = process.argv.slice(2);

if (!archivePath || !archiveName || !tag) {
    throw new Error('Usage: verify-release.mjs <archive> <name> <api-digest> <manifest|-> <bundle|-> <tag>');
}

const archive = await readFile(archivePath);
const archiveDigest = createHash('sha256').update(archive).digest('hex');

if (!apiDigest || !/^sha256:[a-f0-9]{64}$/i.test(apiDigest)) {
    throw new Error('Missing or invalid GitHub asset SHA256 digest');
}
const expectedDigest = apiDigest.slice('sha256:'.length).toLowerCase();
if (archiveDigest !== expectedDigest) {
    throw new Error('poof archive SHA256 digest from GitHub API does not match');
}
console.log('Verified poof archive SHA256 against GitHub release metadata');

if (manifestPath && manifestPath !== '-') {
    const manifest = await readFile(manifestPath);

    if (bundlePath && bundlePath !== '-') {
        const escapedTag = tag.replaceAll('.', '\\.');
        const identity = `^https://github\\.com/pirafrank/poof/\\.github/workflows/release\\.yml@refs/tags/${escapedTag}$`;

        try {
            const bundle = JSON.parse(await readFile(bundlePath, 'utf8'));
            if (!bundle || typeof bundle.mediaType !== 'string' || !bundle.mediaType.startsWith('application/vnd.dev.sigstore.bundle')) {
                throw new Error('Invalid Sigstore bundle format');
            }
            const { verify } = await import('sigstore');
            await verify(bundle, manifest, {
                certificateIssuer: 'https://token.actions.githubusercontent.com',
                certificateIdentityURI: identity,
            });
            console.log(`Verified Sigstore signature for poof release ${tag}`);
        } catch (error) {
            throw new Error(`poof checksum manifest Sigstore signature verification failed: ${error.message}`);
        }
    } else {
        warn(`Warning: poof release ${tag} has no available Sigstore signature bundle; continuing with digest checks.`);
    }

    const entries = manifest.toString('utf8').split(/\r?\n/).filter(Boolean).map(line => {
        const match = /^([a-fA-F0-9]{64}) [ *](.+)$/.exec(line);
        if (!match) throw new Error('Malformed checksum manifest');
        return { hash: match[1].toLowerCase(), name: match[2] };
    });

    if (new Set(entries.map(entry => entry.name)).size !== entries.length) {
        throw new Error('Duplicate checksum entry');
    }

    const expected = entries.find(entry => entry.name === archiveName);
    if (!expected || expected.hash !== archiveDigest) {
        throw new Error('poof archive SHA256 checksum mismatch');
    }
    if (expected.hash !== expectedDigest) {
        throw new Error('poof release manifest digest does not match GitHub asset metadata');
    }
    console.log('Verified poof archive SHA256 against the release checksum manifest');
} else {
    warn(`Warning: release ${tag} has no checksum manifest; Sigstore signature verification is unavailable. The GitHub API digest was verified.`);
}
