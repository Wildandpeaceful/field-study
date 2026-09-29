# Third-party notices

## Lucide Icons

Field/Study includes the complete static SVG collection from `lucide-static` 1.34.0 for future in-app icon selection.

- Project: [Lucide](https://lucide.dev)
- Source: [lucide-icons/lucide](https://github.com/lucide-icons/lucide)
- License: ISC, with MIT terms for the Feather-derived icons identified by Lucide
- Vendored license: `public/vendor/lucide/LICENSE`

The copyright and permission notices supplied by Lucide are preserved in the vendored license file and in the individual SVG files.

## omggif

Field/Study includes the dependency-free `omggif` GIF89a decoder so Contour Loom can render animated GIF frames reliably in its canvas and exports.

- Project: [omggif](https://github.com/deanm/omggif)
- Copyright: Dean McNamee, 2013
- License: MIT
- Vendored license: `public/vendor/omggif/LICENSE`

## GIPHY API (optional network service)

Contour Loom optionally connects to the GIPHY Sticker Search API when an artist supplies their own API key. Field/Study does not bundle GIPHY media or credentials. Search results remain subject to GIPHY's API Terms of Service and attribution requirements.

- Service: [GIPHY Developers](https://developers.giphy.com/)
- Terms: [GIPHY API Terms of Service](https://support.giphy.com/hc/en-us/articles/360020027752-GIPHY-API-Terms-of-Service)

## MediaPipe Tasks Vision and MagicTouch

Field/Study includes the MediaPipe Tasks Vision 1.0.1 browser runtime and the MagicTouch interactive-segmentation model so artists can select arbitrary visible objects with a point prompt while remaining offline.

- Project: [MediaPipe](https://ai.google.dev/edge/mediapipe/solutions/guide)
- Source: [google-ai-edge/mediapipe](https://github.com/google-ai-edge/mediapipe)
- Model: MagicTouch Interactive Segmenter
- License: Apache License 2.0
- Vendored license: `public/vendor/mediapipe/LICENSE`

## Python runtime (release ZIP only)

The ready-to-run macOS package contains CPython 3.12.14 from Astral's
[python-build-standalone release 20260924](https://github.com/astral-sh/python-build-standalone/releases/tag/20260924).
The build script pins upstream SHA-256 digests. CPython and bundled library license
texts are included in `.runtime/python/licenses/`, with CPython's own license at
`.runtime/python/lib/python3.12/LICENSE.txt`. Runtime metadata is in
`.runtime/python/PYTHON.json`. These components retain their upstream licenses.

The Apple Vision frameworks are supplied by macOS, not redistributed with Field/Study.
The small compiled foreground helper is built from this repository's MIT-licensed Swift source.
