# Synthetic training clips for the "Hi {pal}" wake words: many voices saying each wake phrase (positives), and
# look-alikes plus everyday speech that must not wake it (negatives). 16 kHz mono 16-bit WAV.
#   cd .cache/wakeword && venv/bin/python ../../scripts/wakeword/gen.py   (docs/wake-word.md)
import json, os, random, subprocess, sys, tempfile, wave
import numpy as np
from scipy.signal import resample_poly
from piper import PiperVoice
from piper.config import SynthesisConfig

random.seed(7)
OUT = 'data/clips'
GREET = ['Hi', 'Hey', 'Hello', 'Ooy', 'Oy']
# How each name is said (the user's pronunciations), spelled so the TTS says it that way
NAMES = {
    'rei': ['Ray', 'Rei', 'Rey'],
    'diel': ['Dyel', 'Dee yell', 'Jell', 'Dee-el'],
    'jhyvie': ['Jeevee', 'Jee vee', 'Jeevie'],
    'jaypee': ['Jay Pee', 'J.P.', 'Jaypee'],
}
# Sound-alikes and everyday lines: these must never wake it
HARD = ['hi there', 'hire', 'higher', 'hey ray-ban', 'array', 'hey Reese', 'hey Rachel', 'hi Rhea', 'a ray of light', 'hey wait',
        'okay deal', 'a great deal', 'it is a big deal', 'dial it', 'hey Dale', 'hey jelly', 'jelly beans', 'hey yell', 'feel it', 'hey Neil',
        'hey jeep', 'TV', 'hey Jeevan', 'hey Steve', 'easy', 'hey JB', 'hey Jay', 'JP Morgan', 'hey baby', 'happy',
        'hi', 'hey', 'hello', 'oy', 'hello there', 'hey you', 'Ray', 'Dyel', 'Jeevee', 'Jay Pee', 'hey guys', 'hi mom', 'hey buddy',
        'hey Siri', 'okay Google', 'hey Alexa', 'hey Rey Mysterio', 'hey Brie', 'hi Gee', 'hey Gabby', 'hey Ramon', 'hey JD']
EVERYDAY = [
    'what are my plans today', 'I have an exam tomorrow at three', 'can you add gym at five', 'what is my next schedule', 'move my dinner to seven',
    'how much time before my submission', 'set a timer for twenty five minutes', 'remind me to drink water', 'I am so tired today', 'what time is it',
    'may exam ako bukas', 'anong sched ko bukas', 'pakisabihan mo ako mamaya', 'ang dami kong gagawin', 'tara na', 'sige push mo na', 'kain muna tayo',
    'I will be late for class', 'the bus is coming', 'let us study after dinner', 'my shift ends at ten', 'do I have class on Thursday', 'okay thank you',
    'that sounds good', 'no not that one', 'can you repeat that', 'I need a break', 'good morning everyone', 'see you tomorrow', 'where is my phone',
    'the weather is nice today', 'my professor moved the quiz', 'I forgot my notes', 'let me check my calendar', 'what did you say', 'hold on a second',
    'I am going to the library', 'the meeting is at noon', 'please turn on the lights', 'I want to watch a movie', 'how was your day', 'what should we eat',
    'the paper is due on Friday', 'I have a lab report', 'my mom is calling', 'wait lang', 'ano ba yan', 'grabe ang init', 'okay lang ako', 'bukas na lang',
    'hello can you hear me', 'hey what is up', 'hi how are you', 'hi everyone welcome back', 'hey come here', 'hello good afternoon', 'hi I am Pol',
] + [f'{g} {n}' for g in ['hi', 'hey', 'hello'] for n in ['Ana', 'Mark', 'Joy', 'Paolo', 'Kim', 'Sam', 'Lara', 'Ben', 'Mia', 'Carl']]

# "Hi {someone else}": greetings to other people must not wake it (the hardest case: same rhythm as the wake phrase).
# Nothing that is a pal's own sound ("Rey", "Ray-Ann") or it would learn to ignore the real name
OTHER_NAMES = ['Gabby', 'Dave', 'Jay', 'Dale', 'Neil', 'Steve', 'Jeff', 'Joey', 'Jenny', 'Jerry', 'Jean', 'Gene', 'Gigi', 'Vivian',
               'Rhea', 'Rose', 'Ryan', 'Raffy', 'Ren', 'Rick', 'Daniel', 'Della', 'Delia', 'Dean', 'Deo', 'Dennis', 'Jill',
               'Jade', 'Jake', 'Jana', 'Janine', 'JB', 'JM', 'JC', 'PJ', 'CJ', 'KC', 'Jopet', 'Jepoy', 'Jessie', 'Bea', 'Andrei',
               'Ava', 'Ivy', 'Evie', 'Stevie', 'Jovie', 'Jhoy', 'Joy', 'Paolo', 'Migo', 'Enzo', 'Nico', 'Kiko', 'Toni', 'Liza', 'Lea',
               'Mae', 'Kaye', 'Faye', 'Gail', 'Kate', 'Grace', 'Dianne', 'Joyce', 'Jasper', 'Carlo', 'Marco', 'Lance', 'Vince',
               'Bianca', 'Kyle', 'Nathan', 'Ella', 'Sophia', 'Chloe', 'Kevin', 'Brian', 'Jason', 'Ramon', 'Leah', 'Dee']
OTHER_GREET = ['hi', 'hey', 'hello', 'uy', 'oy', 'good morning', 'thanks']

def write(path, audio16k):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    pcm = np.clip(audio16k, -1, 1)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
        w.writeframes((pcm * 32767).astype(np.int16).tobytes())

def piper_say(voice, text, speaker, speed):
    with tempfile.NamedTemporaryFile(suffix='.wav') as f:
        with wave.open(f.name, 'wb') as w:
            voice.synthesize_wav(text, w, syn_config=SynthesisConfig(speaker_id=speaker, length_scale=speed, noise_scale=random.uniform(0.5, 0.9), noise_w_scale=random.uniform(0.6, 1.0)))
        with wave.open(f.name) as r:
            sr = r.getframerate(); x = np.frombuffer(r.readframes(r.getnframes()), dtype=np.int16).astype(np.float32) / 32767
    return resample_poly(x, 160, sr // 100) if sr != 16000 else x

def mac_voices():
    out = subprocess.run(['say', '-v', '?'], capture_output=True, text=True).stdout.splitlines()
    novelty = {'Albert', 'Bad News', 'Bahh', 'Bells', 'Boing', 'Bubbles', 'Cellos', 'Good News', 'Jester', 'Organ', 'Superstar', 'Trinoids', 'Whisper', 'Wobble', 'Zarvox'}
    import re
    vs = []
    for line in out:
        m = re.match(r'^(.*?)\s+([a-z]{2,3}_[A-Z]{2})\s+#', line)
        if m and m.group(2).startswith('en_') and m.group(1).split(' (')[0] not in novelty: vs.append(m.group(1).strip())
    return sorted(set(vs))

def mac_say(voice, text, rate):
    with tempfile.NamedTemporaryFile(suffix='.wav') as f:
        subprocess.run(['say', '-v', voice, '-r', str(rate), '-o', f.name, '--data-format=LEI16@16000', text], check=True, capture_output=True)
        with wave.open(f.name) as r: return np.frombuffer(r.readframes(r.getnframes()), dtype=np.int16).astype(np.float32) / 32767

def phrase(pal):
    g = random.choice(GREET); n = random.choice(NAMES[pal])
    return random.choice([f'{g} {n}', f'{g}, {n}!', f'{g} {n}.', f'{g} {n}?', f'{g}, {n}'])

def main(per_pal=900, neg=1600):
    voices = {n: PiperVoice.load(f'voices/{n}.onnx') for n in ['en_US-libritts_r-medium', 'en_GB-vctk-medium']}
    speakers = {'en_US-libritts_r-medium': 904, 'en_GB-vctk-medium': 109}
    macs = mac_voices()
    print('mac voices:', len(macs), macs[:8], '…')
    meta = []
    # Hold some speakers out entirely, to measure how it does on voices it never heard
    held = {n: set(random.sample(range(k), max(5, k // 10))) for n, k in speakers.items()}
    held_mac = set(random.sample(macs, max(3, len(macs) // 6)))
    for pal in NAMES:
        for i in range(per_pal):
            src = random.random()
            if src < 0.62: vn, spk = 'en_US-libritts_r-medium', random.randrange(904)
            elif src < 0.85: vn, spk = 'en_GB-vctk-medium', random.randrange(109)
            else: vn, spk = 'mac', random.choice(macs)
            text = phrase(pal)
            x = piper_say(voices[vn], text, spk, random.uniform(0.8, 1.3)) if vn != 'mac' else mac_say(spk, text, random.randint(150, 240))
            split = 'test' if (spk in held[vn] if vn != 'mac' else spk in held_mac) else 'train'
            path = f'{OUT}/{pal}/{split}/{i:05d}.wav'
            write(path, x); meta.append({'path': path, 'pal': pal, 'split': split, 'text': text, 'voice': f'{vn}:{spk}'})
        print(pal, 'done'); sys.stdout.flush()
    lines = HARD * 6 + EVERYDAY * 3
    for i in range(neg):
        text = random.choice(lines)
        src = random.random()
        if src < 0.6: vn, spk = 'en_US-libritts_r-medium', random.randrange(904)
        elif src < 0.85: vn, spk = 'en_GB-vctk-medium', random.randrange(109)
        else: vn, spk = 'mac', random.choice(macs)
        x = piper_say(voices[vn], text, spk, random.uniform(0.8, 1.3)) if vn != 'mac' else mac_say(spk, text, random.randint(150, 240))
        path = f'{OUT}/neg/{i:05d}.wav'
        write(path, x); meta.append({'path': path, 'pal': None, 'split': 'neg', 'text': text, 'voice': f'{vn}:{spk}'})
    json.dump(meta, open('data/clips.json', 'w'))
    print('clips:', len(meta))

def others(n=800):
    """Extra negatives: greetings to other people (venv/bin/python gen.py others), added to clips.json"""
    voices = {k: PiperVoice.load(f'voices/{k}.onnx') for k in ['en_US-libritts_r-medium', 'en_GB-vctk-medium']}
    macs = mac_voices()
    meta = [m for m in json.load(open('data/clips.json')) if not m['path'].startswith(f'{OUT}/neg_names/')]
    for i in range(n):
        name = random.choice(OTHER_NAMES)
        text = f'{random.choice(OTHER_GREET)} {name}' + random.choice(['', '!', '?', ', come here', ', how are you'])
        src = random.random()
        if src < 0.6: vn, spk = 'en_US-libritts_r-medium', random.randrange(904)
        elif src < 0.85: vn, spk = 'en_GB-vctk-medium', random.randrange(109)
        else: vn, spk = 'mac', random.choice(macs)
        x = piper_say(voices[vn], text, spk, random.uniform(0.8, 1.3)) if vn != 'mac' else mac_say(spk, text, random.randint(150, 240))
        path = f'{OUT}/neg_names/{i:05d}.wav'
        write(path, x); meta.append({'path': path, 'pal': None, 'split': 'neg', 'text': text, 'voice': f'{vn}:{spk}'})
    json.dump(meta, open('data/clips.json', 'w'))
    print('clips:', len(meta))

if __name__ == '__main__':
    others() if sys.argv[1:] == ['others'] else main()
