#!/bin/bash
set -e

VERSION="${1:-0.108.0}"

# Detect architecture (using musl build for glibc compatibility)
ARCH=$(uname -m)
case "$ARCH" in
  x86_64)  TARGET="x86_64-unknown-linux-musl" ;;
  aarch64) TARGET="aarch64-unknown-linux-musl" ;;
  *)       echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

FILENAME="nu-${VERSION}-${TARGET}.tar.gz"
URL="https://github.com/nushell/nushell/releases/download/${VERSION}/${FILENAME}"
INSTALL_DIR="/usr/local/bin"

echo "Installing Nushell ${VERSION} for ${TARGET}..."

# Download and extract
curl -LO "$URL"
tar xzf "$FILENAME"

# Install
sudo mv "nu-${VERSION}-${TARGET}/nu" "$INSTALL_DIR/"

# Clean up
rm -rf "nu-${VERSION}-${TARGET}" "$FILENAME"

# Ensure /usr/local/bin is in PATH
if ! echo "$PATH" | grep -q "$INSTALL_DIR"; then
  echo "export PATH=\"$INSTALL_DIR:\$PATH\"" >> ~/.bashrc
  export PATH="$INSTALL_DIR:$PATH"
  echo "Added $INSTALL_DIR to PATH in ~/.bashrc"
fi

# Add to /etc/shells if not present
if ! grep -q "$INSTALL_DIR/nu" /etc/shells 2>/dev/null; then
  echo "$INSTALL_DIR/nu" | sudo tee -a /etc/shells
  echo "Added nu to /etc/shells"
fi

echo "Installed: $(nu --version)"
echo "Run 'source ~/.bashrc' or start a new shell to use nu"
