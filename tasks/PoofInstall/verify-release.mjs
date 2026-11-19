#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const [archivePath, archiveName, apiDigest, manifestPath, bundlePath, tag] = process.argv.slice(2);

if (!archivePath || !archiveName || !tag) {
    throw new Error('Usage: verify-release.mjs <archive> <name> <api-digest|-> <manifest|-> <bundle|-> <tag>');
}

const archive = await readFile(archivePath);
const archiveDigest = createHash('sha256').update(archive).digest('hex');

if (apiDigest) {
    const expectedDigest = apiDigest.slice('sha256:'.length);
    if (archiveDigest !== expectedDigest) {
        throw new Error('poof archive SHA256 digest from GitHub API does not match');
    }
    console.log('Verified poof archive SHA256 against GitHub release metadata');
} else {
    console.warn(`Warning: GitHub API did not provide an archive SHA256 digest for ${archiveName}.`);
}

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
        console.warn(`Warning: poof release ${tag} has no available Sigstore signature bundle; continuing with digest checks.`);
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
    if (apiDigest && expected.hash !== apiDigest.slice('sha256:'.length)) {
        throw new Error('poof release manifest digest does not match GitHub asset metadata');
    }
    console.log('Verified poof archive SHA256 against the release checksum manifest');
} else if (apiDigest) {
    console.warn(`Warning: release ${tag} has no checksum manifest; the GitHub API digest was verified.`);
} else {
    console.warn(`Warning: release ${tag} has no checksum manifest or GitHub API digest; validation uses HTTPS and executable version only.`);
}
