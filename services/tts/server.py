"""Small, stateless Edge speech service. Run behind an HTTPS reverse proxy."""
import asyncio
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import threading
import time

PROFILE = {
    'rei': {'voice':'en-US-GuyNeural','rate':'+0%','pitch':'+0Hz'},
    'diel': {'voice':'en-US-ChristopherNeural','rate':'+0%','pitch':'+0Hz'},
    'jhyvie': {'voice':'fil-PH-AngeloNeural','rate':'+0%','pitch':'+0Hz'},
    'jaypee': {'voice':'en-US-RogerNeural','rate':'+0%','pitch':'+0Hz'},
}
ORIGINS = [x.strip() for x in os.getenv('TTS_ALLOWED_ORIGINS','http://localhost:8443,http://127.0.0.1:8443,http://localhost,https://localhost,capacitor://localhost').split(',') if x.strip()]
def allowed_origin(origin, allowed): return bool(origin) and origin in allowed

def validate_request(payload):
    if not isinstance(payload,dict) or set(payload) != {'pal','text'}: raise ValueError('Expected pal and text only')
    pal,text=payload['pal'],payload['text']
    if not isinstance(pal,str) or pal not in PROFILE: raise ValueError('Unknown pal')
    if not isinstance(text,str) or not text.strip() or len(text)>2000: raise ValueError('Text must contain 1–2000 characters')
    return pal,text.strip()

class Budget:
    def __init__(self,limit=30): self.limit=limit; self.clients={}; self.lock=threading.Lock()
    def accept(self,key,now=None):
        now=time.monotonic() if now is None else now
        with self.lock:
            if len(self.clients)>=4096:
                self.clients={k:v for k,v in self.clients.items() if v and v[-1]>now-60}
                if key not in self.clients and len(self.clients)>=4096: return False
            q=self.clients.setdefault(key,deque())
            while q and q[0]<=now-60: q.popleft()
            if len(q)>=self.limit: return False
            q.append(now); return True
BUDGET=Budget()
GATE=threading.BoundedSemaphore(8)
READY=False

async def verify_voices():
    import edge_tts
    voices=await asyncio.wait_for(edge_tts.list_voices(),10)
    available={v['ShortName']:v for v in voices}
    return all(available.get(p['voice'],{}).get('Gender')=='Male' for p in PROFILE.values())

async def synthesize(pal,text):
    import edge_tts
    result=bytearray()
    async for chunk in edge_tts.Communicate(text,**PROFILE[pal]).stream():
        if chunk['type']=='audio': result.extend(chunk['data'])
        if len(result)>8*1024*1024: raise ValueError('Audio too large')
    if not result: raise ValueError('No audio returned')
    return bytes(result)

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass  # Never log spoken content or request bodies.
    def send(self,status,body=b'',content_type='application/json'):
        self.send_response(status)
        if allowed_origin(self.headers.get('Origin'),ORIGINS):
            self.send_header('Access-Control-Allow-Origin',self.headers['Origin'])
            self.send_header('Vary','Origin')
        self.send_header('Content-Type',content_type)
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Cross-Origin-Resource-Policy','cross-origin')
        self.send_header('Content-Length',str(len(body)))
        self.end_headers()
        try: self.wfile.write(body)
        except (BrokenPipeError,ConnectionResetError): pass
    def do_GET(self):
        if self.path!='/health': return self.send(404)
        self.send(200 if READY else 503,json.dumps({'ready':READY}).encode())
    def do_OPTIONS(self):
        if self.path!='/tts' or not allowed_origin(self.headers.get('Origin'),ORIGINS): return self.send(403)
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin',self.headers['Origin'])
        self.send_header('Access-Control-Allow-Methods','POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers','Content-Type')
        self.send_header('Vary','Origin'); self.end_headers()
    def do_POST(self):
        if self.path!='/tts': return self.send(404)
        if not allowed_origin(self.headers.get('Origin'),ORIGINS): return self.send(403)
        if not BUDGET.accept(self.client_address[0]): return self.send(429)
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<=16000: return self.send(413)
            if self.headers.get('Content-Type','').split(';')[0]!='application/json': return self.send(415)
            self.connection.settimeout(5)
            pal,text=validate_request(json.loads(self.rfile.read(length)))
        except (ValueError,TimeoutError,OSError): return self.send(400)
        if not READY: return self.send(503)
        if not GATE.acquire(blocking=False): return self.send(429)
        try:
            audio=asyncio.run(asyncio.wait_for(synthesize(pal,text),10))
            self.send(200,audio,'audio/mpeg')
        except (TimeoutError,asyncio.TimeoutError): self.send(504)
        except Exception: self.send(502)
        finally: GATE.release()

if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(); parser.add_argument('--check-voices',action='store_true'); args=parser.parse_args()
    try: READY=asyncio.run(verify_voices())
    except Exception: READY=False
    if args.check_voices:
        print('All four male voices available' if READY else 'Voice discovery unavailable or a configured male voice is missing')
        raise SystemExit(0 if READY else 1)
    def refresh():
        global READY
        while True:
            time.sleep(300)
            try: READY=asyncio.run(verify_voices())
            except Exception: READY=False
    threading.Thread(target=refresh,daemon=True).start()
    print('Speech service listening; voice discovery '+('ready' if READY else 'unavailable, retrying in five minutes'))
    ThreadingHTTPServer((os.getenv('TTS_HOST','127.0.0.1'),int(os.getenv('PORT','8788'))),Handler).serve_forever()
