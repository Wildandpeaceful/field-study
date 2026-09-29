#!/usr/bin/env python3
"""Launch the bundled local server without shell profiles or developer tools."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import socket
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
VERSION = (ROOT / 'VERSION').read_text().strip()
INSTALL = hashlib.sha256(str(ROOT).encode()).hexdigest()[:16]

def banner():
    color = sys.stdout.isatty() and 'NO_COLOR' not in os.environ
    ink, reset = ('\033[38;5;191m', '\033[0m') if color else ('', '')
    print(f'''{ink}
    +-------------------------------+
    |  F I E L D / S T U D Y         |
    |  [ ] [ ] [ ]   /   MAKE ART   |
    +-------------------------------+{reset}
    Local image studio / {VERSION}
''', flush=True)

def health(port):
    try:
        # Do not route loopback requests through an environment-configured proxy.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(f'http://127.0.0.1:{port}/api/health', timeout=0.5) as response:
            return json.load(response)
    except (OSError, ValueError):
        return {}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--no-open', action='store_true', help='Print the address without opening a browser')
    parser.add_argument('--preview', action='store_true', help='Show terminal art without starting anything')
    parser.add_argument('--port', type=int, default=int(os.environ.get('FIELD_STUDY_PORT', '4173')))
    args = parser.parse_args()
    banner()
    if args.preview:
        return
    if platform.system() != 'Darwin' or platform.machine() != 'arm64':
        raise SystemExit('This download requires an Apple-silicon Mac. Intel, Windows and Linux are not supported.')
    if int(platform.mac_ver()[0].split('.')[0]) < 14:
        raise SystemExit('Field/Study requires macOS 14 or newer.')
    if not 1024 <= args.port <= 65515:
        raise SystemExit('Choose a port between 1024 and 65515.')
    required = ['.runtime/foreground-extractor', 'public/index.html',
                'public/vendor/mediapipe/models/interactive_segmentation.task',
                'public/vendor/mediapipe/wasm/vision_wasm_internal.wasm']
    if any(not (ROOT / path).is_file() for path in required):
        raise SystemExit('A bundled component is missing. Run field-study update to repair the installation.')
    process = None
    log_path = None
    for port in range(args.port, args.port + 20):
        status = health(port)
        if status.get('app') == 'field-study' and status.get('install') == INSTALL and status.get('version') == VERSION:
            break
        with socket.socket() as probe:
            try:
                probe.bind(('127.0.0.1', port))
            except OSError:
                continue
        logs = Path(os.environ.get('FIELD_STUDY_LOG_DIR', str(Path.home() / 'Library' / 'Logs' / 'FieldStudy')))
        logs.mkdir(parents=True, exist_ok=True)
        log_path = logs / f'server-{port}.log'
        env = os.environ.copy()
        env.update(FIELD_STUDY_HOST='127.0.0.1', FIELD_STUDY_PORT=str(port), PYTHONDONTWRITEBYTECODE='1')
        with log_path.open('ab') as log:
            process = subprocess.Popen([sys.executable, '-I', '-B', '-u', str(ROOT / 'app.py')],
                cwd=ROOT, env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
        for _ in range(100):
            if process.poll() is not None:
                raise SystemExit(f'The local server could not start. Details: {log_path}')
            if health(port).get('install') == INSTALL:
                break
            time.sleep(0.1)
        else:
            process.terminate()
            raise SystemExit(f'The server did not become ready. Details: {log_path}')
        break
    else:
        raise SystemExit('No free local port found. Try: field-study --port 4200')
    url = f'http://127.0.0.1:{port}/'
    print(f'Ready: {url}\nYour photos stay on this computer. No API key required.', flush=True)
    if log_path:
        print(f'Server log: {log_path}', flush=True)
    if not args.no_open:
        subprocess.run(['/usr/bin/open', url], check=True)
    print('Export your artwork before closing or refreshing the browser.\nUpdate: ~/.local/bin/field-study update', flush=True)

if __name__ == '__main__':
    main()
