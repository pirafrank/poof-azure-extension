#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

const [metadataPath, target] = process.argv.slice(2);

if (!metadataPath || !target) {
    throw new Error('Usage: release-metadata.mjs <release.json> <target>');
}

const release = JSON.parse(await readFile(metadataPath, 'utf8'));
if (!/^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9._-]+)?$/.test(release.tag_name) || !Array.isArray(release.assets)) {
    throw new Error('Invalid poof release metadata');
}

const version = release.tag_name.slice(1);
const manifestName = `poof-${version}-checksums.txt`;
const archiveName = `poof-${version}-${target}.tar.gz`;
const archive = release.assets.find(asset => asset.name === archiveName);
const digest = archive?.digest;

if (!digest) {
    throw new Error(`Missing GitHub asset SHA256 digest for ${archiveName}`);
}

if (typeof digest !== 'string' || !/^sha256:[a-f0-9]{64}$/i.test(digest)) {
    throw new Error(`Invalid GitHub asset digest for ${archiveName}`);
}

const hasAsset = name => release.assets.some(asset => asset.name === name);
process.stdout.write([
    release.tag_name,
    hasAsset(manifestName) ? 'yes' : 'no',
    hasAsset(`${manifestName}.sigstore.json`) ? 'yes' : 'no',
    digest.toLowerCase(),
].join('\t'));
