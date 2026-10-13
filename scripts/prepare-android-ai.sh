#!/usr/bin/env bash
# macOS/Linux twin of prepare-android-ai.ps1: the pinned llama.cpp engine, licenses, and the checked Qwen model.
# Usage: scripts/prepare-android-ai.sh [--engine-only]
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cache_root="$repo_root/.cache/android-ai"
mkdir -p "$cache_root"
engine_revision='f2cc7282ce0042641df55e0e563b75e824e2b647'
model_revision='91cad51170dc346986eccefdc2dd33a9da36ead9'
model_name='qwen2.5-1.5b-instruct-q4_k_m.gguf'
model_hash='6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e'
model_repo='Qwen/Qwen2.5-1.5B-Instruct-GGUF'
sha() { shasum -a 256 "$1" | cut -d' ' -f1; }

engine_root="$cache_root/llama.cpp-$engine_revision"
if [ ! -f "$engine_root/.ready" ]; then
  archive="$cache_root/engine.zip"
  [ -f "$archive" ] || curl -fL "https://codeload.github.com/ggml-org/llama.cpp/zip/$engine_revision" -o "$archive"
  # Same parts left out as the Windows script; unzip refuses paths that escape the folder
  # (unzip's * also matches "/", so the top-level folder is named exactly: src/models must stay)
  top="llama.cpp-$engine_revision"
  unzip -q -o "$archive" -d "$cache_root" -x "$top/tools/*" "$top/examples/*" "$top/tests/*" "$top/models/*" "$top/media/*" "$top/.github/*"
  sha "$archive" > "$cache_root/engine-archive.sha256"
  echo "$engine_revision" > "$engine_root/.ready"
fi
echo "Engine ready: $engine_revision"

license_root="$repo_root/android/app/src/main/assets/licenses"
mkdir -p "$license_root"
cp "$engine_root/LICENSE" "$license_root/llama.cpp-LICENSE.txt"
[ -f "$license_root/Qwen2.5-LICENSE.txt" ] || curl -fL "https://huggingface.co/$model_repo/resolve/$model_revision/LICENSE" -o "$license_root/Qwen2.5-LICENSE.txt"
[ -f "$license_root/nlohmann-json-LICENSE.txt" ] || curl -fL 'https://raw.githubusercontent.com/nlohmann/json/v3.12.0/LICENSE.MIT' -o "$license_root/nlohmann-json-LICENSE.txt"

if [ "${1:-}" != "--engine-only" ]; then
  model_file="$cache_root/$model_name"
  if [ ! -f "$model_file" ]; then
    partial="$model_file.partial"
    # -C - resumes a download that was cut off (it's 1.1 GB)
    curl -fL -C - "https://huggingface.co/$model_repo/resolve/$model_revision/$model_name?download=true" -o "$partial"
    [ "$(sha "$partial")" = "$model_hash" ] || { rm -f "$partial"; echo 'Model checksum mismatch; file was not activated.' >&2; exit 1; }
    mv "$partial" "$model_file"
  fi
  [ "$(sha "$model_file")" = "$model_hash" ] || { echo 'Cached model checksum mismatch.' >&2; exit 1; }
  echo "Model verified: $model_name"
fi
