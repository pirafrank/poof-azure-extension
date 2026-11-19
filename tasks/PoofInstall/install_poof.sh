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
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

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
    TARGET="${ARCH}-unknown-linux-musl"
    ;;
  Darwin) TARGET="${ARCH}-apple-darwin" ;;
  *) echo "Unsupported OS: $OS" >&2; exit 1 ;;
esac

binary_version() {
  "$NODE" -e '
    const {execFileSync} = require("node:child_process");
    const env = {...process.env}; delete env.GITHUB_TOKEN;
    try {
      process.stdout.write(execFileSync(process.argv[1], ["--version"], {
        env, timeout: 10000, killSignal: "SIGKILL", encoding: "utf8",
      }));
    } catch (error) {
      console.error(error.code === "ETIMEDOUT"
        ? "poof version check timed out after 10 seconds"
        : "poof version check failed");
      process.exit(1);
    }
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
RELEASE_INFO="$("$NODE" "$SCRIPT_DIR/release-metadata.mjs" "$TMP/release.json" "$TARGET")"
IFS=$'\t' read -r RESOLVED_TAG HAS_CHECKSUM HAS_SIGSTORE API_DIGEST <<< "$RELEASE_INFO"
if [[ "$TAG" != latest && "$TAG" != "$RESOLVED_TAG" ]]; then
  echo "Resolved release does not match requested poof version" >&2
  exit 1
fi
TAG="$RESOLVED_TAG"
VERSION="${TAG#v}"
FILENAME="poof-${VERSION}-${TARGET}.tar.gz"
BASE_URL="https://github.com/pirafrank/poof/releases/download/$TAG"
curl "${CURL_ARGS[@]}" "$BASE_URL/$FILENAME" -o "$TMP/$FILENAME"

MANIFEST_PATH=-
BUNDLE_PATH=-
if [[ "$HAS_CHECKSUM" == yes ]]; then
  if curl "${CURL_ARGS[@]}" "$BASE_URL/poof-$VERSION-checksums.txt" -o "$TMP/checksums.txt"; then
    MANIFEST_PATH="$TMP/checksums.txt"
    if [[ "$HAS_SIGSTORE" == yes ]]; then
      if curl "${CURL_ARGS[@]}" "$BASE_URL/poof-$VERSION-checksums.txt.sigstore.json" -o "$TMP/checksums.sigstore.json"; then
        BUNDLE_PATH="$TMP/checksums.sigstore.json"
      else
        echo "Could not download the advertised poof checksum manifest signature bundle." >&2
        exit 1
      fi
    fi
  elif [[ "$HAS_SIGSTORE" == yes ]]; then
    echo "Could not download the poof checksum manifest required for signature verification." >&2
    exit 1
  elif [[ -z "$API_DIGEST" ]]; then
    echo "Could not download the poof checksum manifest and GitHub API supplied no archive digest." >&2
    exit 1
  else
    if [[ "${TF_BUILD:-}" == [Tt][Rr][Uu][Ee] ]]; then
      echo "##vso[task.logissue type=warning;]poof checksum manifest could not be downloaded; falling back to the GitHub API digest."
    else
      echo "Warning: poof checksum manifest could not be downloaded; falling back to the GitHub API digest." >&2
    fi
  fi
fi

if [[ "$HAS_SIGSTORE" == yes && "$MANIFEST_PATH" == - ]]; then
  echo "Advertised poof signature bundle has no checksum manifest to verify." >&2
  exit 1
fi

"$NODE" "$SCRIPT_DIR/verify-release.mjs" "$TMP/$FILENAME" "$FILENAME" "$API_DIGEST" "$MANIFEST_PATH" "$BUNDLE_PATH" "$TAG"

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
