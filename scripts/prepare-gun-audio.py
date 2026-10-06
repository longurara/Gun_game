"""Trim isolated one-shots, fold to mono, normalize peaks, fade tails and encode Vorbis.

Needs Python + FFmpeg for acquisition, not for running or building the game.
Only the seven named WAV entries are extracted; archive paths are never executed.
"""
import array
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'output/assets/gun-audio'
DEST = ROOT / 'src/assets/audio/guns'
DEST.mkdir(parents=True, exist_ok=True)
RATE = 44100
ENTRIES = [
    (1, '.22LR', '22LR Single Isolated WAV.wav', 'suppressed'),
    (1, '5.56', '556 Single Isolated WAV.wav', 'rifle-556'),
    (1, '7.62x39', '762x39 Single Isolated WAV.wav', 'rifle-762'),
    (1, '7.62x54R', '762x54r Single Isolated WAV.wav', 'sniper'),
    (2, '9mm', '9mm Single Isolated.wav', 'pistol'),
    (2, '.308 (7.62x51)', '308 Single Isolated.wav', 'dmr'),
    (2, '20 Gauge', '20 Gauge Single Isolated.wav', 'shotgun'),
    (0, '', 'lmg_fire01.mp3', 'lmg'),
]
manifest = []
for pack, folder, name, key in ENTRIES:
    if pack:
        with zipfile.ZipFile(SOURCE / f'snake-{pack}.zip') as archive:
            suffix = f'Isolated/{folder}/WAV/{name}'
            matches = [entry for entry in archive.namelist() if entry.endswith(suffix)]
            if len(matches) != 1:
                raise ValueError(f'Expected one source: {suffix}')
            original = matches[0]
            raw = archive.read(original)
    else:
        original = name
        raw = (SOURCE / name).read_bytes()
    pcm = subprocess.run(['ffmpeg', '-v', 'error', '-i', 'pipe:0', '-f', 'f32le', '-ac', '1', '-ar', str(RATE), 'pipe:1'], input=raw, capture_output=True, check=True).stdout
    samples = array.array('f', pcm)
    if sys.byteorder != 'little':
        samples.byteswap()
    peak = max(abs(value) for value in samples)
    if not math.isfinite(peak) or peak < .001:
        raise ValueError(f'Silent/invalid source: {name}')
    active = [i for i, value in enumerate(samples) if abs(value) > peak * .008]
    start = max(0, active[0] - int(RATE * .005))
    end = min(len(samples), active[-1] + int(RATE * .035), start + int(RATE * 1.3))
    samples = samples[start:end]
    scale = .85 / max(abs(value) for value in samples)
    fade = int(RATE * .025)
    for i in range(len(samples)):
        samples[i] *= scale * min(1, (len(samples) - 1 - i) / fade)
    destination = DEST / f'{key}.ogg'
    if sys.byteorder != 'little':
        samples.byteswap()
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 'f32le', '-ar', str(RATE), '-ac', '1', '-i', 'pipe:0', '-c:a', 'libvorbis', '-q:a', '5', '-map_metadata', '-1', str(destination)], input=samples.tobytes(), check=True)
    page = ('https://f8studios.itch.io/snakes-authentic-gun-sounds' if pack == 1 else 'https://f8studios.itch.io/snakes-second-authentic-gun-sounds-pack') if pack else 'https://opengameart.org/content/light-machine-gun'
    data = destination.read_bytes()
    manifest.append(dict(file=f'{key}.ogg', author='SnakeF8 / F8 Studios' if pack else 'KuraiWolf', source=page, original=original,
                         license='Free commercial use; attribution optional (author permission)' if pack == 1 else 'CC0 / public domain (author clarification)' if pack == 2 else 'CC BY 4.0',
                         sourceSha256=hashlib.sha256(raw).hexdigest(), sha256=hashlib.sha256(data).hexdigest(), bytes=len(data), seconds=round(len(samples) / RATE, 4),
                         trimmedStartSeconds=round(start / RATE, 4), processing='Mono 44.1kHz; silence trimmed; peak normalized to 0.85; 25ms tail fade; Vorbis quality 5'))
    print(f'{key}: {len(samples) / RATE:.3f}s, {len(data)} bytes')
with zipfile.ZipFile(SOURCE / 'snake-2.zip') as archive:
    (DEST / 'SnakeF8-ReadMe.txt').write_bytes(archive.read("Snake's SECOND Authentic Gun Sounds/Please ReadMe.txt"))
(DEST / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
