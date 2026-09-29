#!/usr/bin/env python3
"""Verify the release before installation. Never downloads anything."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'package-manifest.json').read_text())
for name, expected in manifest['files'].items():
    file = root / name
    if not file.resolve().is_relative_to(root.resolve()):
        raise SystemExit(f'Unsafe package path: {name}')
    if not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest() != expected:
        raise SystemExit(f'Package verification failed: {name}')
for name in ('.runtime/python/bin/python3', '.runtime/foreground-extractor',
             'public/vendor/mediapipe/models/interactive_segmentation.task',
             'public/vendor/mediapipe/wasm/vision_wasm_internal.wasm'):
    if not (root / name).is_file():
        raise SystemExit(f'Missing required dependency: {name}')
print(f"Verified Field/Study {manifest['version']} ({len(manifest['files'])} files).")
