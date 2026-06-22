#!/usr/bin/env python3
"""Smoke test: timeline parser character extraction (mirrors parser.js logic)."""
import re
import json

SAMPLE = """FADE IN:

INT. ABANDONED WAREHOUSE - NIGHT

Rain hammers the tin roof. Water drips through cracks in the ceiling.

JOHN MERCER (40s, weathered, ex-military) steps through a rusted door, pistol drawn.

JOHN
(whispering)
Sarah... you in here?

SARAH COLE (30s, sharp eyes, athletic) emerges from behind crates, hands raised.

SARAH
Took you long enough.

JOHN
Who did this?

SARAH
(bitter laugh)
Volkov's men. Three of them.

DMITRI VOLKOV (50s, silver hair, tailored suit) steps into light from a skylight.

VOLKOV
Mr. Mercer. I was hoping you'd come.

John pushes Sarah behind him, raising the pistol.

FADE OUT."""

CAP_FALSE_POS = {
    'INT','EXT','I/E','INT/EXT','FADE','CUT','DISSOLVE','ANGLE','POV','CLOSE','WIDE','INSERT',
    'DAY','NIGHT','MORNING','EVENING','CONTINUOUS','LATER','MOMENTS','CONT','VO','OS','OC',
    'THE','AND','BUT','WITH','FROM','INTO','OVER','UNDER','AFTER','BEFORE','SCENE','SHOT',
}

def clean_char_name(raw):
    if not raw:
        return ''
    s = re.sub(r'\s*\([^)]*\)\s*', '', raw)
    s = re.sub(r'\s*[-–—:]\s*$', '', s)
    return re.sub(r'\s+', ' ', s).strip().upper()

def register_char(chars, name, desc=''):
    cn = clean_char_name(name)
    if not cn or len(cn) < 2 or len(cn) > 40:
        return
    words = cn.split()
    if all(w in CAP_FALSE_POS for w in words):
        return
    if cn not in chars:
        chars[cn] = desc or ''
    elif desc and not chars[cn]:
        chars[cn] = desc

def is_sh(t):
    return bool(re.match(r'^(INT\.|EXT\.|INT/EXT\.|I/E\.)', t, re.I))

def is_char_cue_line(t):
    if not t or is_sh(t):
        return False
    if re.match(r'^(FADE|CUT|DISSOLVE|SMASH|MATCH|IRIS|WIPE|THE END)', t, re.I):
        return False
    if re.match(r'^\(.+\)$', t):
        return False
    cue = re.sub(r'\s*\([^)]*\)\s*$', '', t).strip()
    if not cue or len(cue) < 2 or len(cue) > 40:
        return False
    if cue != cue.upper():
        return False
    if re.search(r'[.!?,;:]$', cue):
        return False
    if not re.search(r'[A-Z]', cue):
        return False
    if all(w in CAP_FALSE_POS for w in cue.split()):
        return False
    return True

def extract_characters(text):
    chars = {}
    for line in text.split('\n'):
        t = line.strip()
        if not t:
            continue
        inline = re.match(r"^([A-Z][A-Z0-9 .'\-()]{1,35})\s*(?:\([^)]*\))?\s*:\s+", t)
        if inline:
            register_char(chars, inline.group(1))
            continue
        if is_char_cue_line(t):
            m = re.search(r'\(([^)]+)\)', t)
            desc = m.group(1).strip() if m else ''
            register_char(chars, t, desc)
            continue
        if not is_sh(t):
            intro = re.search(r"\b([A-Z][A-Z0-9 .'\-]{1,30})\s*\([^)]{3,}\)", t)
            if intro:
                register_char(chars, intro.group(1))
    for m in re.findall(r"\b[A-Z][A-Z0-9\-']{2,18}(?:\s+[A-Z][A-Z0-9\-']{2,18}){0,2}\b", text):
        s = m.strip()
        if is_location_caps(s):
            continue
        register_char(chars, s)
    return chars

LOC_WORDS = {
    'ABANDONED','WAREHOUSE','BUILDING','APARTMENT','HOUSE','OFFICE','FACTORY','ALLEY','STREET',
    'ROOM','HALLWAY','ROOF','CEILING','NIGHT','DAY','MORNING','EVENING','LOCATION'
}

def is_location_caps(name):
    words = name.upper().split()
    return bool(words) and all(w in LOC_WORDS or w in CAP_FALSE_POS for w in words)

def is_cc(t):
    t = (t or '').strip()
    if not t or len(t) < 2 or len(t) > 40 or is_sh(t):
        return False
    if re.match(r'^(FADE|CUT|DISSOLVE|SMASH|MATCH|IRIS|WIPE)', t):
        return False
    n = re.sub(r'\s*\(.*\)\s*$', '', t)
    return n == n.upper() and not re.search(r'[.!?,;:]$', n) and not (t.startswith('(') and t.endswith(')'))

def normalize_pdf(text):
    t = text.replace('\r\n', '\n').replace('\r', '\n')
    line_count = len([l for l in t.split('\n') if l.strip()])
    if line_count < 12 and len(t) > 200:
        t = re.sub(r'\s+(?=(?:INT\.|EXT\.|INT/EXT\.|I/E\.)\s)', '\n\n', t, flags=re.I)
        t = re.sub(r'\s+(?=(?:FADE IN|FADE OUT|CUT TO|DISSOLVE TO|SMASH CUT)\b)', '\n\n', t, flags=re.I)
        t = re.sub(r'([.!?])\s+([A-Z][A-Z0-9 .\'\-]{1,30})(\s*\([^)]{0,60}\))?\s+(?=[(\[]|[a-z])', r'\1\n\n\2\3\n', t)
        t = re.sub(r'\)\s+([A-Z][A-Z0-9 .\'\-]{1,30})(\s*\([^)]{0,40}\))?\s*(?=\(|$|[a-z])', r')\n\n\1\2\n', t)
    return t

def main():
    chars = extract_characters(SAMPLE)
    expected = {'JOHN MERCER', 'JOHN', 'SARAH COLE', 'SARAH', 'DMITRI VOLKOV', 'VOLKOV'}
    found = set(chars.keys())
    missing = expected - found
    bad_action = [k for k in found if k in ('RAIN HAMMERS THE TIN ROOF', 'RAIN', 'TIN', 'ROOF')]
    if bad_action:
        print('FAIL action lines misclassified as characters:', bad_action)
        return 1

    pdf_blob = SAMPLE.replace('\n', ' ')
    pdf_chars = extract_characters(normalize_pdf(pdf_blob))

    print('=== Character extraction smoke test ===')
    print('Found:', sorted(found))
    print('Descriptions:', {k: v for k, v in chars.items() if v})
    if missing:
        print('FAIL missing:', sorted(missing))
        return 1
    if len(pdf_chars) < 3:
        print('FAIL PDF-normalized extraction too sparse:', sorted(pdf_chars.keys()))
        return 1
    print('PDF-normalized found:', sorted(pdf_chars.keys()))
    print('PASS')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())