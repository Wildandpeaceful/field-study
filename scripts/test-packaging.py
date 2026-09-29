#!/usr/bin/env python3
"""Check package invariants and real server responses without external services."""
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import urllib.error
import urllib.parse
import urllib.request
from http.server import ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('studio', ROOT / 'app.py')
studio = importlib.util.module_from_spec(spec)
spec.loader.exec_module(studio)
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
server = ThreadingHTTPServer(('127.0.0.1', 0), studio.StudioHandler)
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{server.server_port}'
try:
    with opener.open(url + '/api/health') as response:
        health = json.load(response)
    assert health['app'] == 'field-study' and health['version'] == (ROOT / 'VERSION').read_text().strip()
    assert health['local'] and health['install'] == studio.INSTALL_ID
    with opener.open(url + '/') as response:
        html = response.read().decode()
    assert 'Field/Study' in html and 'Editorial Collage' in html and 'Text Field' in html
    for asset in ('/vendor/mediapipe/models/interactive_segmentation.task',
                  '/vendor/mediapipe/wasm/vision_wasm_internal.wasm', '/frost-sample.svg'):
        with opener.open(url + asset) as response:
            assert len(response.read()) == int(response.headers['Content-Length']) > 0
    png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==')
    data = urllib.parse.urlencode({'image':'data:image/png;base64,' + base64.b64encode(png).decode(),
                                  'filename':'cover.png'}).encode()
    with opener.open(url + '/api/export', data=data) as response:
        assert response.read() == png and 'cover.png' in response.headers['Content-Disposition']
finally:
    server.shutdown()
    server.server_close()

# Verify relocation and rejection of corruption without executing any downloaded runtime.
with tempfile.TemporaryDirectory(prefix='field study package test ') as temp:
    root = Path(temp)
    (root / 'scripts').mkdir()
    (root / 'scripts/verify-package.py').write_bytes((ROOT / 'scripts/verify-package.py').read_bytes())
    names = ['.runtime/python/bin/python3', '.runtime/foreground-extractor',
             'public/vendor/mediapipe/models/interactive_segmentation.task',
             'public/vendor/mediapipe/wasm/vision_wasm_internal.wasm']
    for name in names:
        file = root / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text('fixture')
    manifest = {'version':'1.0.0','files':{name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in names}}
    (root/'package-manifest.json').write_text(json.dumps(manifest))
    command = [sys.executable, '-I', '-B', str(root/'scripts/verify-package.py')]
    assert subprocess.run(command,capture_output=True).returncode == 0
    (root/names[1]).write_text('corrupt')
    failed = subprocess.run(command,capture_output=True,text=True)
    assert failed.returncode != 0 and 'verification failed' in failed.stderr
print('Packaging checks passed: local health, assets, export, relocation, corruption detection.')
