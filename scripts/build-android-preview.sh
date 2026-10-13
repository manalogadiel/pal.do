#!/usr/bin/env bash
# macOS/Linux twin of build-android-preview.ps1: bundle the model, build the web app, and build + unit-test the APK.
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

# Android Studio ships its own Java and puts the SDK here by default
studio_jbr='/Applications/Android Studio.app/Contents/jbr/Contents/Home'
brew_jdk='/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home'
if [ -z "${JAVA_HOME:-}" ] && [ -d "$studio_jbr" ]; then export JAVA_HOME="$studio_jbr"; fi
if [ -z "${JAVA_HOME:-}" ] && [ -d "$brew_jdk" ]; then export JAVA_HOME="$brew_jdk"; fi
# Gradle's Java 21 toolchain only finds JDKs macOS knows about; a Homebrew one needs this link (no sudo)
if [ -d "$brew_jdk" ] && [ ! -e "$HOME/Library/Java/JavaVirtualMachines/openjdk-21.jdk" ]; then
  mkdir -p "$HOME/Library/Java/JavaVirtualMachines" && ln -s "${brew_jdk%/Contents/Home}" "$HOME/Library/Java/JavaVirtualMachines/openjdk-21.jdk"
fi
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
if [ -z "${JAVA_HOME:-}" ] && ! /usr/libexec/java_home >/dev/null 2>&1; then
  echo 'No Java found. Run: brew install openjdk@21 (or install Android Studio).' >&2; exit 1
fi
if [ ! -d "$ANDROID_HOME" ]; then
  echo "No Android SDK at $ANDROID_HOME. Open Android Studio once and finish the setup wizard, or set ANDROID_HOME." >&2; exit 1
fi
[ -f android/local.properties ] || echo "sdk.dir=$ANDROID_HOME" > android/local.properties

model_name='qwen2.5-1.5b-instruct-q4_k_m.gguf'
model_file=".cache/android-ai/$model_name"
model_hash='6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e'
[ -f "$model_file" ] || bash scripts/prepare-android-ai.sh
[ "$(shasum -a 256 "$model_file" | cut -d' ' -f1)" = "$model_hash" ] || { echo 'Bundled model checksum mismatch' >&2; exit 1; }
mkdir -p android/app/src/preview/assets/models
cp "$model_file" "android/app/src/preview/assets/models/$model_name"

pnpm exec vite build --mode android-preview
PALDO_ANDROID_PREVIEW=1 pnpm exec cap sync android
cd android
chmod +x gradlew
./gradlew :app:assemblePreviewDebug :app:assemblePreviewDebugAndroidTest :app:testPreviewDebugUnitTest --console=plain
echo "APK: android/app/build/outputs/apk/preview/debug/app-preview-debug.apk"
