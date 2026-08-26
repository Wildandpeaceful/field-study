# Field/Study

A private, local-first editorial image studio with switchable art tools. Foreground Study isolates people and objects, Poetic Fragments weaves image crops through editable captions, and Contour Loom translates shape references into texture-filled pixel ornaments.

## Run it

Double-click `start.command`, or run:

```bash
python3 app.py
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). The first launch compiles a very small Swift helper in `work/bin`; uploads never leave the computer.

## What works

### Shared Editorial Text controls

- Click any available text group directly on the artwork to select and highlight it
- Drag selected text freely; use the corner handle to resize and the round handle to rotate
- Arrow keys nudge by 1 px, while Shift + Arrow moves by 10 px
- Contextual size, rotation, opacity, color, lock, reset, and directional controls in every tool
- Selection boxes and handles are interface-only and never appear in PNG exports
- Poetic Fragments keeps its caption and inline image fragments grouped during transforms

### Foreground Study

- Apple Vision foreground extraction
- One-image and two-image workflows: reuse one photograph, or upload separate subject and lower-frame images
- Original, pixel, and halftone subject treatments, with optional zero-to-disable color-step and contrast controls
- Image-derived harmonious and contrast palettes
- Three editorial layout systems
- Independent subject and photograph positioning, selectable by clicking the upper or lower canvas half
- Editable, independently transformable title, note, style, and palette copy
- Optional distributed word rail over the lower photo with automatic contrast
- Collapsible controls, with Subject Treatment and Image Palette open by default
- 900 × 1200 and 1350 × 1800 PNG export

### Poetic Fragments

- Editable, locally suggested poetic captions
- Three to ten crop windows woven directly into the caption
- Locked/manual or randomized crop placement
- Adjustable crop size, text scale, typeface, fragment marks, colors, and photo framing
- The caption and its inline image crops move, scale, and rotate as one stable editorial group
- Drag crop windows in the lower photograph to change the fragments shown above
- Independent state when switching between tools
- 900 × 1200 and 1350 × 1800 PNG export

### Contour Loom

- Separate texture/lower-photo and contour/shape uploads
- Built-in Lucide source picker with local search across 2,035 icon shapes; a chosen SVG feeds directly into the existing contour matrix
- Drag/drop, file-picker, and clipboard-paste source input with per-image remove/reset actions
- Adjustable pixel-grid detail, contour sensitivity, edge cleanup, cell spacing, and invert mode
- Hollow-outline or filled-motif rendering
- Square, round, and diamond pixel cells with continuous, mosaic, or tonal texture mapping
- Original, horizontal, vertical, four-way, and kaleidoscope symmetry
- Texture-filled ornament above and matching color mask over the lower photograph
- Draggable motif and photo layers with independent scale controls
- Dotted-field styling, two explicit layout systems, and two independently transformable editorial labels
- Local dual-image label suggestions based on texture color, contour density, and symmetry
- 900 × 1200 and 1350 × 1800 PNG export

Requires macOS 14 or later and Xcode Command Line Tools (or Xcode).

## Local icon assets

The app vendors Lucide's complete static SVG set under `public/vendor/lucide/icons/` for a future searchable icon picker. `public/vendor/lucide/manifest.json` provides display labels, search tags, asset paths, version, and license metadata without requiring a network request or runtime package.

To rebuild the manifest after updating the vendored package, run:

```bash
node scripts/build-lucide-manifest.mjs
```

See `THIRD_PARTY_NOTICES.md` and `public/vendor/lucide/LICENSE` for acknowledgments and license terms.
