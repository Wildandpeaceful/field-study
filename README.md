# Field/Study

A free, local-first album-cover and editorial image studio with switchable art tools. Foreground Study isolates people and objects, Poetic Fragments weaves image crops through editable captions, Contour Loom translates shape references into texture-filled pixel ornaments, Image Index maps isolated subjects into labeled editorial grids, Contour Aura paints rings around a subject, Frosted Reveal opens clear windows through a textured veil, Paper Weave interlaces photo strips with alternating crossings, Embossed Print presses editable lettering into textured paper, Text Field scatters your words across photographs or local video, and Editorial Collage combines layered photographs and oversized typography for album artwork.

## Download and start

**Ready-to-run download: [FieldStudy-macOS-arm64.zip](https://github.com/Wildandpeaceful/field-study/releases/latest/download/FieldStudy-macOS-arm64.zip)**

For **Apple-silicon Macs (M1 or newer), macOS 14+**, with Safari or Chrome. Intel Macs, Windows and Linux are not supported by this release because foreground extraction uses Apple Vision. Tested on macOS 26.3, arm64; the macOS 14 deployment target has not been tested on a separate machine.

1. Download the ZIP above and unzip it.
2. Double-click **start.command** inside **FieldStudy**.
3. The installer opens the studio in your browser. Upload a photo, choose a composition, and export your cover.

The download includes Python, the compiled Apple Vision helper, the MediaPipe model and WebAssembly runtime, all icons and illustrated examples. No Python install, Node, Xcode, Homebrew, API key, or subscription is needed. No setup downloads occur after extracting the complete release. Keep your browser tab open while editing: projects currently live in memory, so export before refreshing or closing it.

The app is not Apple-signed or notarized. macOS may ask permission to open the downloaded launcher. If Finder blocks it, use the Terminal installer below; it leaves macOS security settings unchanged. Do not disable Gatekeeper.

### One-command install

Paste this into Terminal:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Wildandpeaceful/field-study/main/install.sh)"
```

Setup downloads approximately 55 MB, verifies its checksum, installs into `~/Library/Application Support/FieldStudy`, and opens the browser. No administrator password or GitHub login is required. Logs are in `~/Library/Logs/FieldStudy`.

Launch again:

```bash
~/.local/bin/field-study
```

Update:

```bash
~/.local/bin/field-study update
```

Updates install a verified version alongside the previous one. Existing files, exports, and open browser tabs are preserved. Export current artwork before switching to the updated app. Reinstalling the same version reuses its verified files. The launcher chooses a free local port if the default is occupied.

The repository's **Code → Download ZIP** is source code. Its `start.command` downloads the complete release automatically. For a fully bundled/offline installation, use the release ZIP linked above.

### Troubleshooting and development

- Server logs: `~/Library/Logs/FieldStudy/server-<port>.log`. Setup errors name the failed stage and installation log.
- To print the local address without opening a browser: `~/.local/bin/field-study --no-open`.
- To use another port: `~/.local/bin/field-study --port 4200`.
- Run `bash install.sh --preview` to see the installer artwork without making changes. `NO_COLOR=1` disables ANSI color.
- Manual offline installation: `bash install.sh --from-folder "/path/to/FieldStudy"` from the complete release.
- Local-source development requires Python 3.10+ and Xcode Command Line Tools on macOS 14+: run `python3 app.py`. It compiles the helper into the ignored `work/` directory.
- Build a release on Apple silicon: `python3 scripts/build-release.py`. It fetches checksum-pinned CPython 3.12.14 from python-build-standalone, includes upstream license files, compiles the native helper, and writes `dist/FieldStudy-macOS-arm64.zip`, `SHA256SUMS`, and `VERSION`. Runtime binaries stay in release assets, not Git history.
- Run checks: `for test in scripts/test-*.cjs; do node "$test"; done` and `python3 scripts/test-packaging.py`.

## Privacy and license

Photos and video are processed on your computer. Normal editing and export work offline. Optional GIPHY search contacts GIPHY only when you configure it and search; install/update downloads come from GitHub. System fonts are used locally.

Field/Study code is available under the [MIT License](LICENSE). Bundled dependencies retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md). No user uploads, personal artwork, credentials, or generated exports are included. You retain your rights to your own input media and artwork.

## What works

### Shared interface workflow

- Composition navigation behaves as an accessible tab set: click a tool, or use Left/Right, Home, and End while its tab is focused
- On narrow screens, full tool names remain readable in a horizontally scrollable switcher instead of being compressed
- Every control rail includes sticky Essentials and Collapse all actions plus a live count of open sections
- The global Reset action confirms which composition will change and keeps uploaded source media loaded
- If source media is loaded, the browser warns before a reload or window close that would discard the in-memory project
- Export focuses the first available format; when a composition is incomplete, it avoids trapping focus on a disabled action and keeps the requirement visible

### Shared media and export flow

- A single Export action opens a compact format dialog for the active composition
- A global Canvas menu offers 3:4, 4:5, 1:1, 9:16, and 16:9 output formats without clearing uploaded media or composition settings. The Album cover preset selects 1:1 and 3000 × 3000 px for composing and PNG export; JPEG export remains 3000 × 3000. Album artwork is a primary workflow, so future compositions must support composing directly in this square frame.
- Choosing a new canvas ratio starts in Reflow: split compositions stay stacked in tall and square formats, then move side-by-side in 16:9; editorial layout systems, inline captions, selectable text bounds, and photo-word rails recalculate inside the new panels, while Preserve and Fill remain optional fixed-design treatments
- Image Index redraws natively for the chosen aspect ratio; split panels, direct-manipulation hit areas, editable text overlays, snapping guides, canvas labels, PNG dimensions, and animated recording follow the selected format
- PNG is always offered when the composition is ready; every active composition can also export a high-quality 3000 × 3000 JPEG without changing the saved canvas ratio or artwork state; animated export appears when Poetic Fragments or Contour Loom has a moving composition
- Canvas and Export share Standard (900 px short edge), High (1350 px), and Master (3000 px) resolution. The selected size persists with the ratio, applies across compositions, and appears in canvas labels. Video export requires Standard or High; Master is for still artwork. Logical editing coordinates remain independent of output resolution.
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
- In two-image mode, a contextual Swap image roles action appears once both sources are ready and re-extracts the new upper subject locally
- Original, pixel, and halftone subject treatments, with optional zero-to-disable contrast and no required color quantization
- Image-derived harmonious and contrast palettes
- Multi-subject masks are split into individually selectable extracted assets that can be included or excluded from the study
- Point-guided local extraction can isolate an arbitrary visible person or object—even when automatic foreground detection misses it—and add the result as another selectable asset
- Upper subjects use Apple Vision's original full-resolution alpha without additional softening; the lower silhouette uses an independent expanded coverage mask so the original subject cannot show around its rim
- Auto Compose fits the selected asset group and chooses a responsive Orbit, Baseline, or Editorial arrangement while keeping every layer manually editable
- Three editorial layout systems
- Independent subject and photograph positioning, selectable by clicking the upper or lower canvas half, with scaling up to 600% for intentional out-of-frame crops
- Editable, independently transformable title, note, style, and palette copy
- Optional distributed word rail over the lower photo with automatic contrast
- Collapsible controls, with Subject Treatment and Image Palette open by default
- Format-aware standard and high-resolution PNG export

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
- Format-aware PNG export captures the current frame; browser-native animated export records 3–60 seconds at the selected playback speed

### Contour Loom

- Texture/lower-frame and contour/shape sources each accept a still image, animated GIF, or locally playing video; contour shapes can also come from Lucide icons
- When both roles use uploaded media, a contextual swap action exchanges texture and contour sources; Lucide contours remain intentionally unswappable
- Transparent GIF/video frames are read from their alpha channel while opaque footage uses the existing contrast/luminance extraction, producing a live moving pixel mask
- GIFs loop automatically; videos retain independent play/pause, looped playhead scrubbing, replace, clear, current-time, and sound on/off controls
- Videos start muted; enabling sound on one video automatically mutes the other video source to prevent competing audio, and the enabled source is included in animated export when the browser can capture its audio track
- Built-in Lucide source picker with local search across 2,035 icon shapes; a chosen SVG feeds directly into the existing contour matrix
- Optional GIPHY Sticker browser for searching transparent animated shapes; results feed the same local animated-contour pipeline, submitted searches are cached for the current session, and the existing upload workflow remains available
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
- Format-aware still PNG export captures the current animation frame
- Browser-native animated export records the full composition for 3–60 seconds (10 seconds by default), starting at the current texture and contour playheads and looping each moving source when needed

### Image Index

- One image upload returns a locally isolated foreground plus Apple Vision category hints without an external API key
- Automatic labels combine local classification, image color, brightness, saturation, and orientation; every label remains directly editable
- Deterministic fragmented or contained grids with 8–36 indexed cells and one-click structure rerolls
- Mixed horizontal and vertical pixel-stretch cells, clear subject windows, blank cells, adjustable spread, line weight, type scale, and colors
- Direct subject dragging with lime center-alignment guides, keyboard nudging, and independent scale and position controls
- A composition-level Reset to defaults action keeps the current image while clearing inherited grid, color, type, and transform settings
- Format-aware PNG export through the shared export dialog

### Contour Aura

- A fifth active composition surrounds the selected subject with painted contour rings, using local image processing and the original photograph.
- JPG, PNG, and WebP input up to 30 MB / 48 megapixels; transparent cutouts use their existing alpha. Opaque photos use Apple Vision, with the existing local point-selection model and add/erase mask brushes as correction paths.
- Chalk, Electric, and Ink presets; 1–8 rings, spacing, stroke width, first-ring offset, stable paint roughness, brush rerolls, and one or three alternating colors.
- Source-derived stroke swatches, original-photo or solid-field backgrounds, background dimming, fit/fill framing, drag/keyboard positioning, and image scale.
- Selection refinement supports eight undo steps and clear selection. Reset keeps the image and its corrected mask.
- A built-in illustrated botanical sample lets users test the controls before uploading a photo.
- Shared aspect-ratio, reset, and export dialogs; format-aware PNG and a separately rendered 3000 × 3000 JPEG. Selection overlays never appear in exports.
- Implementation is isolated in `public/contour-aura.js`, `public/aura-engine.js`, and `public/contour-aura.css`. The distance field is cached at up to 1100 pixels on its longest edge; output rings are resampled at export resolution.
- Run `node scripts/test-aura.cjs` for geometric distance, ring count/color, stable texture, empty-mask, and export-scaling checks.

### Frosted Reveal

- A sixth composition layers blur, tinted frost, and stable grain over any JPG, PNG, or WebP photograph (up to 30 MB / 48 megapixels).
- Circle and rotated rectangular openings can be dragged, resized with their on-canvas handle, or nudged with arrow keys; plus/minus adjusts opening size. Separate photo positioning lets the image move beneath an opening.
- Subject reveals use Apple Vision, the existing local point-selection model, or transparent input alpha. Painted reveals support multiple brush strokes, erasing, eight undo steps, and clear selection. Subject and painted masks follow photo framing.
- Soft Glass, Tracing Paper, and Mist presets; blur, tint strength, grain, source-derived tint colors, feathered edges, and inverted reveals are adjustable independently.
- A cached, deterministic blur/texture renderer works without CSS filters or external services. Full-resolution PNG and 3000 × 3000 JPEG exports use the same compositing path and omit selection guides.
- The botanical sample is an original illustration for trying the controls. Reset preserves the photograph and any subject/painted mask, and restores the default circle opening.
- Implementation: `public/frosted-reveal.js`, `public/frost-engine.js`, and `public/frosted-reveal.css`; run `node scripts/test-frost.cjs` for boundary, identity, source-preservation, texture, and feathering checks.

### Paper Weave

- A seventh composition cuts a photograph into perpendicular paper strips. A single source feeds both directions; an optional second source supplies the horizontal strips. No subject extraction is required.
- Plain, Basket (2 × 2), and diagonal Twill crossing patterns, reversible over/under order, and Clean, Handmade, and Basket starting presets.
- Adjustable strip width, spacing, seeded strip offsets and rotation, loose ends, paper margin, crossing shadows, paper grain, and background color.
- Each crossing restores the upper strip's original image crop, with shadows clipped to the exposed lower strip. Placement and texture remain stable while adjusting controls and exporting.
- Both sources accept JPG, PNG, and WebP up to 30 MB / 48 megapixels. Swap photos, remove the second photo, and independently fit, zoom, drag, or keyboard-nudge each source within its strips. Reset retains the photos.
- Botanical and paired color-study examples are original illustrated samples. User images stay local; PNG and 3000 × 3000 JPEG export use the existing shared dialogs and download endpoint.
- Implementation: `public/paper-weave.js`, `public/weave-engine.js`, and `public/paper-weave.css`. Run `node scripts/test-weave.cjs` for crossing topology, spacing, bounds, seeded layout, export scaling, and grain checks.

### Embossed Print

- An eighth composition renders uninked raised or recessed lettering on colored paper, using a beveled height field and directional lighting. Bevel width and press height adapt to type size so small lettering keeps its narrow strokes and open counters. Flat letter faces retain the paper color; depth, edge softness, relief contrast, light direction, paper lighting, and stable grain are adjustable.
- Blue book, Red sleeve, and Natural paper presets. Custom text is preserved when switching presets; untouched sample copy follows the template.
- Three editable text blocks (title, subtitle, edition) support multiline text, four local font stacks, type size, letter spacing, line spacing, alignment, direct dragging, and keyboard nudging. Empty blocks disappear. Text is fit to the available paper area without dropping lines; alignment changes justify text within its positioned block.
- Optional JPG, PNG, or WebP photo panels above, below, or to the left of the lettering; adjustable panel size, fit/fill framing, zoom, drag positioning, monochrome mix, contrast, and photo grain. Drag either lettering or the photo directly to select and move it; the selection control also supports keyboard nudging. Sources stay local and accept up to 30 MB / 48 megapixels.
- Paper, text relief, and photo treatment share the same rendering path for preview, format-aware PNG, and separately rendered 3000 × 3000 JPEG. Text selection guides are interface-only. Reset retains the uploaded photo but returns to the Blue book layout.
- The optional botanical sample is an original illustration. Implementation: `public/embossed-print.js`, `public/emboss-engine.js`, and `public/embossed-print.css`. Run `node scripts/test-emboss.cjs` for material, lighting, bevel, panel, and framing checks.

### Text Field

- A ninth composition places editable words or one phrase per line over JPG, PNG, or WebP images (up to 30 MB / 48 megapixels), or locally decoded MP4, WebM, M4V, and compatible MOV video (up to 250 MB / 16 megapixels per frame). Sources stay local. A botanical illustration is available as a starter sample. Unsupported codecs and invalid files leave the current source intact.
- Scatter, Grid, and Verse presets keep custom copy. Repeat fills the frame in reading order; without repeat, each word or phrase appears once. The status reports how much source copy fits and when long phrases are scaled down.
- Adjustable columns, type size, row spacing, fill density, scatter, margins, and seeded spacing shuffles. Generated placements avoid overlaps and keep words inside the canvas; the same logical layout drives preview and PNG export.
- Drag individual words or phrases, or select them with Previous/Next and nudge with arrow keys (Shift for larger steps). Structural layout changes reset manual word positions; color and photo adjustments preserve them.
- A movable oval clear area leaves a face or focal point unobstructed without skipping source words. It is positioned manually, not detected automatically. Clear-area edits rebuild placements and clear manual offsets; manually dragging a word can override the reserved area.
- Bold sans, serif, and monospace text; white, black, custom ink, or local automatic contrast. Photo dimming, monochrome mix, stable grain, fit/fill framing, zoom, and independent photo dragging.
- Video offers looping play/pause, a scrubbable playhead, 0.25×–2× playback speed, and optional source sound (off initially). Words and the manual clear area remain fixed in the frame; there is no object tracking. Switching compositions or hiding the tab pauses playback. Replacement/removal releases video and audio resources.
- Shared canvas formats, reset (keeps the source), current-frame PNG and separate 3000 × 3000 JPEG export. Videos can also record a 3–60 second composition from the current playhead, looping as needed, at the chosen standard or high output size. Browser-native MP4 is preferred with WebM fallback; enabled sound is routed through Web Audio into the recording.
- Moving export runs in real time; keep the tab visible. Controls lock during recording, Cancel discards the partial clip, and completion/cancellation restores the source playhead and prior playback state. Guides never export. Video uses reusable canvas/filter/grain surfaces to avoid full-frame CPU pixel processing on every frame. No additional dependencies or external services.
- Implementation: `public/text-field.js`, `public/text-field-engine.js`, and `public/text-field.css`. Run `node scripts/test-text-field.cjs` for deterministic placement, reading order, bounds, collision avoidance, clear areas, export scaling, contrast, and framing checks.

### Dormant feature: Motion Specimen

Motion Specimen is currently quarantined and hidden from the application. `public/feature-flags.js` is the single activation boundary: while `motionSpecimen` is `false`, its navigation and workspace remain hidden and `public/motion-specimen.js` is not loaded or initialized. Its implementation stays isolated under `motion-*` HTML/CSS/JS naming so it can be evaluated again or deleted cleanly later.

- One local video source with play/pause, timeline scrubbing, 0.25×–2× playback, optional sound, replace, and clear controls
- Source framing defaults to a centered, uncropped fit at every canvas ratio, with an optional Fill canvas treatment for intentional edge-to-edge cropping
- Point-guided selection starts directly on the canvas: click a person or object and the bundled segmentation model isolates it across sampled frames
- Lightweight frame-to-frame visual tracking advances the selected point while transparent cutouts preserve the subject's changing pose and position
- Adjustable 3–24 tracked moments across a 1–15 second passage beginning at the current playhead
- Echo Trail layers movement with temporal opacity; Strobe Stack creates a chronophotographic sequence
- Motion Grid arranges numbered moments as an editorial contact sheet; Motion Ribbon stretches subject pixels and colors along the tracked path
- Pose Type attaches editable labels, local Lucide icons, or both to head, side, center, and ground anchors derived from the selected form
- Freeze / Flow holds the environment still while the isolated subject advances through its tracked passage
- Frozen-frame, solid-field, and live-video backgrounds, plus scale up to 360%, motion spread, echo decay, position, typography, and image-derived palette controls
- Format-aware PNG export plus browser-native 3–60 second animated export with optional source audio

Animated export remains entirely in the browser. Field/Study prefers MP4 when the browser's `MediaRecorder` supports it and falls back to WebM; enabled video sound is included when the browser can capture its audio track, while GIF exports are silent. Exact format support depends on the browser and operating system.

The source-development path requires macOS 14+ and Xcode Command Line Tools; the packaged release includes the compiled helper.

## Local icon assets

The app vendors Lucide's complete static SVG set under `public/vendor/lucide/icons/` for Contour Loom's searchable icon picker. `public/vendor/lucide/manifest.json` provides display labels, search tags, asset paths, version, and license metadata without requiring a network request or runtime package.

To rebuild the manifest after updating the vendored package, run:

```bash
node scripts/build-lucide-manifest.mjs
```

See `THIRD_PARTY_NOTICES.md` and the vendored license files for acknowledgments and license terms.

Contour Loom decodes animated GIF sources locally with the vendored, MIT-licensed [omggif](https://github.com/deanm/omggif) library. See `public/vendor/omggif/LICENSE` for its license terms.

## Optional GIPHY Sticker search

Contour Loom can search GIPHY's transparent Sticker library without adding a package or putting a credential in the project source:

1. Create a beta API key in the [GIPHY Developer Dashboard](https://developers.giphy.com/dashboard/).
2. Open **Contour Loom → Source media → Transparent media**.
3. Paste the key into the one-time setup. Field/Study stores it only in that browser's local storage.

Searches run only when submitted and identical searches are cached for the current session to conserve the beta allowance. API limits depend on your GIPHY account. GIPHY requires visible “Powered by GIPHY” attribution, which remains in the media browser. GIPHY assets and API access are governed by GIPHY's terms; no GIPHY media is bundled with Field/Study.

### Editorial Collage

- Cover Stack adapts the oversized red-type and overlapping-photo reference; Detail Overlay pairs a full-cover image with a smaller contrasting frame. Both use the shared canvas settings, with a one-click 3000 × 3000 album canvas action.
- Three independent photo layers accept local JPG, PNG, and WebP files (30 MB and 48 megapixel limits). Album title and artist/edition are separately editable text layers. Original illustrated samples demonstrate both presets.
- Click or choose a layer, drag to position it, scale with the square handle, and rotate with the round handle. Arrow keys nudge; Shift gives larger steps and 15-degree rotation snaps. Layer order, visibility, and opacity are editable.
- Frame movement and photo cropping are separate modes. Fill/fit, bounded crop panning, zoom, black-and-white treatment, paper borders, and shadows are independent per photo. Type supports multiple lines, four system typefaces, spacing, alignment, color, size, and rotation.
- Paper color, composition margin, and deterministic print texture share the preview/export renderer. PNG uses the selected canvas format/resolution; JPEG renders a separate 3000 × 3000 square without changing the composition. Selection handles and missing-photo placeholders never export. This composition currently accepts still images; video remains available in Text Field and the other motion-capable tools.
- Presets retain photos and wording while restoring arrangement/style. Reset retains photos and restores Cover Stack defaults. Invalid replacements retain the prior photo; replaced/removed local URLs are released.
- Geometry regression checks: `node scripts/test-collage.cjs`. Browser-verified dragging, resizing, rotation, crop isolation, ordering, copy retention, third-image upload, failed replacement, reset, mobile/intermediate layouts, and 3000 × 3000 PNG/JPEG downloads.
