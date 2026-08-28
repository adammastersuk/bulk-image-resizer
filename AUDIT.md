# Bulk image resizer audit

## Baseline

The resizer is a browser-only React/TypeScript/Vite application. It imports multiple local files through a file picker or drag and drop, reads dimensions with the browser image decoder, and uses `pica` to resize canvas content. Exact output canvases use either Smartcrop-assisted/manual cover cropping or centred contain padding. JPEG, PNG, WebP and AVIF sources are preserved where possible; other decodable inputs become PNG when “Original” is selected. Lossy quality is configurable. Token-based names are sanitised and collisions receive a numeric suffix. A three-task worker pool isolates per-file failures, then exports a ZIP with JSZip or writes through the File System Access API. Object URLs and temporary canvases are cleaned up. There is no upload or server storage.

The existing flow was already strong: multi-file upload, previews, source dimensions and sizes, per-file removal, clear-all, crop adjustment, presets, progress, per-file errors, collision handling and partial-batch completion were all present.

## Improvement plan

### High priority

- Bound source/output memory usage and reject unsafe dimensions before canvas allocation.
- Detect browser encoder fallback instead of silently giving a file the wrong extension.
- Avoid producing an empty ZIP when every item fails.
- Make batch size, expected output dimensions, and output byte totals visible.

### Useful improvement

- Add explicit PNG conversion alongside preserve/JPEG/WebP/AVIF.
- Allow arbitrary padding colours and clearly handle JPEG's lack of transparency.
- Remember the complete output configuration, not only the preset.
- Delay ZIP object-URL cleanup so browsers have time to begin the download.

### Nice to have

- Width-only, height-only, percentage, and no-upscale modes.
- Retain processed blobs temporarily for individual re-downloads.
- Optional filename case/space controls beyond the existing rename tokens.
- Automated browser fixtures covering codec-specific output pixels.

### Not recommended

- Server uploads or third-party processing: these would weaken the current privacy model.
- Automatic blank-space trimming: reliable edge/background inference needs product-specific controls and could remove legitimate light or transparent details.
- Raising concurrency indiscriminately: parallel decoding of very large source images can increase browser memory failures.
- Adding stretch mode as a prominent default: the current crop/contain choices prevent silent distortion.
