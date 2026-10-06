"""Select only runtime CC0 files and embed external GLB images; preserve source licenses."""
from pathlib import Path
import json, struct, hashlib, shutil

root = Path(__file__).resolve().parents[1]
dest = root / 'public/assets/coverage'
dest.mkdir(parents=True, exist_ok=True)
sources = json.loads((root / 'output/assets/coverage/sources.json').read_text())
buildings = json.loads((root / 'assets-source/free-buildings/manifest.json').read_text())
manifest = []

def select(pack, filename, name, source='coverage'):
    base = root / ('output/assets/coverage' if source == 'coverage' else 'assets-source/free-buildings') / pack
    matches = list(base.rglob(filename))
    if not matches: raise FileNotFoundError(f'{pack}/{filename}')
    p = next((candidate for candidate in matches if 'PNG (Transparent)' in candidate.parts), matches[0])
    data = p.read_bytes()
    if p.suffix == '.glb':
        length = struct.unpack_from('<I', data, 12)[0]
        doc = json.loads(data[20:20+length])
        offset = 20 + length
        blob = bytearray(data[offset+8:])
        for image in doc.get('images', []):
            if 'uri' not in image: continue
            uri = image.pop('uri')
            if uri.startswith('data:'):
                import base64
                content = base64.b64decode(uri.split(',')[1])
                mime = uri.split(';')[0][5:]
            else:
                content = (p.parent / uri).read_bytes()
                mime = 'image/png' if uri.lower().endswith('.png') else 'image/jpeg'
            blob.extend(b'\0' * (-len(blob) % 4))
            image['bufferView'] = len(doc.setdefault('bufferViews', []))
            image['mimeType'] = mime
            doc['bufferViews'].append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(content)})
            blob.extend(content)
        doc['buffers'][0]['byteLength'] = len(blob)
        blob.extend(b'\0' * (-len(blob) % 4))
        header = json.dumps(doc, separators=(',', ':')).encode()
        header += b' ' * (-len(header) % 4)
        data = struct.pack('<III', 0x46546C67, 2, 28+len(header)+len(blob)) + struct.pack('<II', len(header), 0x4E4F534A) + header + struct.pack('<II', len(blob), 0x004E4942) + blob
    (dest / name).write_bytes(data)
    origin = next(s for s in (sources if source == 'coverage' else buildings) if s['slug'] == pack)
    manifest.append({'file': name, 'pack': pack, 'sourceFile': str(p.relative_to(base)), 'author': 'Kenney', 'license': 'CC0-1.0', 'page': origin['page'], 'sourceUrl': origin['sourceUrl'], 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'processing': 'Embedded original images in GLB' if p.suffix == '.glb' else 'Original file'})
    license_file = next(base.rglob('License.txt'), None)
    if license_file: shutil.copyfile(license_file, dest / f'License-{pack}.txt')

for name in ['sedan', 'sedan-sports', 'truck', 'van', 'wheel-default', 'wheel-racing', 'box']:
    select('car-kit', name+'.glb', 'k-'+name+'.glb')
for name in ['scope-small', 'scope-large-a', 'silencer-small', 'grenade-a', 'grenade-b', 'crate-wide']:
    select('blaster-kit', name+'.glb', 'k-'+name+'.glb')
for pack, files in {
 'building-kit': ['wall', 'floor'],
 'furniture-kit': ['bedBunk', 'bedSingle', 'desk', 'chair', 'bookcaseOpen'],
 'city-kit-industrial': ['shipping-container-a', 'detail-tank-large', 'chimney-large'],
 'factory-kit': ['pipe-large-long', 'box-large'],
 'survival-kit': ['barrel', 'chest'],
}.items():
    for name in files: select(pack, name+'.glb', 'k-'+name+'.glb', 'buildings')
for name in ['tree_pineDefaultA', 'tree_oak', 'rock_largeA']:
    select('nature-kit', name+'.glb', 'k-'+name+'.glb')
for name, file in {'smoke':'smoke_04', 'flame':'flame_01', 'flash':'star_04', 'fire':'fire_01'}.items():
    select('particle-pack', file+'.png', name+'.png')
select('smoke-particles', 'whitePuff00.png', 'puff.png')
select('skyboxes', 'skybox-day.png', 'sky-day.png')
for name, pack, file in [
 ('step-a','rpg-audio','footstep00.ogg'), ('step-b','rpg-audio','footstep01.ogg'),
 ('step-metal','impact-sounds','impactMetal_light_000.ogg'), ('step-grass','impact-sounds','footstep_grass_000.ogg'),
 ('step-concrete','impact-sounds','footstep_concrete_000.ogg'),
 ('cloth','rpg-audio','cloth1.ogg'), ('heal','rpg-audio','clothBelt.ogg'),
 ('hatch','rpg-audio','doorClose_1.ogg'), ('throw','rpg-audio','drawKnife1.ogg'),
 ('melee','rpg-audio','chop.ogg'), ('impact','impact-sounds','impactMetal_heavy_000.ogg'),
 ('explosion','sci-fi-sounds','explosionCrunch_000.ogg'), ('fire-sfx','sci-fi-sounds','thrusterFire_000.ogg'),
 ('hum','sci-fi-sounds','spaceEngineLow_000.ogg'), ('hiss','sci-fi-sounds','forceField_000.ogg'),
]:
    select(pack, file, name+'.ogg')
(dest / 'kenney-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
print(f'Selected {len(manifest)} runtime files, {sum(x["bytes"] for x in manifest)} bytes')
