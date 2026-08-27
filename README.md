# Field/Study

A private, local-first editorial image studio with switchable art tools. Foreground Study isolates people and objects, Poetic Fragments weaves image crops through editable captions, Contour Loom translates shape references into texture-filled pixel ornaments, and Image Index maps isolated subjects into labeled editorial grids.

## Run it

Double-click `start.command`, or run:

```bash
python3 app.py
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). The first launch compiles a very small Swift helper in `work/bin`; uploads never leave the computer.

## What works

### Shared media and export flow

- A single Export action opens a compact format dialog for the active composition
- PNG is always offered when the composition is ready; animated export appears when Poetic Fragments or Contour Loom has a GIF or video source
- Output size and motion duration are shown only inside the export dialog
- Media-capable inputs accept images, GIFs, and videos through one chooser and detect the uploaded format automatically

### Shared Editorial Text controls

- Click any available text group directly on the artwork to select and highlight it
- Drag selected text freely; use the corner handle to resize and the round handle to rotate
- Arrow keys nudge by 1 px, while Shift + Arrow moves by 10 px
- Contextual size, rotation, opacity, color, lock, reset, and directional controls in every tool
- Selection boxes and handles are interface-only and never appear in PNG exports
- Poetic Fragments keeps its caption and inline image fragments grouped during transforms

### Shared project palettes and selection

- Every workspace extracts a perceptually balanced palette from its current image, GIF frame, or video frame
- Palette swatches can target the colors relevant to each composition, including fields, editorial text, grid lines, solid motifs, and lower echoes
- Artwork layers can be selected directly on the canvas; clicking the selected layer again or pressing Escape clears the selection

### Foreground Study

- Apple Vision foreground extraction
- One-image and two-image workflows: reuse one photograph, or upload separate subject and lower-frame images
- Original, pixel, and halftone subject treatments, with optional zero-to-disable contrast and no required color quantization
- Image-derived harmonious and contrast palettes
- Multi-subject masks are split into individually selectable extracted assets that can be included or excluded from the study
- Point-guided local extraction can isolate an arbitrary visible person or object—even when automatic foreground detection misses it—and add the result as another selectable asset
- Three editorial layout systems
- Independent subject and photograph positioning, selectable by clicking the upper or lower canvas half, with scaling up to 600% for intentional out-of-frame crops
- Editable, independently transformable title, note, style, and palette copy
- Optional distributed word rail over the lower photo with automatic contrast
- Collapsible controls, with Subject Treatment and Image Palette open by default
- 900 × 1200 and 1350 × 1800 PNG export

### Poetic Fragments

- One source chooser accepts still images, animated GIFs, MP4, WebM, and MOV files and detects the format automatically
- GIF and video sources loop through the lower field and every inline caption fragment, with play/pause and 0.25×–2× speed controls
- Videos start muted and include an optional sound toggle
- Editable, locally suggested poetic captions
- Three to ten crop windows woven directly into the caption
- Locked/manual or randomized crop placement
- Adjustable crop size, text scale, typeface, fragment marks, colors, and photo framing
- The caption and its inline image crops move, scale, and rotate as one stable editorial group
- Drag crop windows in the lower source to change the fragments shown above
- Independent state when switching between tools
- 900 × 1200 and 1350 × 1800 PNG export captures the current frame; browser-native animated export records 3–60 seconds at the selected playback speed

### Contour Loom

- Texture/lower-frame and contour/shape sources each accept a still image, animated GIF, or locally playing video; contour shapes can also come from Lucide icons
- Transparent GIF/video frames are read from their alpha channel while opaque footage uses the existing contrast/luminance extraction, producing a live moving pixel mask
- GIFs loop automatically; videos retain independent play/pause, looped playhead scrubbing, replace, clear, current-time, and sound on/off controls
- Videos start muted; enabling sound on one video automatically mutes the other video source to prevent competing audio, and the enabled source is included in animated export when the browser can capture its audio track
- Built-in Lucide source picker with local search across 2,035 icon shapes; a chosen SVG feeds directly into the existing contour matrix
- Drag/drop, file-picker, and clipboard-paste source input with remove/reset actions
- Adjustable pixel-grid detail, contour sensitivity, edge cleanup, cell spacing, and invert mode
- Hollow-outline or filled-motif rendering
- Independent upper motif treatments: woven texture pixels, a selectable solid color, or the original uploaded logo/icon artwork
- Optional lower contour echo can be hidden without changing the upper motif
- Square, round, and diamond pixel cells with continuous, mosaic, or tonal texture mapping
- Original, horizontal, vertical, four-way, and kaleidoscope symmetry
- Texture-filled ornament above and matching color mask over the lower image, GIF, or moving video frame
- Independently draggable and scalable upper motif, lower contour echo, and lower media layers
- Optional placement linking keeps the upper motif and lower echo synchronized until an artist needs separate positioning
- Independently selectable upper-field, solid-motif, lower-echo, and text colors, plus dotted-field styling, two explicit layout systems, two transformable upper labels, and an optional editable photo-word rail over the lower image or video
- Local source-pair label suggestions based on texture color, contour density, and symmetry
- 900 × 1200 and 1350 × 1800 still PNG export captures the current animation frame
- Browser-native animated export records the full composition for 3–60 seconds (10 seconds by default), starting at the current texture and contour playheads and looping each moving source when needed

### Image Index

- One image upload returns a locally isolated foreground plus Apple Vision category hints without an external API key
- Automatic labels combine local classification, image color, brightness, saturation, and orientation; every label remains directly editable
- Deterministic fragmented or contained grids with 8–36 indexed cells and one-click structure rerolls
- Mixed horizontal and vertical pixel-stretch cells, clear subject windows, blank cells, adjustable spread, line weight, type scale, and colors
- Direct subject dragging with lime center-alignment guides, keyboard nudging, and independent scale and position controls
- A composition-level Reset to defaults action keeps the current image while clearing inherited grid, color, type, and transform settings
- 900 × 1200 and 1350 × 1800 PNG export through the shared export dialog

Animated export remains entirely in the browser. Field/Study prefers MP4 when the browser's `MediaRecorder` supports it and falls back to WebM; enabled video sound is included when the browser can capture its audio track, while GIF exports are silent. Exact format support depends on the browser and operating system.

Requires macOS 14 or later and Xcode Command Line Tools (or Xcode).

## Local icon assets

The app vendors Lucide's complete static SVG set under `public/vendor/lucide/icons/` for Contour Loom's searchable icon picker. `public/vendor/lucide/manifest.json` provides display labels, search tags, asset paths, version, and license metadata without requiring a network request or runtime package.

To rebuild the manifest after updating the vendored package, run:

```bash
node scripts/build-lucide-manifest.mjs
```

See `THIRD_PARTY_NOTICES.md` and the vendored license files for acknowledgments and license terms.

Contour Loom decodes animated GIF sources locally with the vendored, MIT-licensed [omggif](https://github.com/deanm/omggif) library. See `public/vendor/omggif/LICENSE` for its license terms.
