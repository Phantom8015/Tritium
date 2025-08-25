#!/bin/bash
architecture=$(uname -m)
if [[ "$architecture" == "arm64" ]]; then
  url="https://github.com/Phantom8015/Tritium/releases/download/v4.1.2/Tritium-4.1.2-arm64-mac.zip"
elif [[ "$architecture" == "x86_64" ]]; then
  url="https://github.com/Phantom8015/Tritium/releases/download/v4.1.2/Tritium-4.1.2-mac.zip"
else
  echo "Unsupported architecture: $architecture"
  exit 1
fi

mkdir -p "/tmp/Tritium"
if [ -d "/Applications/Tritium.app" ]; then
  echo "Tritium is already installed. Deleting..."
  rm -rf "/Applications/Tritium.app"
  echo "Tritium has been deleted."
else
  echo "Tritium is not installed. Proceeding with installation."
fi
clear
echo "Downloading Tritium for $architecture..."
curl -L -o "/tmp/Tritium/Tritium.zip" "$url"
echo "Extracting Tritium..."
unzip -o "/tmp/Tritium/Tritium.zip" -d "/tmp/Tritium"
mv -f "/tmp/Tritium/Tritium.app" "/Applications"
rm -rf "/tmp/Tritium"
clear
echo "Tritium has been successfully installed! Please restart the app if it was running during installation."
