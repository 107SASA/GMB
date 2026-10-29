#!/bin/bash
# One-time iOS setup for this Mac, then launches the app in the iOS Simulator.
# Prerequisite: Xcode installed from the Mac App Store and opened once.
# Usage (from mobile/): bash scripts/setup-ios.sh
set -e
cd "$(dirname "$0")/.."

if [ ! -d /Applications/Xcode.app ]; then
  echo "Xcode not found. Install it from the Mac App Store, open it once, then re-run this."
  exit 1
fi

echo "==> Pointing command-line tools at Xcode and accepting the license (asks for your Mac password)"
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
xcodebuild -runFirstLaunch

echo "==> Making sure the iOS Simulator runtime is installed"
xcrun simctl list runtimes | grep -q "iOS" || xcodebuild -downloadPlatform iOS

if ! command -v brew >/dev/null 2>&1; then
  echo "==> Installing Homebrew"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
  eval "$(/opt/homebrew/bin/brew shellenv)"
fi

if ! command -v pod >/dev/null 2>&1; then
  echo "==> Installing CocoaPods"
  brew install cocoapods
fi

echo "==> Building and launching in the iOS Simulator (first build takes ~5-10 min)"
npx expo run:ios
