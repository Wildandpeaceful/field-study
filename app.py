#!/usr/bin/env python3
"""Local HTTP server for the Field/Study image composition tool."""

from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import sys
import tempfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parent
PUBLIC_DIR = ROOT / "public"
SWIFT_SOURCE = ROOT / "vision" / "ForegroundExtractor.swift"
BIN_DIR = ROOT / "work" / "bin"
EXTRACTOR = BIN_DIR / "foreground-extractor"
MAX_UPLOAD_BYTES = 30 * 1024 * 1024
MAX_EXPORT_BYTES = 24 * 1024 * 1024


def compile_extractor() -> None:
    """Compile the small Vision helper when missing or stale."""
    if EXTRACTOR.exists() and EXTRACTOR.stat().st_mtime >= SWIFT_SOURCE.stat().st_mtime:
        return
    BIN_DIR.mkdir(parents=True, exist_ok=True)
    command = [
        "xcrun",
        "swiftc",
        str(SWIFT_SOURCE),
        "-O",
        "-module-cache-path",
        str(ROOT / "work" / "swift-module-cache"),
        "-framework",
        "Vision",
        "-framework",
        "CoreImage",
        "-framework",
        "CoreML",
        "-framework",
        "AppKit",
        "-o",
        str(EXTRACTOR),
    ]
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "Could not compile the Vision helper")


class StudioHandler(SimpleHTTPRequestHandler):
    server_version = "FieldStudy/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC_DIR), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        sys.stdout.write("[field-study] " + (fmt % args) + "\n")

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if urlparse(self.path).path == "/api/health":
            self.send_json(200, {"ok": True, "engine": "Apple Vision", "local": True})
            return
        super().do_GET()

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/export":
            self.handle_export()
            return
        if path != "/api/segment":
            self.send_json(404, {"error": "Not found"})
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        content_type = self.headers.get("Content-Type", "application/octet-stream")
        if content_length <= 0:
            self.send_json(400, {"error": "No image was received"})
            return
        if content_length > MAX_UPLOAD_BYTES:
            self.send_json(413, {"error": "Image is larger than 30 MB"})
            return
        if not content_type.startswith("image/"):
            self.send_json(415, {"error": "Please upload an image file"})
            return

        suffix_by_type = {
            "image/jpeg": ".jpg",
            "image/png": ".png",
            "image/webp": ".webp",
            "image/heic": ".heic",
            "image/heif": ".heif",
        }
        suffix = suffix_by_type.get(content_type.split(";", 1)[0], ".img")

        try:
            compile_extractor()
            with tempfile.TemporaryDirectory(prefix="field-study-") as tmp_dir:
                source = Path(tmp_dir) / f"source{suffix}"
                output = Path(tmp_dir) / "foreground.png"
                remaining = content_length
                with source.open("wb") as handle:
                    while remaining:
                        chunk = self.rfile.read(min(1024 * 1024, remaining))
                        if not chunk:
                            break
                        handle.write(chunk)
                        remaining -= len(chunk)
                if remaining:
                    self.send_json(400, {"error": "Image upload ended early"})
                    return

                result = subprocess.run(
                    [str(EXTRACTOR), str(source), str(output)],
                    capture_output=True,
                    text=True,
                    timeout=90,
                    check=False,
                )
                if result.returncode != 0 or not output.exists():
                    message = result.stderr.strip() or result.stdout.strip() or "No foreground subject found"
                    self.send_json(422, {"error": message})
                    return

                body = output.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        except subprocess.TimeoutExpired:
            self.send_json(504, {"error": "Foreground extraction timed out"})
        except Exception as exc:  # keep errors useful in a local-only tool
            self.send_json(500, {"error": str(exc)})

    def handle_export(self) -> None:
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length <= 0 or content_length > MAX_EXPORT_BYTES:
            self.send_json(413, {"error": "Rendered image is too large to export"})
            return
        try:
            payload = parse_qs(self.rfile.read(content_length).decode("ascii"), keep_blank_values=True)
            encoded = payload.get("image", [""])[0]
            if encoded.startswith("data:image/png;base64,"):
                encoded = encoded.split(",", 1)[1]
            image_bytes = base64.b64decode(encoded, validate=True)
            if not image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
                raise ValueError("Export data was not a PNG")
            requested_name = payload.get("filename", ["field-study.png"])[0]
            safe_name = re.sub(r"[^a-zA-Z0-9._-]+", "-", requested_name).strip("-.")
            if not safe_name.lower().endswith(".png"):
                safe_name += ".png"
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Disposition", f'attachment; filename="{safe_name or "field-study.png"}"')
            self.send_header("Content-Length", str(len(image_bytes)))
            self.end_headers()
            self.wfile.write(image_bytes)
        except Exception as exc:
            self.send_json(400, {"error": str(exc)})


def main() -> None:
    host = os.environ.get("FIELD_STUDY_HOST", "127.0.0.1")
    port = int(os.environ.get("FIELD_STUDY_PORT", "4173"))
    compile_extractor()
    server = ThreadingHTTPServer((host, port), StudioHandler)
    print(f"Field/Study is running at http://{host}:{port}")
    print("Press Control-C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Field/Study.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
