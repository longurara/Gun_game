"""Build compact local GLBs; original downloads stay in ignored output/assets/enemies/raw."""
import copy
import hashlib
import json
from pathlib import Path
import struct
import zipfile

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'output/assets/enemies/raw'
DEST = ROOT / 'public/assets/enemies'
DEST.mkdir(parents=True, exist_ok=True)

def read_glb(path):
    data = path.read_bytes()
    if data[:4] != b'glTF':
        raise ValueError('Invalid GLB')
    size = struct.unpack_from('<I', data, 12)[0]
    doc = json.loads(data[20:20+size])
    bin_size = struct.unpack_from('<I', data, 20+size)[0]
    return doc, bytearray(data[28+size:28+size+bin_size])

def write_glb(path, doc, binary):
    doc['buffers'] = [dict(byteLength=len(binary))]
    encoded = json.dumps(doc, separators=(',', ':')).encode()
    encoded += b' ' * (-len(encoded) % 4)
    binary += b'\0' * (-len(binary) % 4)
    path.write_bytes(struct.pack('<4sII', b'glTF', 2, 28+len(encoded)+len(binary)) + struct.pack('<I4s', len(encoded), b'JSON') + encoded + struct.pack('<I4s', len(binary), b'BIN\0') + binary)

def compact(doc, binary):
    """Retain only geometry and animation accessors still referenced after pruning."""
    used_meshes = sorted({n['mesh'] for n in doc['nodes'] if 'mesh' in n})
    mesh_map = {old: new for new, old in enumerate(used_meshes)}
    doc['meshes'] = [doc['meshes'][i] for i in used_meshes]
    for node in doc['nodes']:
        if 'mesh' in node: node['mesh'] = mesh_map[node['mesh']]
    references = []
    for mesh in doc['meshes']:
        for primitive in mesh['primitives']:
            references.extend((primitive['attributes'], key) for key in primitive['attributes'])
            if 'indices' in primitive: references.append((primitive, 'indices'))
            for target in primitive.get('targets', []): references.extend((target, key) for key in target)
    for skin in doc.get('skins', []):
        if 'inverseBindMatrices' in skin: references.append((skin, 'inverseBindMatrices'))
    for animation in doc.get('animations', []):
        for sampler in animation['samplers']: references.extend([(sampler, 'input'), (sampler, 'output')])
    used_accessors = sorted({obj[key] for obj, key in references})
    accessor_map = {old: new for new, old in enumerate(used_accessors)}
    accessors = [doc['accessors'][i] for i in used_accessors]
    for obj, key in references: obj[key] = accessor_map[obj[key]]
    if any('sparse' in accessor for accessor in accessors): raise ValueError('Sparse accessor needs support')
    views = sorted({a['bufferView'] for a in accessors if 'bufferView' in a} | {image['bufferView'] for image in doc.get('images', []) if 'bufferView' in image})
    view_map, result, output = {}, [], bytearray()
    for old in views:
        view = copy.deepcopy(doc['bufferViews'][old])
        offset = view.get('byteOffset', 0)
        output += b'\0' * (-len(output) % 4)
        view_map[old] = len(result)
        view['byteOffset'] = len(output)
        output += binary[offset:offset+view['byteLength']]
        result.append(view)
    for accessor in accessors:
        if 'bufferView' in accessor: accessor['bufferView'] = view_map[accessor['bufferView']]
    for image in doc.get('images', []):
        if 'bufferView' in image: image['bufferView'] = view_map[image['bufferView']]
    doc['accessors'], doc['bufferViews'] = accessors, result
    return output

weapons = {'Revolver', 'Sniper', 'Revolver_Small', 'Pistol', 'SMG', 'GrenadeLauncher', 'ShortCannon', 'Shotgun', 'Sniper_2', 'RocketLauncher', 'AK', 'Shovel', 'Knife_1', 'Knife_2'}
clips = {'Idle_Gun_Pointing', 'Idle_Shoot', 'Run_Shoot', 'Run_Gun', 'Interact', 'Idle', 'Run'}
manifest = []
for key in ['punk', 'hoodie', 'toon-soldier', 'toon-hazmat', 'toon-enemy', 'woman-soldier', 'woman-punk']:
    source = RAW / f'{key}.glb'
    doc, binary = read_glb(source)
    removed = []
    if key.startswith('toon-'):
        for node in doc['nodes']:
            if node.get('name') in weapons and 'mesh' in node:
                removed.append(node['name'])
                del node['mesh']
    # Toon Enemy includes duplicate clips. Keep one authored clip for each action.
    chosen = {}
    for animation in doc.get('animations', []):
        name = animation['name'].split('|')[-1]
        if name in clips: chosen[name] = animation
    doc['animations'] = list(chosen.values())
    binary = compact(doc, binary)
    target = DEST / f'{key}.glb'
    write_glb(target, doc, binary)
    metadata = json.loads((ROOT / f'output/assets/enemies/{key}-data.json').read_text())
    # Poly Pizza's converted Soldier entry uses CC BY 3.0; retain its actual listing terms.
    model = metadata.get('model', metadata)
    manifest.append(dict(file=target.name, sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(), sha256=hashlib.sha256(target.read_bytes()).hexdigest(), bytes=target.stat().st_size, clips=list(chosen), removedEmbeddedWeapons=removed, processing='Retained gameplay animation clips; pruned unreferenced geometry/accessors; removed embedded Toon weapons'))

# Kenney supplies one FBX mesh + separate FBX clips. Match targets by unique node name.
doc, binary = read_glb(RAW / 'kenney-character.glb')
node_by_name = {node['name']: i for i, node in enumerate(doc['nodes'])}
# FBX2glTF chooses LeftFootCtrl as the skin root even though the other joints
# are its siblings. Use their common ancestor so the FBX unit/axis transform
# belongs to the skeleton, rather than being applied again to the mesh.
for skin in doc['skins']:
    skin['skeleton'] = node_by_name['Root']
doc['animations'] = []
for action in ['idle', 'run', 'jump']:
    clip_doc, clip_binary = read_glb(RAW / f'kenney-{action}.glb')
    binary += b'\0' * (-len(binary) % 4)
    base = len(binary)
    view_base, accessor_base = len(doc['bufferViews']), len(doc['accessors'])
    binary += clip_binary
    for view in clip_doc['bufferViews']:
        view['byteOffset'] = base + view.get('byteOffset', 0)
        doc['bufferViews'].append(view)
    for accessor in clip_doc['accessors']:
        accessor['bufferView'] += view_base
        doc['accessors'].append(accessor)
    animation = next(a for a in clip_doc['animations'] if a['name'].split('|')[-1].lower() == action)
    for sampler in animation['samplers']:
        sampler['input'] += accessor_base
        sampler['output'] += accessor_base
    for channel in animation['channels']:
        channel['target']['node'] = node_by_name[clip_doc['nodes'][channel['target']['node']]['name']]
    doc['animations'].append(animation)
# Surface colour is supplied by the four original Kenney textures at runtime.
for material in doc.get('materials', []):
    material['pbrMetallicRoughness'] = dict(baseColorFactor=[1,1,1,1], metallicFactor=0, roughnessFactor=1)
write_glb(DEST / 'kenney-character.glb', doc, compact(doc, binary))
with zipfile.ZipFile(ROOT / 'output/assets/enemies/kenney.zip') as archive:
    for name in ['survivorFemaleA', 'survivorMaleB', 'zombieA', 'zombieC']:
        (DEST / f'{name}.png').write_bytes(archive.read(f'Skins/{name}.png'))
    (DEST / 'Kenney-License.txt').write_bytes(archive.read('License.txt'))
target = DEST / 'kenney-character.glb'
manifest.append(dict(file=target.name, sourceSha256=hashlib.sha256((ROOT / 'output/assets/enemies/kenney.zip').read_bytes()).hexdigest(), sha256=hashlib.sha256(target.read_bytes()).hexdigest(), bytes=target.stat().st_size, clips=['Idle','Run','Jump'], processing='FBX2glTF 0.9.7; corrected common skeleton root; merged separate animation channels by bone name; white base for four original texture variants'))
for entry in manifest: print(entry['file'], entry['bytes'])
(DEST / 'processing.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
