# Bulk Image Resizer (Browser-Only)

A fast internal ecommerce-oriented bulk image resizer built with **React + TypeScript**.

## Features

- Drag-and-drop or file picker for multiple images
- Preview gallery that mirrors the final exported composition (crop area or fit-inside letterboxing)
- Batch resizing by explicit width/height
- Reusable size presets (includes **Custom** and **PLP Square (1000x1000)**)
- Fit modes:
  - **Crop to fill (fills the size and trims overflow)** always fills the target dimensions exactly, trimming edges when needed and using smart/manual focal points.
  - **Fit inside (shows the whole image)** keeps the full image visible inside the target size and can add background space (white, transparent, or black).
- Default fit mode is **Crop to fill** for ecommerce-first prep workflows.
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
- Efficient large-batch processing with a small worker pool (chunked concurrency) to keep memory and UI responsiveness stable
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
2. Choose a size preset (or leave on **Custom**), then adjust width/height and fit mode.
3. **Crop to fill** is the default and is best when you need the export frame fully filled (edges may be trimmed).
4. Switch to **Fit inside** to preserve the full image and choose a letterbox background (white, transparent, or black).
5. For **Crop to fill**, optionally enable auto focal crop (Smartcrop) to suggest a focal point.
6. Click a preview card to set a manual focal point override for that image (manual override always wins over auto focal).
7. Choose output format, quality, and filename pattern.
8. Process:
   - **Process + Download ZIP** (default)
   - **Process + Save to Folder** (if browser supports `showDirectoryPicker`)

## Rename pattern examples

- `ORIGINAL-NAME-{nnn}` → `shirt-front-001.jpg`
- `catalog-{nn}` → `catalog-01.webp`
- `ORIGINAL-NAME-{n}` → `shoe-hero-1.avif`

### Size presets

- Select **PLP Square (1000x1000)** to auto-fill the width/height fields for common ecommerce product listing needs.
- Select **Custom** for manual dimensions.
- If you manually edit width or height, the preset automatically switches back to **Custom**.
- The last selected preset is persisted in `localStorage` and restored on next visit.
- Presets only control dimensions; **Fit mode** remains independent.

## Browser compatibility

- Core pipeline works in modern Chromium/Firefox/Safari builds.
- AVIF encode support depends on browser codecs.
- File System Access API (save-to-folder) is generally Chromium-based only.

## Security & privacy

All image decoding, transformation, and encoding are done client-side in your browser.
No server upload path is implemented.
