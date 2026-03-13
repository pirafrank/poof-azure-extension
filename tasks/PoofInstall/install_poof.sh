#!/usr/bin/env bash
# Installs poof to $POOF_INSTALL_DIR.
# Expected environment variables:
#   POOF_INSTALL_DIR  - directory to install the poof binary (required, set by the task)
#   POOF_VERSION      - version to install, defaults to 'latest'
#   GITHUB_TOKEN      - GitHub PAT for authenticated API requests (avoids rate limiting)

set -euo pipefail

INSTALL_DIR="${POOF_INSTALL_DIR}"
mkdir -p "$INSTALL_DIR"

if [[ -f "$INSTALL_DIR/poof" ]] && { "$INSTALL_DIR/poof" --version 2>&1 | grep -q "pirafrank"; }; then
  echo "poof already installed in $INSTALL_DIR, skipping installation"
else
  TAG="${POOF_VERSION:-latest}"

  # Resolve 'latest' to a concrete tag via the GitHub API
  if [ "$TAG" = "latest" ]; then
    echo "Fetching latest poof release tag..."
    TAG=$(curl -fsSL \
      ${GITHUB_TOKEN:+-H "Authorization: Bearer ${GITHUB_TOKEN}"} \
      -H "Accept: application/vnd.github+json" \
      "https://api.github.com/repos/pirafrank/poof/releases/latest" \
      | grep '"tag_name"' | head -1 \
      | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')
    echo "Resolved latest poof: $TAG"
  fi

  [[ "$TAG" != v* ]] && TAG="v$TAG"
  VERSION="${TAG#v}"

  OS="$(uname -s)"
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64|amd64)   ARCH="x86_64"  ;;
    aarch64|arm64)  ARCH="aarch64" ;;
    i386|i586|i686) ARCH="i686"    ;;
    armv7l|armv7)   ARCH="armv7"   ;;
    *)
      echo "Unsupported architecture: $ARCH"
      exit 1
      ;;
  esac

  case "$OS" in
    Linux)
      LDD_OUT=$(ldd --version 2>&1 || true)
      if echo "$LDD_OUT" | grep -qi "glibc\|gnu libc"; then
        TARGET="${ARCH}-unknown-linux-gnu"
      else
        TARGET="${ARCH}-unknown-linux-musl"
      fi
      ;;
    Darwin)
      TARGET="${ARCH}-apple-darwin"
      ;;
    *)
      echo "Unsupported OS: $OS"
      exit 1
      ;;
  esac

  FILENAME="poof-${VERSION}-${TARGET}.tar.gz"
  URL="https://github.com/pirafrank/poof/releases/download/${TAG}/${FILENAME}"

  echo "Installing poof ${TAG} for ${TARGET}..."
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT

  curl -fL "$URL" -o "$TMP/$FILENAME"
  tar -xzf "$TMP/$FILENAME" -C "$TMP"
  mv "$TMP/poof" "$INSTALL_DIR/poof"
  chmod +x "$INSTALL_DIR/poof"
fi

echo "poof $("$INSTALL_DIR/poof" --version)"
