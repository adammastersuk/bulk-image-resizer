# Bulk Image Resizer (Browser-Only)

A fast internal ecommerce-oriented bulk image resizer built with **React + TypeScript**.

## Features

- Drag-and-drop or file picker for multiple images
- Thumbnail preview gallery
- Batch resizing by explicit width/height
- Fit modes:
  - **Contain** (letterbox inside target size)
  - **Crop to fill** (fills target size)
- Cropping controls:
  - Optional **auto focal point** (via `smartcrop`)
  - **Manual focal override** per image by clicking on the thumbnail
- Output formats:
  - Original (maps to source type where possible)
  - JPEG
  - WebP
  - AVIF
- Quality slider for lossy output encoders
- Bulk rename patterns with tokens:
  - `ORIGINAL-NAME`
  - `{n}`, `{nn}`, `{nnn}`
- Queue/progress tracking with per-image status (idle/processing/done/error)
- Download processed files as a ZIP (`JSZip`)
- Optional save directly to a folder using File System Access API in supporting browsers
- Fully local processing in the browser (no server uploads)

## Tech stack

- React + TypeScript + Vite
- [`pica`](https://github.com/nodeca/pica) for high quality resizing
- [`smartcrop`](https://github.com/jwagner/smartcrop.js) for auto focal point detection
- [`jszip`](https://stuk.github.io/jszip/) for ZIP archive download

## Getting started

```bash
npm install
npm run dev
```

Open the app in your browser (default Vite URL).

## Build

```bash
npm run build
```

## Usage notes

1. Drop images into the dropzone.
2. Set width/height and fit mode.
3. Optionally enable auto focal crop (best for crop-to-fill mode).
4. Click a thumbnail to set a manual focal point override for that image.
5. Choose output format, quality, and filename pattern.
6. Process:
   - **Process + Download ZIP** (default)
   - **Process + Save to Folder** (if browser supports `showDirectoryPicker`)

## Rename pattern examples

- `ORIGINAL-NAME-{nnn}` → `shirt-front-001.jpg`
- `catalog-{nn}` → `catalog-01.webp`
- `ORIGINAL-NAME-{n}` → `shoe-hero-1.avif`

## Browser compatibility

- Core pipeline works in modern Chromium/Firefox/Safari builds.
- AVIF encode support depends on browser codecs.
- File System Access API (save-to-folder) is generally Chromium-based only.

## Security & privacy

All image decoding, transformation, and encoding are done client-side in your browser.
No server upload path is implemented.
