# The Python side of the browser check: streams WAVs through openWakeWord's own streaming features and a pal's
# classifier, 80 ms at a time like the app, and prints each score. Compare with window.__palWakeTest (docs/wake-word.md).
#   cd .cache/wakeword && venv/bin/python ../../scripts/wakeword/parity.py rei test/rei_pos.wav …
import json, os, sys, wave
import numpy as np, onnxruntime as ort
from openwakeword.utils import AudioFeatures

pal, files = sys.argv[1], sys.argv[2:]
clf = ort.InferenceSession(f"{os.environ.get('WAKE_OUT', 'out')}/{pal}.onnx")
out = {}
for f in files:
    feat = AudioFeatures(inference_framework='onnx')
    with wave.open(f) as r: x = np.frombuffer(r.readframes(r.getnframes()), dtype=np.int16)
    scores = []
    for i in range(0, len(x) - 1279, 1280):
        feat(x[i:i + 1280])
        scores.append(float(clf.run(None, {'input': feat.get_features(16).astype(np.float32)})[0][0][0]))
    out[f] = scores
print(json.dumps(out))
