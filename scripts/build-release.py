#!/usr/bin/env python3
"""Build the self-contained Apple-silicon release on macOS with Xcode tools."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://github.com/astral-sh/python-build-standalone/releases/download/20260924/'
RUNTIMES = {
    'python.tar.gz': ('cpython-3.12.14%2B20260924-aarch64-apple-darwin-install_only_stripped.tar.gz',
                      'c2edb321cd32ec2b170df208db0446dccc4398db602ca27cf2079098fb1f7d9d'),
    'python-full.tar.zst': ('cpython-3.12.14%2B20260924-aarch64-apple-darwin-pgo%2Blto-full.tar.zst',
                          '0bcd6620de677cb12e19a987ab78603267d4c1173ed72ba082a91fe85ac36959'),
}

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--cache', type=Path, default=ROOT / 'work' / 'release-cache')
    parser.add_argument('--output', type=Path, default=ROOT / 'dist')
    args = parser.parse_args()
    if platform.system() != 'Darwin' or platform.machine() != 'arm64':
        raise SystemExit('Build this release on an Apple-silicon Mac with Xcode Command Line Tools.')
    args.cache.mkdir(parents=True, exist_ok=True)
    args.output.mkdir(parents=True, exist_ok=True)
    for name, (url, expected) in RUNTIMES.items():
        file = args.cache / name
        if not file.exists() or sha(file) != expected:
            print(f'Downloading pinned runtime component: {name}', flush=True)
            partial = file.with_suffix('.partial')
            urllib.request.urlretrieve(BASE + url, partial)
            if sha(partial) != expected:
                raise SystemExit(f'Checksum mismatch: {name}')
            partial.replace(file)
    with tempfile.TemporaryDirectory(prefix='field-study-build-') as temp:
        bundle = Path(temp) / 'FieldStudy'
        bundle.mkdir()
        # Explicit allowlist: never ship uploads, .env, Git history, work files or local credentials.
        for name in ('public', 'vision', 'scripts'):
            shutil.copytree(ROOT / name, bundle / name,
                            ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '.DS_Store'))
        for name in ('README.md','THIRD_PARTY_NOTICES.md','LICENSE','VERSION','app.py',
                     'start.command','field-study','install.sh'):
            shutil.copy2(ROOT / name, bundle / name)
        runtime = bundle / '.runtime'
        runtime.mkdir()
        subprocess.run(['tar', '-xzf', str(args.cache / 'python.tar.gz'), '-C', str(runtime)], check=True)
        subprocess.run(['tar', '-xf', str(args.cache / 'python-full.tar.zst'), '-C', str(runtime),
                        'python/licenses', 'python/PYTHON.json'], check=True)
        print('Compiling the Apple Vision helper for macOS 14+.', flush=True)
        subprocess.run(['xcrun','swiftc',str(ROOT/'vision/ForegroundExtractor.swift'),'-O',
            '-target','arm64-apple-macosx14.0','-module-cache-path',str(args.cache/'swift-module-cache'),
            '-framework','Vision','-framework','CoreImage','-framework','CoreML','-framework','AppKit',
            '-o',str(runtime/'foreground-extractor')],check=True)
        subprocess.run(['codesign','--force','--sign','-',str(runtime/'foreground-extractor')],check=True)
        # Bytecode is machine-generated cache, not a distributable dependency.
        for cache in list(runtime.rglob('__pycache__')):
            shutil.rmtree(cache)
        for bytecode in runtime.rglob('*.pyc'):
            bytecode.unlink()
        files = {str(f.relative_to(bundle)): sha(f) for f in sorted(bundle.rglob('*')) if f.is_file()}
        manifest = {'version':(ROOT/'VERSION').read_text().strip(),'platform':'macOS-arm64',
                    'python':'3.12.14','files':files}
        (bundle/'package-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
        subprocess.run([str(runtime/'python/bin/python3'),'-I','-B',str(bundle/'scripts/verify-package.py')],check=True)
        archive = args.output/'FieldStudy-macOS-arm64.zip'
        if archive.exists():
            raise SystemExit(f'Output already exists: {archive}. Choose a fresh --output directory.')
        subprocess.run(['/usr/bin/ditto','-c','-k','--norsrc','--keepParent',str(bundle),str(archive)],check=True)
        (args.output/'SHA256SUMS').write_text(f'{sha(archive)}  {archive.name}\n')
        shutil.copy2(ROOT/'VERSION',args.output/'VERSION')
        print(f'Ready: {archive} ({archive.stat().st_size/1024**2:.1f} MiB)',flush=True)

if __name__ == '__main__':
    main()
