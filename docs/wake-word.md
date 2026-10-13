# The "Hi {pal}" wake word

Hands-free wakes on "Hi / Hey / Hello / Uy / Oy + the pal's name" with a small on-device detector (`src/lib/wakeword.ts`). It catches the phrase about 0.2 s after the name is said, while the person may still be talking. Pal plays the mic-open sound and shows "Yes?" right away. If they stopped after the name, Pal says "Yes?" a quarter second later and listens. If they kept going ("Hi Rei, add gym at 5"), that sentence is the request.

Whisper still reads every sentence on the device and catches a "Hi {pal}" the detector missed (a second or two later). It is the only detector while Pal is talking (so Pal's own voice can't wake it), and when the detector's files can't load. Whisper isn't used to double-check the detector: on spoken test clips it wrote these names as "Hi, TV", "OJP" or "Hello, GP" too often (for Diel it confirmed only 7 of 25).

## How it works

| Step | File in `public/wakeword/` | What it does |
|---|---|---|
| Mel spectrogram | `melspectrogram.onnx` | 80 ms of 16 kHz audio → 8 frames × 32 bins |
| Speech embedding | `embedding_model.onnx` | The last 76 frames (775 ms) → 96 numbers. Google's speech embedding, via [openWakeWord](https://github.com/dscripka/openWakeWord) (Apache-2.0). |
| Classifier | `rei.onnx`, `diel.onnx`, `jhyvie.onnx`, `jaypee.onnx` | The last 16 embeddings (1.28 s) → a score from 0 to 1. Only the current pal's file is loaded. |
| Thresholds | `models.json` | The score that counts as a wake, for each pal |

All of it runs on the voice detector's ONNX runtime (one wasm, one thread). It takes a few milliseconds every 80 ms. Nothing leaves the device.

## How each name is said

These are the spellings the training voices read aloud (`NAMES` in `scripts/wakeword/gen.py`):

| Pal | Said as |
|---|---|
| Rei | "ray" |
| Diel | "dyel", "dee yell", "jel" |
| Jhyvie | "JEE-vee" |
| Jaypee | "jay-pee" |

## Retraining (new name, new pronunciation, or too many false wakes)

You need about 5 GB of disk and an hour on an M1.

```sh
mkdir -p .cache/wakeword/{data,voices} && cd .cache/wakeword
python3.12 -m venv venv && venv/bin/pip install numpy scipy soundfile onnx onnxruntime torch openwakeword piper-tts
# Piper voices for the training speech (904 + 109 speakers)
for v in en/en_US/libritts_r/medium/en_US-libritts_r-medium en/en_GB/vctk/medium/en_GB-vctk-medium; do
  curl -sL -o "voices/${v##*/}.onnx" "https://huggingface.co/rhasspy/piper-voices/resolve/main/$v.onnx"
  curl -sL -o "voices/${v##*/}.onnx.json" "https://huggingface.co/rhasspy/piper-voices/resolve/main/$v.onnx.json"
done
# Everyday audio that must not wake it (the first 4 GB of 2,000 h is plenty), and 10.7 h for counting false wakes
F=https://huggingface.co/datasets/davidscripka/openwakeword_features/resolve/main
curl -sL -r 0-3999999999 -o data/acav_part.npy $F/openwakeword_features_ACAV100M_2000_hrs_16bit.npy
curl -sL -o data/validation_set_features.npy $F/validation_set_features.npy

venv/bin/python ../../scripts/wakeword/gen.py      # ~30 min: 900 "Hi {pal}" clips per pal + 1,600 that must not wake it
venv/bin/python ../../scripts/wakeword/gen.py others   # ~6 min: 800 "hi {someone else}" clips
rm -f data/features.npz                            # clips changed: rebuild the features
venv/bin/python ../../scripts/wakeword/train.py    # ~15 min: writes out/{pal}.onnx, out/models.json, out/results.json
cp out/*.onnx out/models.json ../../public/wakeword/
```

To change how a name is said, edit `NAMES` (and the sound-alikes in `HARD`) in `gen.py`.

`out/results.json` reports, for each pal:
- **recall_heldout_voices**: how often it wakes for voices it never trained on;
- **false_wakes_per_hour**: wakes on 5.3 h of real speech, TV and music it never trained on (the other half of the 10.7 h is used to find its mistakes). The target is 0.5 or less;
- **other_pals_waking_it**: how often another pal's "Hi {name}" wakes this one.

Check it in the browser (dev server) on any 16 kHz WAV:

```js
await window.__palWakeTest({ pal: 'rei', urls: ['/@fs/<absolute path>/clip.wav'] })
// → [{ threshold, fired: [steps], scores: [...], msPerStep }]
```
