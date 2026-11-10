#!/usr/bin/env bash
# Installs poof to $POOF_INSTALL_DIR.
# Expected environment variables:
#   POOF_INSTALL_DIR  - directory to install the poof binary (required, set by the task)
#   POOF_VERSION      - version to install, defaults to 'latest'
#   GITHUB_TOKEN      - GitHub PAT for authenticated API requests (avoids rate limiting)

set -euo pipefail

INSTALL_DIR="${POOF_INSTALL_DIR:?}"
NODE="${POOF_NODE:-node}"
TAG="${POOF_VERSION:-latest}"
RELEASE_URL="https://github.com/pirafrank/poof/releases/tag"

if [[ "$TAG" != latest ]]; then
  [[ "$TAG" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9._-]+)?$ ]] || {
    echo "Invalid poof version; use latest or an exact release such as v0.6.0" >&2
    exit 1
  }
  [[ "$TAG" == v* ]] || TAG="v$TAG"
fi

OS="$(uname -s)"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) ARCH="x86_64" ;;
  aarch64|arm64) ARCH="aarch64" ;;
  *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac
case "$OS" in
  Linux)
    LDD_OUT=$(ldd --version 2>&1 || true)
    if ! printf '%s\n' "$LDD_OUT" | grep -qi 'glibc\|gnu libc'; then
      echo "Linux agents require glibc and the Node24 task runner" >&2
      exit 1
    fi
    TARGET="${ARCH}-unknown-linux-gnu"
    ;;
  Darwin) TARGET="${ARCH}-apple-darwin" ;;
  *) echo "Unsupported OS: $OS" >&2; exit 1 ;;
esac

binary_version() {
  "$NODE" -e '
    const {execFileSync} = require("node:child_process");
    const env = {...process.env}; delete env.GITHUB_TOKEN;
    try { process.stdout.write(execFileSync(process.argv[1], ["--version"], {env, timeout: 10000})); }
    catch { process.exit(1); }
  ' "$1"
}

if [[ -f "$INSTALL_DIR/poof" && ! -L "$INSTALL_DIR/poof" ]]; then
  EXISTING_VERSION="$(binary_version "$INSTALL_DIR/poof" 2>/dev/null || true)"
  if { [[ "$TAG" == latest ]] && printf '%s\n' "$EXISTING_VERSION" | grep -Eq '^https://github\.com/pirafrank/poof/releases/tag/v[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9._-]+)?$'; } ||
     { [[ "$TAG" != latest ]] && printf '%s\n' "$EXISTING_VERSION" | grep -Fxq "$RELEASE_URL/$TAG"; }; then
    echo "Reusing poof in $INSTALL_DIR"
    exit 0
  fi
  if ! printf '%s\n' "$EXISTING_VERSION" | grep -Eq '^https://github\.com/pirafrank/poof/releases/tag/v[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9._-]+)?$'; then
    echo "Refusing to overwrite an unrecognized executable in $INSTALL_DIR/poof" >&2
    exit 1
  fi
elif [[ -e "$INSTALL_DIR/poof" || -L "$INSTALL_DIR/poof" ]]; then
  echo "Refusing to overwrite a non-regular poof executable" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
ENDPOINT=latest
[[ "$TAG" == latest ]] || ENDPOINT="tags/$TAG"
CURL_ARGS=(-fsSL --connect-timeout 15 --max-time 120 --retry 2 --proto '=https' --proto-redir '=https')
API_URL="https://api.github.com/repos/pirafrank/poof/releases/$ENDPOINT"
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  printf 'Authorization: Bearer %s\n' "$GITHUB_TOKEN" |
    curl "${CURL_ARGS[@]}" --header @- -H 'Accept: application/vnd.github+json' "$API_URL" -o "$TMP/release.json"
else
  curl "${CURL_ARGS[@]}" -H 'Accept: application/vnd.github+json' "$API_URL" -o "$TMP/release.json"
fi
RELEASE_INFO="$("$NODE" -e '
  const release = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  if (!/^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9._-]+)?$/.test(release.tag_name) || !Array.isArray(release.assets)) {
    throw new Error("Invalid poof release metadata");
  }
  const name = `poof-${release.tag_name.slice(1)}-checksums.txt`;
  console.log(release.tag_name, release.assets.some(asset => asset.name === name) ? "yes" : "no");
' "$TMP/release.json")"
read -r RESOLVED_TAG HAS_CHECKSUM <<< "$RELEASE_INFO"
if [[ "$TAG" != latest && "$TAG" != "$RESOLVED_TAG" ]]; then
  echo "Resolved release does not match requested poof version" >&2
  exit 1
fi
TAG="$RESOLVED_TAG"
VERSION="${TAG#v}"
FILENAME="poof-${VERSION}-${TARGET}.tar.gz"
BASE_URL="https://github.com/pirafrank/poof/releases/download/$TAG"
curl "${CURL_ARGS[@]}" "$BASE_URL/$FILENAME" -o "$TMP/$FILENAME"

if [[ "$HAS_CHECKSUM" == yes ]]; then
  curl "${CURL_ARGS[@]}" "$BASE_URL/poof-$VERSION-checksums.txt" -o "$TMP/checksums.txt"
  "$NODE" -e '
    const fs = require("node:fs");
    const crypto = require("node:crypto");
    const entries = fs.readFileSync(process.argv[1], "utf8").split(/\r?\n/).filter(Boolean).map(line => {
      const entry = /^([a-fA-F0-9]{64}) [ *](.+)$/.exec(line);
      if (!entry) throw new Error("Malformed checksum manifest");
      return {hash: entry[1].toLowerCase(), name: entry[2]};
    });
    if (new Set(entries.map(entry => entry.name)).size !== entries.length) throw new Error("Duplicate checksum entry");
    const expected = entries.find(entry => entry.name === process.argv[3]);
    const actual = crypto.createHash("sha256").update(fs.readFileSync(process.argv[2])).digest("hex");
    if (!expected || expected.hash !== actual) throw new Error("poof archive SHA256 checksum mismatch");
  ' "$TMP/checksums.txt" "$TMP/$FILENAME" "$FILENAME"
else
  echo "Warning: release $TAG has no checksum manifest; validation uses HTTPS and executable version only." >&2
fi

MEMBERS="$(tar -tzf "$TMP/$FILENAME")"
MEMBER="$(printf '%s\n' "$MEMBERS" | grep -Ex '(\./)?poof' || true)"
[[ "$MEMBER" == poof || "$MEMBER" == ./poof ]] || { echo "Archive must contain exactly one poof executable" >&2; exit 1; }
DETAILS="$(tar -tvzf "$TMP/$FILENAME" "$MEMBER")"
[[ "$DETAILS" == -* && "$DETAILS" != *$'\n'* ]] || { echo "poof archive member must be a regular file" >&2; exit 1; }
tar -xOzf "$TMP/$FILENAME" "$MEMBER" > "$TMP/poof"
chmod 755 "$TMP/poof"
DOWNLOADED_VERSION="$(binary_version "$TMP/poof")"
printf '%s\n' "$DOWNLOADED_VERSION" | grep -Fxq "$RELEASE_URL/$TAG" || {
  echo "Downloaded binary is not the requested poof release" >&2
  exit 1
}
mkdir -p "$INSTALL_DIR"
STAGED="$(mktemp "$INSTALL_DIR/.poof.XXXXXX")"
trap 'rm -rf "$TMP"; rm -f "$STAGED"' EXIT
cp "$TMP/poof" "$STAGED"
chmod 755 "$STAGED"
mv -f "$STAGED" "$INSTALL_DIR/poof"
echo "Installed poof $TAG for $TARGET"
