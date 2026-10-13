# Train one tiny wake-word classifier per pal on openWakeWord speech embeddings, then export it to ONNX for the browser.
#   cd .cache/wakeword && venv/bin/python ../../scripts/wakeword/train.py [rei …]   (docs/wake-word.md)
# Positives: synthetic "Hi {pal}" (gen.py), augmented. Negatives: ~460h of everyday audio features (ACAV100M), the
# look-alike and everyday TTS lines, the *other* pals' wake phrases, and what it still gets wrong in half of 10.7h of
# real speech/TV/music (mined). Scored on held-out voices, and on the other 5.3h for false wakes per hour.
import json, os, random, sys, time, wave
import numpy as np
import torch, torch.nn as nn
from scipy.signal import fftconvolve, butter, sosfilt
from openwakeword.utils import AudioFeatures

random.seed(1); np.random.seed(1); torch.manual_seed(1)
SR, WIN = 16000, 32000            # 2 s windows -> 16 embeddings (what the app scores every 80 ms)
PALS = sys.argv[1:] or ['rei', 'diel', 'jhyvie', 'jaypee']
meta = json.load(open('data/clips.json'))
feat = AudioFeatures(inference_framework='onnx', ncpu=8)

def load(path):
    with wave.open(path) as r: return np.frombuffer(r.readframes(r.getnframes()), dtype=np.int16).astype(np.float32) / 32767

negs = [load(m['path']) for m in meta if m['split'] == 'neg']

def trim(x):
    """The spoken part, without leading/trailing silence"""
    e = np.abs(x) > 0.02
    if not e.any(): return x
    i, j = np.argmax(e), len(e) - np.argmax(e[::-1])
    return x[max(0, i - 800):min(len(x), j + 400)]

def rir():
    n = int(SR * random.uniform(0.15, 0.6))
    t = np.arange(n) / SR
    h = np.random.randn(n) * np.exp(-t * random.uniform(6, 20)); h[0] = 1
    return h / np.abs(h).sum() * random.uniform(3, 8)

def augment(x):
    if random.random() < 0.5:  # speed
        f = random.uniform(0.9, 1.12); x = np.interp(np.arange(0, len(x), f), np.arange(len(x)), x)
    if random.random() < 0.35:  # room echo
        wet = fftconvolve(x, rir())[:len(x)]; x = x * (1 - (m := random.uniform(0.2, 0.6))) + wet * m
    if random.random() < 0.4:  # phone / laptop mic
        x = sosfilt(butter(4, [random.uniform(80, 300), random.uniform(3400, 7000)], 'bandpass', fs=SR, output='sos'), x)
    return x * 10 ** (random.uniform(-16, 4) / 20)

def background(n):
    kind = random.random()
    if kind < 0.3: b = np.zeros(n)
    elif kind < 0.65: b = np.random.randn(n) * 10 ** (random.uniform(-60, -30) / 20)        # room noise
    else:                                                                                  # people talking nearby
        b = np.zeros(n); s = random.choice(negs); k = min(len(s), n); st = random.randint(0, n - k); b[st:st + k] = s[:k]
        b *= 10 ** (random.uniform(-30, -12) / 20)
    return b

def place_end(x, end_jitter=(0, 0.25)):
    """Phrase ending just before the window ends: that's the moment the detector should fire"""
    x = x[-WIN:]
    out = background(WIN)
    end = WIN - int(SR * random.uniform(*end_jitter))
    st = max(0, end - len(x)); out[st:st + len(x[-(end - st):])] += x[-(end - st):]
    return out

def place_anywhere(x):
    out = background(WIN)
    x = x[:WIN]; st = random.randint(0, WIN - len(x)) if len(x) < WIN else 0
    out[st:st + len(x)] += x
    return out

def embed(clips):
    a = (np.clip(np.stack(clips), -1, 1) * 32767).astype(np.int16)
    return feat.embed_clips(a, batch_size=128, ncpu=8)[:, -16:, :].astype(np.float32)

# --- features for every pal's phrases (each pal's positives are hard negatives for the others) ---
cache = 'data/features.npz'
if os.path.exists(cache):
    F = dict(np.load(cache))
else:
    F = {}
    t = time.time()
    for pal in ['rei', 'diel', 'jhyvie', 'jaypee']:
        for split, reps in [('train', 4), ('test', 3)]:
            xs = [trim(load(m['path'])) for m in meta if m['pal'] == pal and m['split'] == split]
            F[f'{pal}_{split}'] = embed([place_end(augment(x)) for x in xs for _ in range(reps)])
            # The same phrase heard a moment ago (ended 0.6-1.2s before now) must not fire again
            if split == 'train': F[f'{pal}_late'] = embed([place_end(augment(x), (0.6, 1.2)) for x in xs[:400]])
        print(pal, 'features', F[f'{pal}_train'].shape, round(time.time() - t), 's'); sys.stdout.flush()
    F['noise'] = embed([background(WIN) * (10 ** (random.uniform(-10, 10) / 20)) for _ in range(3000)])
    np.savez(cache, **F)
    print('features done', round(time.time() - t), 's')
# Look-alikes and everyday lines anywhere in the window, and also ending right where a wake phrase would ("hey Gabby"
# placed like "hey Diel" must score low too: placed only at random spots, it learned "greeting + name, ending now")
if F.get('neg_count', np.array(0)).item() != len(negs):
    t = time.time()
    F['neg_tts'] = embed([place_anywhere(augment(trim(x))) for x in negs for _ in range(3)])
    F['neg_end'] = embed([place_end(augment(trim(x))) for x in negs for _ in range(3)])
    F['neg_count'] = np.array(len(negs))
    np.savez(cache, **F)
    print('negative features', F['neg_tts'].shape, round(time.time() - t), 's')

ACAV = np.memmap('data/acav_part.npy', dtype=np.float16, mode='r', offset=128, shape=(1302083, 16, 96))
def acav_rows(n):
    """Random everyday-audio windows from the partly downloaded ACAV file (memory-mapped, header says more rows)"""
    idx = np.sort(np.random.choice(ACAV.shape[0], n, replace=False))
    return np.asarray(ACAV[idx])  # kept as float16: batches are converted as they're drawn

val = np.load('data/validation_set_features.npy', mmap_mode='r').astype(np.float32)
val_windows = np.lib.stride_tricks.sliding_window_view(val, (16, 96))[:, 0]  # every 80 ms step
# 10.7 h of real speech, TV and music: the first half teaches it what isn't its name (mining), the second half is
# never trained on and is where false wakes are counted
half = len(val_windows) // 2
val_mine, val_test = val_windows[:half], val_windows[half + 16:]
VAL_HOURS = len(val_test) * 0.08 / 3600

class Net(nn.Module):
    def __init__(self):
        super().__init__()
        self.f = nn.Sequential(nn.Flatten(), nn.Linear(16 * 96, 128), nn.LayerNorm(128), nn.ReLU(), nn.Linear(128, 128), nn.LayerNorm(128), nn.ReLU(), nn.Linear(128, 1))
    def forward(self, x): return self.f(x)

class Exported(nn.Module):
    def __init__(self, net): super().__init__(); self.net = net
    def forward(self, x): return torch.sigmoid(self.net(x))

def score_all(model, X, batch=20000):
    with torch.no_grad():
        return torch.cat([torch.sigmoid(model(torch.from_numpy(np.ascontiguousarray(X[i:i + batch], dtype=np.float32)))).squeeze(1) for i in range(0, len(X), batch)]).numpy()

def false_wakes(scores, threshold):
    """Detections per hour on the held-out 5.3 h of real audio, with a 1.5 s pause after each (like the app)"""
    hits, last = 0, -10**9
    for i in np.nonzero(scores >= threshold)[0]:
        if i - last > 19: hits += 1; last = i
    return hits / VAL_HOURS

def train(model, pos, X_neg, w_neg, steps, max_lr):
    opt = torch.optim.AdamW(model.parameters(), lr=max_lr / 2, weight_decay=1e-3)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=max_lr, total_steps=steps)
    lossf = nn.BCEWithLogitsLoss(reduction='none')
    neg_idx = np.random.choice(len(X_neg), (steps, 384), p=w_neg / w_neg.sum())
    model.train()
    for step in range(steps):
        pi = np.random.randint(0, len(pos), 128); ni = neg_idx[step]
        x = torch.from_numpy(np.concatenate([pos[pi], X_neg[ni].astype(np.float32)])); y = torch.cat([torch.ones(128), torch.zeros(384)])
        # Missing a real "Hi Rei" is bad; waking by itself is worse: negatives weigh more as training goes on
        w = torch.cat([torch.ones(128), torch.full((384,), 1.0 + 2 * step / steps)])
        loss = (lossf(model(x).squeeze(1), y) * w).mean()
        opt.zero_grad(); loss.backward(); opt.step(); sched.step()
    model.eval()

results = {}
os.makedirs('out', exist_ok=True)
for pal in PALS:
    t = time.time()
    others = [p for p in ['rei', 'diel', 'jhyvie', 'jaypee'] if p != pal]
    pos = F[f'{pal}_train']
    hard = np.concatenate([F['neg_tts'], F['neg_end'], F['noise'], F[f'{pal}_late']] + [F[f'{o}_train'] for o in others])
    everyday = acav_rows(400_000)
    X_neg = np.concatenate([hard.astype(np.float16), everyday]); w_neg = np.concatenate([np.full(len(hard), 4.0), np.ones(len(everyday))])
    model = Net()
    train(model, pos, X_neg, w_neg, 6000, 2e-3)
    # Hard-negative mining: the everyday sounds (from all 1.3M windows) this model still mistakes for its name, then
    # a second round that sees them often
    mined, mined_val = np.zeros(0, dtype=np.int64), np.zeros(0, dtype=np.int64)
    for rnd in range(3):
        s_acav = score_all(model, ACAV, batch=50000)
        s_mine = score_all(model, val_mine)
        top = np.argsort(s_acav)[-40000:]
        mined = np.union1d(mined, top[s_acav[top] > 0.05])
        # Each near-miss in the real audio, with its neighbours (the same sound a moment before and after)
        hits = np.nonzero(s_mine > 0.05)[0]
        mined_val = np.union1d(mined_val, np.clip((hits[:, None] + np.arange(-4, 5)).ravel(), 0, len(val_mine) - 1))
        print(f'  round {rnd + 1}: over 0.5: {int((s_acav > 0.5).sum())} everyday, {int((s_mine > 0.5).sum())} real; mining {len(mined)} + {len(mined_val)}'); sys.stdout.flush()
        X_neg = np.concatenate([hard.astype(np.float16), everyday, np.asarray(ACAV[np.sort(mined)]), val_mine[mined_val].astype(np.float16)])
        w_neg = np.concatenate([np.full(len(hard), 4.0), np.ones(len(everyday)), np.full(len(mined), 3.0), np.full(len(mined_val), 3.0)])
        train(model, pos, X_neg, w_neg, 4000, 1e-3)
    with torch.no_grad():
        test = torch.sigmoid(model(torch.from_numpy(F[f'{pal}_test']))).squeeze(1).numpy()
        cross = {o: torch.sigmoid(model(torch.from_numpy(F[f'{o}_test']))).squeeze(1).numpy() for o in others}
    # The lowest threshold with at most 0.5 false wakes an hour (most forgiving for a real voice)
    s_val = score_all(model, val_test)
    best = None
    for th in [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.97, 0.98, 0.99, 0.995]:
        fph = false_wakes(s_val, th)
        if fph <= 0.5: best = (th, fph); break
    th, fph = best or (0.995, false_wakes(s_val, 0.995))
    recall = float((test >= th).mean())
    cross_rate = {o: round(float((s >= th).mean()), 3) for o, s in cross.items()}
    results[pal] = {'threshold': th, 'recall_heldout_voices': round(recall, 3), 'false_wakes_per_hour': round(fph, 2), 'other_pals_waking_it': cross_rate}
    print(pal, results[pal], round(time.time() - t), 's'); sys.stdout.flush()
    torch.onnx.export(Exported(model), torch.zeros(1, 16, 96), f'out/{pal}.onnx', input_names=['input'], output_names=['score'], dynamic_axes={'input': {0: 'batch'}}, opset_version=13, dynamo=False)
json.dump(results, open('out/results.json', 'w'), indent=2)
# What the app reads (public/wakeword/models.json): the threshold for each pal
json.dump({p: {'threshold': r['threshold']} for p, r in results.items()}, open('out/models.json', 'w'), indent=2)
print(json.dumps(results, indent=2))
