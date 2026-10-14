import unittest
from pathlib import Path
from server import validate_request, PROFILE, allowed_origin, Budget
class ServiceTests(unittest.TestCase):
    def test_distinct_natural_profiles(self):
        expected = {'rei':'en-US-GuyNeural', 'diel':'en-US-ChristopherNeural', 'jhyvie':'fil-PH-AngeloNeural', 'jaypee':'en-US-RogerNeural'}
        api = (Path(__file__).resolve().parents[2] / 'api/tts.ts').read_text()
        for pal, voice in expected.items():
            self.assertEqual(PROFILE[pal], {'voice':voice, 'rate':'+0%', 'pitch':'+0Hz'})
            self.assertIn(f"{pal}: {{ voice: '{voice}', rate: '+0%', pitch: '+0Hz' }}", api)
        self.assertEqual(len({p['voice'] for p in PROFILE.values()}), 4)
    def test_reject_bad_requests(self):
        for payload in ({}, {'pal':'unknown','text':'hi'}, {'pal':'rei','text':''}, {'pal':'rei','text':'x'*2001}, {'pal':'rei','text':3}):
            with self.assertRaises(ValueError): validate_request(payload)
    def test_no_client_voice_override(self):
        with self.assertRaises(ValueError): validate_request({'pal':'rei','text':'hello','voice':'anything'})
    def test_valid(self):
        self.assertEqual(validate_request({'pal':'rei','text':' hello '}), ('rei','hello'))
    def test_origins(self):
        self.assertTrue(allowed_origin('http://localhost:8443', ['http://localhost:8443']))
        self.assertFalse(allowed_origin('https://evil.test', ['http://localhost:8443']))
        self.assertFalse(allowed_origin(None, ['http://localhost:8443']))
    def test_rate_limit(self):
        b=Budget(2)
        self.assertTrue(b.accept('a',0)); self.assertTrue(b.accept('a',1)); self.assertFalse(b.accept('a',2)); self.assertTrue(b.accept('a',61))
if __name__ == '__main__': unittest.main()
