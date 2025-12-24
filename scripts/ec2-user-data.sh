#!/bin/bash
set -e

# Log everything
exec > >(tee /var/log/opencode-setup.log) 2>&1

echo "=== Starting OpenCode setup ==="

# Update system
apt-get update -y
apt-get upgrade -y

# Install FUSE and development tools
apt-get install -y fuse3 libfuse3-dev git unzip

# Enable FUSE
modprobe fuse
echo 'fuse' > /etc/modules-load.d/fuse.conf

# Allow user_allow_other for FUSE mounts
echo 'user_allow_other' >> /etc/fuse.conf

# Install Nushell (using musl build for glibc compatibility)
NU_VERSION="0.108.0"
ARCH=$(uname -m)
case "$ARCH" in
  x86_64)  NU_TARGET="x86_64-unknown-linux-musl" ;;
  aarch64) NU_TARGET="aarch64-unknown-linux-musl" ;;
  *)       echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac
NU_FILENAME="nu-${NU_VERSION}-${NU_TARGET}.tar.gz"
curl -LO "https://github.com/nushell/nushell/releases/download/${NU_VERSION}/${NU_FILENAME}"
tar xzf "$NU_FILENAME"
mv "nu-${NU_VERSION}-${NU_TARGET}/nu" /usr/local/bin/
rm -rf "nu-${NU_VERSION}-${NU_TARGET}" "$NU_FILENAME"
echo '/usr/local/bin/nu' >> /etc/shells
echo "Installed Nushell: $(nu --version)"

# Create ssm-user (SSM creates it on first connect, but we need it now)
useradd -m -s /usr/local/bin/nu ssm-user
echo "ssm-user ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/ssm-user

# Install Bun and OpenCode for ssm-user
sudo -u ssm-user bash << 'BUNEOF'
cd ~
curl -fsSL https://bun.sh/install | bash

# Configure bash
echo 'export BUN_INSTALL="$HOME/.bun"' >> ~/.bashrc
echo 'export PATH="$BUN_INSTALL/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc

# Configure nushell
mkdir -p ~/.config/nushell
cat >> ~/.config/nushell/config.nu << 'NUCONFIG'
# Bun
$env.BUN_INSTALL = $"($env.HOME)/.bun"
$env.PATH = ($env.PATH | split row (char esep) | prepend $"($env.BUN_INSTALL)/bin" | uniq)

# Cargo (for AgentFS)
$env.PATH = ($env.PATH | split row (char esep) | prepend $"($env.HOME)/.cargo/bin" | uniq)
NUCONFIG

# Install OpenCode globally
~/.bun/bin/bun install -g opencode-ai

# Install AgentFS
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/tursodatabase/agentfs/releases/download/v0.4.0-pre.6/agentfs-installer.sh | sh

# Create directories
mkdir -p ~/.agentfs/mounts
mkdir -p ~/projects

# Clone and install AgentFS plugin
cd ~/projects
git clone https://github.com/pedrocarlo/agentfs-opencode.git
cd agentfs-opencode
~/.bun/bin/bun install
~/.bun/bin/bun run build
~/.bun/bin/bun run link

echo "=== OpenCode setup complete ==="
BUNEOF

# Mark setup as complete
touch /tmp/opencode-setup-complete

# Set nushell as default shell for ssm-user
sudo chsh -s /usr/local/bin/nu ssm-user

