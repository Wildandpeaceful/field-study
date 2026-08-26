# Field/Study

A private, local-first editorial image studio with switchable art tools. Foreground Study uses Apple Vision on the Mac to isolate people and objects; Poetic Fragments lifts crop windows from a photograph and weaves them through an editable caption.

## Run it

Double-click `start.command`, or run:

```bash
python3 app.py
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). The first launch compiles a very small Swift helper in `work/bin`; uploads never leave the computer.

## What works

### Foreground Study

- Apple Vision foreground extraction
- One-image and two-image workflows: reuse one photograph, or upload separate subject and lower-frame images
- Original, pixel, and halftone subject treatments, with optional zero-to-disable color-step and contrast controls
- Image-derived harmonious and contrast palettes
- Three editorial layout systems
- Independent subject and photograph positioning, selectable by clicking the upper or lower canvas half
- Editable title, note, style, and palette copy
- Optional distributed word rail over the lower photo with automatic contrast
- Collapsible controls, with Subject Treatment and Image Palette open by default
- 900 × 1200 and 1350 × 1800 PNG export

### Poetic Fragments

- Editable, locally suggested poetic captions
- Three to ten crop windows woven directly into the caption
- Locked/manual or randomized crop placement
- Adjustable crop size, text scale, typeface, fragment marks, colors, and photo framing
- Drag crop windows in the lower photograph to change the fragments shown above
- Independent state when switching between tools
- 900 × 1200 and 1350 × 1800 PNG export

Requires macOS 14 or later and Xcode Command Line Tools (or Xcode).
