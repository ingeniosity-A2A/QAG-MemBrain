#!/data/data/com.termux/files/usr/bin/bash
# Termux setup for Ava007 edge node (S25 Ultra)
# Installs cloudflared, python, nodejs, and configures persistent tunnel.

set -e

echo "=== Ava007 Termux Setup ==="

# Update packages
pkg update -y && pkg upgrade -y

# Install essential tools
pkg install -y nodejs-lts python python-pip git openssl-tool termux-services termux-api

# Install cloudflared
if ! command -v cloudflared &> /dev/null; then
    echo "Installing cloudflared..."
    wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 -O $PREFIX/bin/cloudflared
    chmod +x $PREFIX/bin/cloudflared
fi

# Install RadioLib dependencies (for LoRa bridge)
pkg install -y cmake libusb

# Clone repository if not already present
REPO_URL="https://github.com/ingeniosity-A2A/QAG-MemBrain-.git"
if [ ! -d "$HOME/QAG_MemBrain" ]; then
    echo "Cloning QAG_MemBrain repository..."
    git clone "$REPO_URL" "$HOME/QAG_MemBrain"
fi

cd "$HOME/QAG_MemBrain"

# Install Node.js dependencies
npm install

# Build the project
npm run build

# Create Termux service for auto-start (using termux-services)
SERVICE_NAME="avamembrain"
SERVICE_SCRIPT="$PREFIX/var/service/$SERVICE_NAME/run"

mkdir -p "$(dirname "$SERVICE_SCRIPT")"
cat > "$SERVICE_SCRIPT" << EOF
#!/data/data/com.termux/files/usr/bin/bash
exec $HOME/QAG_MemBrain/scripts/start_gateway.sh
EOF
chmod +x "$SERVICE_SCRIPT"

echo "Service created. To start automatically on boot, run: sv up $SERVICE_NAME"
echo "To start now: sv up $SERVICE_NAME"

# Cloudflare tunnel setup (interactive)
if [ ! -f "$HOME/.cloudflared/cert.pem" ]; then
    echo "Please authenticate with Cloudflare Zero Trust:"
    cloudflared tunnel login
fi

echo "Termux setup complete. Next steps:"
echo "1. Edit $HOME/QAG_MemBrain/.env with your Telnyx API key and Cloudflare Tunnel ID."
echo "2. Start the gateway: $HOME/QAG_MemBrain/scripts/start_gateway.sh"
