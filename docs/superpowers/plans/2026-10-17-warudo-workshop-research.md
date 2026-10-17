# Warudo Workshop Research Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer the six research questions about Warudo Steam Workshop content with data from about 30 items, then commit a findings document, parity changes, and roadmap issues.

**Architecture:** Small read-only Python tools in the git-ignored evidence folder select items, fetch metadata, download with steamcmd, parse the `.warudo` container, inspect the Unity bundles with UnityPy, and aggregate the results. One AssetRipper export of the Livehouse Stage gives a deep check. Only the findings document, the checklist, and the issues are committed.

**Tech Stack:** Python 3.12 (uv virtual environment), UnityPy, steamcmd (Homebrew, logged in), Steam Web API `GetPublishedFileDetails` (keyless), AssetRipper (macOS arm64 release), `gh`.

**Spec:** [docs/superpowers/specs/2026-10-17-warudo-workshop-research-design.md](../specs/2026-10-17-warudo-workshop-research-design.md)

## Global Constraints

- Evidence root: `ART=/Users/danirukun/ghq/github.com/oshi-connect/opensekai/artifacts/warudo-workshop`. `artifacts/` is git-ignored (`.gitignore` line 14). Never commit anything under it.
- Tools go in `$ART/tools/`. Downloads go in `$ART/dl/<id>/`. Tools never live in a download folder. Run every tool as `$ART/.venv/bin/python -I $ART/tools/<tool>.py …` with item paths as arguments.
- Never run, load, or decompile a downloaded DLL, `.bat`, `.ps1`, `.exe`, or `.cmd` file. Record only its SHA-256, its `file` type, and a strings scan.
- Never copy a download to the Windows VM.
- Disk budget: the Mac has about 16 GiB free. Skip an item with `file_size` above 1.2 GB. Stop downloads when `$ART/dl` plus the Steam workshop folder exceed 6 GB. After an item's report exists, delete its `.warudo` files above 200 MB and keep the report and the hashes.
- App ID 2079120. steamcmd stores downloads in `~/Library/Application Support/Steam/steamapps/workshop/content/2079120/<id>/`.
- Committed prose is ASD-STE100. Long items in the parity checklist follow the existing `UI audit 0.15.1:` detail-line style, here `Workshop study:`.
- Run Git from `/Users/danirukun/ghq/github.com/oshi-connect/opensekai` on branch `opensekai/warudo-workshop-research`. Verify `pwd` first. No `git -C`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- **A `.warudo` file with a corrupt or non-zip payload, or a `modinfo.dat` without a PNG.** Expect: the parser records an `error` field and the run continues. Task 1 pins this with a truncated-file check.
- **A bundle that UnityPy cannot read (new Unity version, encrypted, or LZMA error).** Expect: the report has `bundles[].error` and the other bundles still count. Task 4 pins this with a garbage-bytes check.
- **A Material whose shader is in an external file (Warudo built-in shaders).** Expect: the report records the external file name, not a crash and not "unknown". Task 4 handles PPtr `m_FileID != 0`.
- **An item with loose files and no `.warudo` (plugin DLL only, blueprint JSON only, or malware).** Expect: the report lists each loose file with its hash, type, and flagged strings. Task 4 pins this with the 3817817029 sample.
- **steamcmd returns success but writes no folder (removed, private, or failed item).** Expect: `fetch.py` records `download: "missing"` and goes to the next item. Task 3 checks the folder after each call.

---

### Task 1: Container parser and tool setup

**Files:**
- Create: `$ART/tools/umod.py`
- Create: `$ART/tools/check_umod.py`
- Create: `$ART/.venv/` (uv)

**Interfaces:**
- Produces: `parse_warudo(path: str) -> dict` with keys `path`, `size`, `magic`, `payload_len`, `reserved`, `entries` (list of `{name, compressed, size, head}`), `modinfo` (`{header_hex, counts, strings, png_bytes}`), `metas` (`{entry_name: [asset paths]}`), `error` (str or None). Also `read_entry(path: str, name: str) -> bytes`.

- [ ] **Step 1: Create the virtual environment and the folders**

```bash
ART=/Users/danirukun/ghq/github.com/oshi-connect/opensekai/artifacts/warudo-workshop
mkdir -p $ART/tools $ART/dl $ART/report $ART/spot
uv venv --python 3.12 $ART/.venv
uv pip install --python $ART/.venv/bin/python UnityPy
$ART/.venv/bin/python -I -c "import UnityPy; print(UnityPy.__version__)"
```

Expected: a version string. Record it in `$ART/notes.md`.

- [ ] **Step 2: Write the check first**

`$ART/tools/check_umod.py`:

```python
import os, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from umod import parse_warudo

W = os.path.expanduser('~/Library/Application Support/Steam/steamapps/workshop/content/2079120')
prop = parse_warudo(f'{W}/3770211057/Props/Headphone_pokeball.warudo')
assert prop['error'] is None, prop['error']
assert prop['magic'] == 'UMOD' and prop['reserved'] == 0
assert [e['name'] for e in prop['entries']] == ['modinfo.dat', 'sharedassets.bin', 'sharedassets.meta']
assert prop['modinfo']['strings'][:4] == ['2.9.0', '2021.3.18f1', '0.9.0', 'Headphone_pokeball']
assert prop['modinfo']['png_bytes'] > 0
assert prop['metas']['sharedassets.meta'][-1].endswith('/Prop.prefab')

env = parse_warudo(f'{W}/3783948202/Environments/livehouse 3.warudo')
assert 'sceneassets.bin' in [e['name'] for e in env['entries']]
assert env['metas']['sceneassets.meta'] == ['Assets/livehouse 2/Environment.unity']
assert env['modinfo']['png_bytes'] == 0

with tempfile.NamedTemporaryFile(suffix='.warudo', delete=False) as f:
    f.write(open(f'{W}/3770211057/Props/Headphone_pokeball.warudo', 'rb').read()[:5000])
bad = parse_warudo(f.name)
assert bad['error'], 'truncated file must set error'
print('ok')
```

- [ ] **Step 3: Run the check to see it fail**

Run: `$ART/.venv/bin/python -I $ART/tools/check_umod.py`
Expected: `ModuleNotFoundError: No module named 'umod'`.

- [ ] **Step 4: Write the parser**

`$ART/tools/umod.py`:

```python
import io, struct, zipfile

PNG = b'\x89PNG\r\n\x1a\n'

def _read_7bit(b, i):
    n = shift = 0
    while True:
        c = b[i]; i += 1
        n |= (c & 0x7f) << shift
        if c < 0x80:
            return n, i
        shift += 7

def parse_modinfo(b):
    out = {'header_hex': b[:12].hex(), 'counts': [], 'strings': [], 'png_bytes': 0}
    if b[:4] != b'UMOD':
        out['error'] = 'modinfo magic'
        return out
    out['counts'] = list(struct.unpack('<3I', b[12:24]))
    png = b.find(PNG)
    end = png - 4 if png > 0 else len(b)  # a u32 length precedes the PNG
    i = 24
    while i < end:
        try:
            n, j = _read_7bit(b, i)
        except IndexError:
            break
        if j + n > end:
            break
        s = b[j:j + n]
        try:
            out['strings'].append(s.decode('utf-8'))
        except UnicodeDecodeError:
            break
        i = j + n
        while i < end and b[i] == 0 and (i + 1 >= end or b[i + 1] == 0):
            i += 1  # skip zero padding and empty-list counts
    out['tail_hex'] = b[i:end][:64].hex()
    if png > 0:
        out['png_bytes'] = len(b) - png
    return out

def parse_meta(b):
    n, i = _read_7bit(b, 0)
    root = b[i:i + n].decode('utf-8'); i += n
    count = struct.unpack('<I', b[i:i + 4])[0]; i += 4
    paths = []
    for _ in range(count):
        n, i = _read_7bit(b, i)
        paths.append(b[i:i + n].decode('utf-8')); i += n
    return [root] if count == 0 else paths

def _zip(path):
    data = open(path, 'rb').read()
    return data, zipfile.ZipFile(io.BytesIO(data[12:]))

def read_entry(path, name):
    return _zip(path)[1].read(name)

def parse_warudo(path):
    r = {'path': path, 'entries': [], 'modinfo': None, 'metas': {}, 'error': None}
    try:
        data, z = _zip(path)
        r['size'] = len(data)
        r['magic'] = data[:4].decode('latin-1')
        r['payload_len'], r['reserved'] = struct.unpack('<II', data[4:12])
        for info in z.infolist():
            head = z.open(info).read(8)
            r['entries'].append({'name': info.filename, 'compressed': info.compress_size,
                                 'size': info.file_size, 'head': head.hex()})
        if 'modinfo.dat' in z.namelist():
            r['modinfo'] = parse_modinfo(z.read('modinfo.dat'))
        for n in z.namelist():
            if n.endswith('.meta'):
                r['metas'][n] = parse_meta(z.read(n))
    except Exception as e:
        r['error'] = f'{type(e).__name__}: {e}'
    return r
```

- [ ] **Step 5: Run the check and fix the string walk until it passes**

Run: `$ART/.venv/bin/python -I $ART/tools/check_umod.py`
Expected: `ok`. If the `strings` assertion fails, print `parse_modinfo(...)['strings']` and the first 200 bytes of `modinfo.dat`. Fix the zero-skip rule in `parse_modinfo`. Do not loosen the assertion. The Livehouse `modinfo.dat` (85 bytes) ends with `0e DefaultCompany 00 00`, so an empty description string (`00`) occurs before the author. The walk must keep the empty string as `''`. In that case change the zero-skip to keep a single `00` as an empty string.

- [ ] **Step 6: Record the format**

Append to `$ART/notes.md` the byte layout found: the outer header, the `modinfo.dat` header (12 bytes plus three `u32` counts), the string order, and the meta layout. Name each field that the samples prove. Mark each other field as unknown.

---

### Task 2: Sample selection and metadata

**Files:**
- Create: `$ART/tools/sample.py`
- Create: `$ART/items.json`, `$ART/tags.json`

**Interfaces:**
- Produces: `$ART/items.json`, a list of `{id, title, type_tag, sort, file_size, subscriptions, lifetime_subscriptions, favorited, time_created, time_updated, tags, description, banned, visibility, creator}`. Later tasks read `id`, `type_tag`, and `file_size`.

- [ ] **Step 1: Write the tool**

`$ART/tools/sample.py`:

```python
import json, re, sys, time, urllib.parse, urllib.request
from collections import Counter

APP = 2079120
ART = sys.argv[1]
UA = {'User-Agent': 'Mozilla/5.0'}

def ids(tag=None, sort='totaluniquesubscribers', n=30):
    q = {'appid': APP, 'browsesort': sort, 'actualsort': sort,
         'section': 'readytouseitems', 'numperpage': n, 'p': 1}
    if tag:
        q['requiredtags[]'] = tag
    url = 'https://steamcommunity.com/workshop/browse/?' + urllib.parse.urlencode(q)
    html = urllib.request.urlopen(urllib.request.Request(url, headers=UA)).read().decode()
    seen = []
    for m in re.findall(r'filedetails/\?id=(\d+)', html):
        if m not in seen:
            seen.append(m)
    return seen

def details(id_list):
    out = []
    for k in range(0, len(id_list), 50):
        chunk = id_list[k:k + 50]
        form = {'itemcount': len(chunk)}
        form.update({f'publishedfileids[{i}]': x for i, x in enumerate(chunk)})
        req = urllib.request.Request(
            'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/',
            data=urllib.parse.urlencode(form).encode(), headers=UA)
        out += json.load(urllib.request.urlopen(req))['response']['publishedfiledetails']
        time.sleep(1)
    return out

census = details(ids(sort='totaluniquesubscribers') + ids(sort='mostrecent'))
tags = Counter(t['tag'] for d in census for t in d.get('tags', []))
json.dump(tags.most_common(), open(f'{ART}/tags.json', 'w'), indent=1)
print(tags.most_common())
```

- [ ] **Step 2: Run the tag census**

Run: `$ART/.venv/bin/python -I $ART/tools/sample.py $ART`
Expected: a tag list. It includes `Props`, `Environments`, and an attribution tag. Write the type tags (the tags that name a kind of content) into `$ART/notes.md`.

- [ ] **Step 3: Add stratified selection**

Append to `sample.py`. Set `TYPES` to the type tags from Step 2:

```python
TYPES = [t for t in sys.argv[2].split(',')]
picked, rows = [], []
for t in TYPES:
    for sort, k in (('totaluniquesubscribers', 3), ('mostrecent', 2)):
        for i in ids(tag=t, sort=sort)[:k + 3]:
            if i not in picked and sum(1 for p in rows if p[1] == t and p[2] == sort) < k:
                picked.append(i); rows.append((i, t, sort))
        time.sleep(1)
for known in ('3770211057', '3783948202', '3817817029'):
    if known not in picked:
        picked.append(known); rows.append((known, 'seed', 'seed'))
meta = {d['publishedfileid']: d for d in details(picked)}
items = []
for i, t, sort in rows:
    d = meta.get(i, {})
    items.append({'id': i, 'type_tag': t, 'sort': sort, 'title': d.get('title'),
                  'file_size': int(d.get('file_size') or 0),
                  'subscriptions': d.get('subscriptions'),
                  'lifetime_subscriptions': d.get('lifetime_subscriptions'),
                  'favorited': d.get('favorited'), 'time_created': d.get('time_created'),
                  'time_updated': d.get('time_updated'),
                  'tags': [x['tag'] for x in d.get('tags', [])],
                  'description': d.get('description'), 'banned': d.get('banned'),
                  'visibility': d.get('visibility'), 'creator': d.get('creator')})
json.dump(items, open(f'{ART}/items.json', 'w'), indent=1, ensure_ascii=False)
print(len(items), 'items')
```

- [ ] **Step 4: Run the selection**

Run: `$ART/.venv/bin/python -I $ART/tools/sample.py $ART 'Props,Environments,<other type tags>'`
Expected: about 30 items plus the three seeds. Check that each type has at least 3 items. If a type has fewer items on the Workshop, record that in `$ART/notes.md`.

---

### Task 3: Download within the disk budget

**Files:**
- Create: `$ART/tools/fetch.py`
- Create: `$ART/dl/<id>/`, `$ART/fetch.json`

**Interfaces:**
- Consumes: `$ART/items.json` (`id`, `file_size`).
- Produces: `$ART/fetch.json`, a list of `{id, download: "ok"|"missing"|"skipped-size"|"skipped-budget"|"seed", path}`. `path` is `$ART/dl/<id>`.

- [ ] **Step 1: Write the tool**

`$ART/tools/fetch.py`:

```python
import json, os, re, shutil, subprocess, sys

ART = sys.argv[1]
APP = '2079120'
STEAM = os.path.expanduser('~/Library/Application Support/Steam')
SRC = f'{STEAM}/steamapps/workshop/content/{APP}'
CAP, BUDGET = 1_200_000_000, 6_000_000_000
SEEDS = {'3770211057', '3783948202', '3817817029'}
user = re.search(r'"AccountName"\s+"([^"]+)"', open(f'{STEAM}/config/loginusers.vdf').read()).group(1)

def du(p):
    return sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(p) for f in fs) if os.path.exists(p) else 0

out = []
for it in json.load(open(f'{ART}/items.json')):
    i, dst = it['id'], f'{ART}/dl/{it["id"]}'
    if os.path.exists(dst):
        out.append({'id': i, 'download': 'ok', 'path': dst}); continue
    if i in SEEDS and os.path.exists(f'{SRC}/{i}'):
        shutil.copytree(f'{SRC}/{i}', dst, ignore=shutil.ignore_patterns('.DS_Store'))
        out.append({'id': i, 'download': 'seed', 'path': dst}); continue
    if it['file_size'] > CAP:
        out.append({'id': i, 'download': 'skipped-size'}); continue
    if du(f'{ART}/dl') + du(SRC) + it['file_size'] > BUDGET:
        out.append({'id': i, 'download': 'skipped-budget'}); continue
    subprocess.run(['steamcmd', '+login', user, '+workshop_download_item', APP, i, '+quit'],
                   stdout=subprocess.DEVNULL, timeout=1800)
    if os.path.isdir(f'{SRC}/{i}'):
        shutil.move(f'{SRC}/{i}', dst)
        out.append({'id': i, 'download': 'ok', 'path': dst})
    else:
        out.append({'id': i, 'download': 'missing'})
    json.dump(out, open(f'{ART}/fetch.json', 'w'), indent=1)
    print(out[-1], flush=True)
json.dump(out, open(f'{ART}/fetch.json', 'w'), indent=1)
```

The three seed folders stay in the Steam folder. The tool copies them, so the user's dump does not change.

- [ ] **Step 2: Check the login, then run the downloads**

Run: `steamcmd +login <AccountName from loginusers.vdf> +quit`
Expected: `Logged in OK` without a prompt. If steamcmd asks for a password or a Steam Guard code, stop and ask the user to run `! steamcmd +login <user> +quit` once.

Run: `$ART/.venv/bin/python -I $ART/tools/fetch.py $ART` (in the background; it can take a long time). The tool writes `fetch.json` after each item, so a rerun continues where it stopped.
Expected: one line for each item. `ok` for most.

- [ ] **Step 3: Check the result**

Run: `$ART/.venv/bin/python -I -c "import json,collections;print(collections.Counter(x['download'] for x in json.load(open('$ART/fetch.json'))))"` and `df -h ~ | tail -1`
Expected: at least 25 `ok` or `seed`. Free disk stays above 8 GiB. Record the counts and every `missing` ID in `$ART/notes.md`.

---

### Task 4: Structure analysis with UnityPy

**Files:**
- Create: `$ART/tools/analyze.py`
- Create: `$ART/tools/check_analyze.py`
- Create: `$ART/report/<id>.json`

**Interfaces:**
- Consumes: `parse_warudo`, `read_entry` from Task 1. `$ART/fetch.json`.
- Produces: `analyze_item(folder: str) -> dict` with keys `id`, `warudo` (list of `parse_warudo` results, each with `bundles`), `loose` (list of `{rel, size, sha256, file, flags}`). Each bundle: `{entry, unity, types: {name: count}, shaders: [names], external_shaders: [file names], textures: {format: count}, max_texture: int, scripts: [Namespace.Class @ Assembly], meshes: int, vertices: int, lightmaps: int, error}`.

- [ ] **Step 1: Write the check first**

`$ART/tools/check_analyze.py`:

```python
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from analyze import analyze_item, analyze_bundle

ART = sys.argv[1]
prop = analyze_item(f'{ART}/dl/3770211057')
b = prop['warudo'][0]['bundles'][0]
assert b['error'] is None, b['error']
assert b['types'].get('Mesh', 0) > 0 and b['types'].get('Material', 0) > 0
assert b['shaders'] or b['external_shaders']

env = analyze_item(f'{ART}/dl/3783948202')
names = [x['entry'] for x in env['warudo'][0]['bundles']]
assert names == ['sharedassets.bin', 'sceneassets.bin']

mal = analyze_item(f'{ART}/dl/3817817029')
bat = [x for x in mal['loose'] if x['rel'].endswith('.bat')]
dll = [x for x in mal['loose'] if x['rel'].endswith('.dll')]
assert bat and 'powershell' in bat[0]['flags'] and 'xor' in bat[0]['flags']
assert dll and 'OpenURL' in dll[0]['flags']

assert analyze_bundle('junk.bin', b'not a bundle' * 100)['error']
print('ok')
```

- [ ] **Step 2: Run the check to see it fail**

Run: `$ART/.venv/bin/python -I $ART/tools/check_analyze.py $ART`
Expected: `ModuleNotFoundError: No module named 'analyze'`.

- [ ] **Step 3: Write the analyzer**

`$ART/tools/analyze.py`:

```python
import hashlib, json, os, re, subprocess, sys
from collections import Counter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from umod import parse_warudo, read_entry
import UnityPy

FLAGS = {
    'powershell': rb'(?i)power"?\s*shell|WindowsPower',
    'xor': rb'(?i)-bxor|\bxor\b',
    'base64': rb'(?i)FromBase64|Base\'\+\'64',
    'OpenURL': rb'OpenURL',
    'Process.Start': rb'Process(StartInfo|\.Start)|System\.Diagnostics\.Process',
    'WebClient': rb'WebClient|HttpClient|UnityWebRequest|DownloadString',
    'Registry': rb'Microsoft\.Win32\.Registry|RegistryKey',
    'Reflection.Load': rb'Assembly\.Load|LoadFrom',
    'hidden-window': rb'(?i)-w(indowstyle)?\s+(1|hidden)|"B=-w"',
    'exec-policy-bypass': rb'(?i)-EP|Bypass|Byp',
}

def _name(obj):
    try:
        return obj.peek_name()
    except Exception:
        return None

def _ext_file(obj, pptr):
    fid = getattr(pptr, 'm_FileID', getattr(pptr, 'file_id', 0))
    if fid == 0:
        return None
    try:
        return obj.assets_file.externals[fid - 1].path
    except Exception:
        return f'external#{fid}'

def analyze_bundle(entry, data):
    r = {'entry': entry, 'unity': None, 'types': {}, 'shaders': [], 'external_shaders': [],
         'textures': {}, 'max_texture': 0, 'scripts': [], 'meshes': 0, 'vertices': 0,
         'lightmaps': 0, 'error': None}
    try:
        env = UnityPy.load(data)
        if not env.objects:
            raise ValueError('no objects')
        types, tex, shaders, ext, scripts = Counter(), Counter(), set(), set(), set()
        for obj in env.objects:
            t = obj.type.name
            types[t] += 1
            r['unity'] = r['unity'] or getattr(obj.assets_file, 'unity_version', None)
            try:
                if t == 'Shader':
                    shaders.add(_name(obj) or 'unnamed')
                elif t == 'Material':
                    m = obj.read()
                    e = _ext_file(obj, m.m_Shader)
                    if e:
                        ext.add(e)
                elif t == 'Texture2D':
                    d = obj.read()
                    fmt = getattr(d.m_TextureFormat, 'name', str(d.m_TextureFormat))
                    tex[fmt] += 1
                    r['max_texture'] = max(r['max_texture'], d.m_Width, d.m_Height)
                elif t == 'Mesh':
                    d = obj.read()
                    r['meshes'] += 1
                    r['vertices'] += getattr(d, 'm_VertexCount', 0) or 0
                elif t == 'MonoScript':
                    d = obj.read()
                    scripts.add(f'{d.m_Namespace}.{d.m_ClassName} @ {d.m_AssemblyName}')
                elif t == 'LightmapSettings':
                    d = obj.read()
                    r['lightmaps'] = len(getattr(d, 'm_Lightmaps', []) or [])
            except Exception as e:
                types[f'!read:{t}'] += 1
        r.update(types=dict(types), textures=dict(tex), shaders=sorted(shaders),
                 external_shaders=sorted(ext), scripts=sorted(scripts))
    except Exception as e:
        r['error'] = f'{type(e).__name__}: {e}'
    return r

def scan_loose(folder, rel):
    p = os.path.join(folder, rel)
    b = open(p, 'rb').read()
    ftype = subprocess.run(['file', '-b', p], capture_output=True, text=True).stdout.strip()
    return {'rel': rel, 'size': len(b), 'sha256': hashlib.sha256(b).hexdigest(), 'file': ftype,
            'flags': sorted(k for k, rx in FLAGS.items() if re.search(rx, b))}

def analyze_item(folder):
    out = {'id': os.path.basename(folder), 'warudo': [], 'loose': []}
    for root, _, files in os.walk(folder):
        for f in sorted(files):
            if f == '.DS_Store':
                continue
            rel = os.path.relpath(os.path.join(root, f), folder)
            if f.endswith('.warudo'):
                w = parse_warudo(os.path.join(folder, rel))
                w['rel'] = rel
                w['bundles'] = [analyze_bundle(e['name'], read_entry(w['path'], e['name']))
                                for e in w['entries'] if e['name'].endswith('.bin')]
                out['warudo'].append(w)
            else:
                out['loose'].append(scan_loose(folder, rel))
    return out

if __name__ == '__main__':
    art = sys.argv[1]
    for x in json.load(open(f'{art}/fetch.json')):
        dst = f'{art}/report/{x["id"]}.json'
        if x.get('path') and not os.path.exists(dst):
            json.dump(analyze_item(x['path']), open(dst, 'w'), indent=1, default=str)
            print('done', x['id'], flush=True)
```

- [ ] **Step 4: Run the check and fix it until it passes**

Run: `$ART/.venv/bin/python -I $ART/tools/check_analyze.py $ART`
Expected: `ok`. If a UnityPy attribute name differs in the installed version (for example `peek_name`, `m_TextureFormat`, or the PPtr file ID), check the attribute with `dir()` on one object and fix the analyzer. Do not remove the check.

- [ ] **Step 5: Run all items**

Run: `$ART/.venv/bin/python -I $ART/tools/analyze.py $ART` (in the background)
Expected: one `done` line and one report for each downloaded item. Then delete every `.warudo` file above 200 MB under `$ART/dl` and record the deletion in `$ART/notes.md`. The report keeps the facts.

- [ ] **Step 6: Check the reports for errors**

Run: `grep -l '"error": "' $ART/report/*.json`
Expected: few or none. For each hit, record the item and the error in `$ART/notes.md`. A common cause is a Unity version that UnityPy does not know. Do not hide the error in the summary.

---

### Task 5: Summary tables

**Files:**
- Create: `$ART/tools/summarize.py`
- Create: `$ART/summary.md`

**Interfaces:**
- Consumes: `$ART/items.json`, `$ART/fetch.json`, `$ART/report/*.json`.
- Produces: `$ART/summary.md` with the tables that Task 7 copies (aggregate values only).

- [ ] **Step 1: Write the tool**

`$ART/tools/summarize.py`:

```python
import glob, json, os, statistics, sys
from collections import Counter, defaultdict

ART = sys.argv[1]
items = {x['id']: x for x in json.load(open(f'{ART}/items.json'))}
fetch = {x['id']: x['download'] for x in json.load(open(f'{ART}/fetch.json'))}
reps = {os.path.basename(p)[:-5]: json.load(open(p)) for p in glob.glob(f'{ART}/report/*.json')}
L = ['# Warudo Workshop sample summary', '']

def row(*c):
    L.append('| ' + ' | '.join(str(x) for x in c) + ' |')

L += ['## Sample', '']
row('type', 'picked', 'analyzed', 'skipped or missing'); row(*['---'] * 4)
by_type = defaultdict(list)
for i, it in items.items():
    by_type[it['type_tag']].append(i)
for t, ids in sorted(by_type.items()):
    row(t, len(ids), sum(i in reps for i in ids), ', '.join(f'{i}:{fetch.get(i)}' for i in ids if i not in reps) or '-')

L += ['', '## Shape by type', '']
row('type', 'median MB', 'Unity versions', 'SDK versions', 'entries', 'median meshes', 'median vertices',
    'max texture', 'lightmaps>0', 'scripts>0', 'loose files>0'); row(*['---'] * 11)
for t, ids in sorted(by_type.items()):
    rs = [reps[i] for i in ids if i in reps]
    if not rs:
        continue
    ws = [w for r in rs for w in r['warudo']]
    bs = [b for w in ws for b in w.get('bundles', [])]
    sdk = Counter((w.get('modinfo') or {}).get('strings', [None, None, None])[2] for w in ws)
    uni = Counter(b['unity'] for b in bs)
    ent = Counter(','.join(e['name'] for e in w['entries']) for w in ws)
    per_item = lambda k: [sum(b[k] for w in r['warudo'] for b in w.get('bundles', [])) for r in rs]
    row(t, round(statistics.median([items[i]['file_size'] for i in ids if i in reps]) / 1e6, 1),
        dict(uni), dict(sdk), dict(ent), statistics.median(per_item('meshes')),
        statistics.median(per_item('vertices')), max([b['max_texture'] for b in bs] or [0]),
        sum(any(b['lightmaps'] for w in r['warudo'] for b in w.get('bundles', [])) for r in rs),
        sum(any(b['scripts'] for w in r['warudo'] for b in w.get('bundles', [])) for r in rs),
        sum(bool(r['loose']) for r in rs))

L += ['', '## Shaders (items that use each)', '']
sh = Counter()
for r in reps.values():
    names = {s for w in r['warudo'] for b in w.get('bundles', []) for s in b['shaders'] + b['external_shaders']}
    sh.update(names)
row('shader or external file', 'items'); row('---', '---')
for s, n in sh.most_common(40):
    row(s, n)

L += ['', '## Texture formats (texture count)', '']
tf = Counter()
for r in reps.values():
    for w in r['warudo']:
        for b in w.get('bundles', []):
            tf.update(b['textures'])
row('format', 'textures'); row('---', '---')
for s, n in tf.most_common():
    row(s, n)

L += ['', '## Scripts (items that use each)', '']
sc = Counter()
for r in reps.values():
    sc.update({s for w in r['warudo'] for b in w.get('bundles', []) for s in b['scripts']})
row('script', 'items'); row('---', '---')
for s, n in sc.most_common(40):
    row(s, n)

L += ['', '## Loose files', '']
row('item', 'file', 'type', 'flags'); row(*['---'] * 4)
for i, r in sorted(reps.items()):
    for f in r['loose']:
        row(i, f['rel'], f['file'][:60], ','.join(f['flags']) or '-')

L += ['', '## Ecosystem', '']
tags = Counter(t for it in items.values() for t in it['tags'])
row('tag', 'items'); row('---', '---')
for s, n in tags.most_common():
    row(s, n)
subs = sorted(int(it['lifetime_subscriptions'] or 0) for it in items.values())
L += ['', f'Lifetime subscriptions: min {subs[0]}, median {statistics.median(subs)}, max {subs[-1]}.',
      f'Errors: {sum(1 for r in reps.values() for w in r["warudo"] if w["error"] or any(b["error"] for b in w.get("bundles", [])))} files.']
open(f'{ART}/summary.md', 'w').write('\n'.join(L) + '\n')
print('\n'.join(L))
```

- [ ] **Step 2: Run it**

Run: `$ART/.venv/bin/python -I $ART/tools/summarize.py $ART`
Expected: all seven sections with data. The malware item appears in "Loose files" with the `powershell`, `xor`, and `OpenURL` flags.

- [ ] **Step 3: Read the descriptions for license and credit practice**

Run: `$ART/.venv/bin/python -I -c "import json;[print(x['id'],x['type_tag'],'|',(x['description'] or '')[:300].replace('\n',' ')) for x in json.load(open('$ART/items.json'))]"`
Record in `$ART/notes.md`: how many items state a license, a source (for example Booth, Sketchfab, or a Unity Asset Store pack), a dependency on another item or a plugin, or a version history. Count by hand. Do not copy the descriptions into a committed file.

---

### Task 6: AssetRipper spot check of the Livehouse Stage

**Files:**
- Create: `$ART/spot/livehouse/` (extracted bundles, export, notes)

**Interfaces:**
- Consumes: `read_entry` from Task 1, `$ART/dl/3783948202`.
- Produces: a section "Spot check" in `$ART/notes.md`.

- [ ] **Step 1: Extract the two bundles**

```bash
$ART/.venv/bin/python -I -c "
import sys; sys.path.insert(0, '$ART/tools')
from umod import read_entry
p = '$ART/dl/3783948202/Environments/livehouse 3.warudo'
for n in ('sharedassets.bin', 'sceneassets.bin'):
    open('$ART/spot/livehouse/' + n, 'wb').write(read_entry(p, n))
"
ls -l $ART/spot/livehouse
```

Expected: two files that start with `UnityFS`.

- [ ] **Step 2: Get AssetRipper**

Download the latest macOS arm64 release zip from https://github.com/AssetRipper/AssetRipper/releases into `$ART/spot/assetripper/` (not into a download folder of an item). Unzip it. Run `xattr -dr com.apple.quarantine $ART/spot/assetripper` only after the user agrees to run a downloaded binary. Ask first.

- [ ] **Step 3: Export**

Start AssetRipper. It serves a local web UI. Load the folder `$ART/spot/livehouse` (File > Open Folder). Export as a Unity project to `$ART/spot/livehouse/export`. If the web UI needs a browser, use the Chrome tools. If AssetRipper fails, use UnityPy instead: export each `Mesh` with `obj.read().export()` to `.obj` and each `Texture2D` with `obj.read().image.save()` to PNG.

- [ ] **Step 4: Record the mapping**

In `$ART/notes.md` under "Spot check", record:
- The scene hierarchy depth and the GameObject count. The components on the GameObjects (MeshRenderer, Light, ReflectionProbe, LightProbeGroup, Volume, AudioSource, scripts).
- The materials: shader name, the main texture slots, and the properties that a three.js `MeshStandardMaterial` or `MeshBasicMaterial` can take.
- The lightmaps: count, size, format, and whether `m_LightmapIndex` and `m_LightmapScaleOffset` on the renderers give a usable second UV set for three.js `lightMap`.
- The post-processing (URP Volume profiles) and what OpenSekai has for it.
- A verdict: what a conversion to GLB would keep, approximate, and lose.

---

### Task 7: Findings document

**Files:**
- Create: `docs/superpowers/specs/2026-10-17-warudo-workshop-research.md`
- Modify: `docs/superpowers/specs/2026-10-17-warudo-workshop-research-design.md` (add a link to the findings)

- [ ] **Step 1: Write the document**

Use ASD-STE100. Sections, each with data from `$ART/summary.md` and `$ART/notes.md`:

1. **Summary.** Five to eight lines with the main answers.
2. **Sample.** Date, method, counts by type, skipped items and why, the UnityPy version.
3. **Format.** The `.warudo` byte layout (outer header, zip entries by type, `modinfo.dat` fields, `.meta` layout). Mark unknown fields.
4. **Content shape.** The "Shape by type" table.
5. **Materials and shaders.** The shader table, grouped into families. Say which families OpenSekai has material profiles for, from [the architecture](2026-10-02-opensekai-architecture-design.md) and the MAT items in [the parity checklist](../../warudo-parity.md).
6. **Behavior and code.** Script and loose-file counts. The malware case: item 3817817029, title, tag (`Environment`, not the official `Environments`), subscription count, publish date, and the attack path (plugin `OnCreate` → `Application.OpenURL` on a loose `.bat` → hidden PowerShell with an XOR-decoded payload). Give the SHA-256 of the DLL and the `.bat`. Do not include the payload or the decode key.
7. **Ecosystem.** Tags, subscriptions, license and credit practice, dependencies.
8. **Spot check.** The Livehouse Stage verdict from Task 6.
9. **Implications for OpenSekai.** One numbered list. Each item names the OpenSekai area (package format, EXT sandbox, content registry, ENV and prop import, MAT) and says what to do. Keep the ".warudo import" option as a candidate with a selection gate (for example: if more than half of the sampled props and environments use shaders with a known OpenSekai profile and the spot check keeps the lightmaps). Do not claim an implementation.

Aggregate numbers only. Do not copy descriptions, previews, or extracted assets.

- [ ] **Step 2: Link it from the design**

Add one line under the design's "Completion" section: `Findings: [2026-10-17-warudo-workshop-research.md](2026-10-17-warudo-workshop-research.md).`

- [ ] **Step 3: Check that nothing raw is staged, then commit**

```bash
pwd
git status --short
git add docs/superpowers/specs/2026-10-17-warudo-workshop-research.md docs/superpowers/specs/2026-10-17-warudo-workshop-research-design.md
git diff --cached --stat
git commit -m "docs: add the Warudo Workshop research findings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: `pwd` is the OpenSekai root. Only the two docs are staged. `git status` shows no path under `artifacts/`.

---

### Task 8: Parity checklist and issues

**Files:**
- Modify: `docs/warudo-parity.md`
- GitHub: new issues, roadmap index #139

- [ ] **Step 1: Add the detail lines**

In `docs/warudo-parity.md`, add a baseline line after the `UI audit: 2026-10-17` line: `Workshop study: 2026-10-17, about 30 Steam Workshop items. Lines marked \`Workshop study\` come from it. See [the findings](superpowers/specs/2026-10-17-warudo-workshop-research.md).` Then add nested `  - Workshop study: …` lines under EXT-04 (Workshop) and under the ENV, SCN, CHR, or MAT items that the findings change. One line each, a fact, no plan.

- [ ] **Step 2: Add new items**

For each implication in findings section 9 that has no checklist item, add one. Use the next free ID in its family (`grep -o 'EXT-[0-9]*' docs/warudo-parity.md | sort -V | tail -1`). Likely candidates: a package content scan with trust warnings (EXT family), a package manifest with license and credit fields (EXT family), and a `.warudo` import candidate with its selection gate (ENV family, Different API). Do not add an item that the findings do not support.

- [ ] **Step 3: Create one issue for each new item**

For each new item:

```bash
gh issue create --repo danirukun/opensekai \
  --title "<ID> — <title>" \
  --label parity --label phase:later --label status:planned --label area:<area> \
  --body "<STE body: the behavior, the evidence summary from the findings, and a link to docs/superpowers/specs/2026-10-17-warudo-workshop-research.md>"
```

Use the `area:*` label that the other items of that family use (`gh issue list --repo danirukun/opensekai --search "EXT-0" --json number,labels --limit 5`). Add the issue link to the checklist line in the form `[GitHub #N](https://github.com/danirukun/opensekai/issues/N)`.

- [ ] **Step 4: Update the roadmap index #139**

Run `gh issue view 139 --repo danirukun/opensekai --json body -q .body > $ART/index139.md`. Add each new entry in its group and update the count in the header. Then `gh issue edit 139 --repo danirukun/opensekai --body-file $ART/index139.md`.

- [ ] **Step 5: Commit**

```bash
pwd
git add docs/warudo-parity.md
git commit -m "docs: add Warudo Workshop study items to the parity checklist

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: one file changed. Ask the user before pushing or opening a PR.
