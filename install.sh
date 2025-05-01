#!/bin/bash

if [ "$(uname)" != "Darwin" ]; then
  echo "This script is intended for macOS only."
  exit 1
fi

mkdir -p "/tmp/Tritium"
if [ ! -d "/Applications/Tritium.app" ]; then
  echo "Tritium is not installed. Proceeding with installation."
else
  echo "Tritium is already installed. Deleting.."
  rm -rf "/Applications/Tritium.app"
  echo "Tritium has been deleted. Proceeding with installation."
fi
echo "Downloading Tritium..."
curl -L -o "/tmp/Tritium/Tritium.zip" "https://github.com/Phantom8015/Tritium/releases/download/v2.3.0/Tritium-2.3.0-arm64-mac.zip"
echo "Extracting Tritium..."
unzip -o "/tmp/Tritium/Tritium.zip" -d "/tmp/Tritium"
mv -f "/tmp/Tritium/Tritium.app" "/Applications"
rm -rf "/tmp/Tritium"

echo "Tritium has been successfully installed!"
