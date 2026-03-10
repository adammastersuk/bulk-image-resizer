import Pica from 'pica';
import JSZip from 'jszip';
import Smartcrop from 'smartcrop';
import { CSSProperties, ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from 'react';

type FitMode = 'contain' | 'crop';
type OutputFormat = 'original' | 'jpeg' | 'webp' | 'avif';
type ItemStatus = 'idle' | 'processing' | 'done' | 'error';
type SizePresetId = 'custom' | 'plp-square';

interface SourceImage {
  id: string;
  file: File;
  name: string;
  ext: string;
  previewUrl: string;
  dimensions: { width: number; height: number };
  manualFocalPoint?: { x: number; y: number };
  autoFocalPoint?: { x: number; y: number };
  smartCropApplied?: boolean;
  status: ItemStatus;
  error?: string;
}

interface ProcessedImage {
  itemId: string;
  index: number;
  filename: string;
  blob: Blob;
}

interface ProcessOptions {
  width: number;
  height: number;
  fitMode: FitMode;
  backgroundColor: string;
  useAutoFocal: boolean;
  format: OutputFormat;
  quality: number;
  renamePattern: string;
}

const pica = Pica();

const supportsDirectoryPicker = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

const DEFAULT_OPTIONS: ProcessOptions = {
  width: 1200,
  height: 1200,
  fitMode: 'contain',
  backgroundColor: '#ffffff',
  useAutoFocal: true,
  format: 'original',
  quality: 0.9,
  renamePattern: 'ORIGINAL-NAME-{nnn}'
};

interface SizePreset {
  id: SizePresetId;
  label: string;
  dimensions?: { width: number; height: number };
}

const SIZE_PRESETS: SizePreset[] = [
  { id: 'custom', label: 'Custom' },
  { id: 'plp-square', label: 'PLP Square (1000x1000)', dimensions: { width: 1000, height: 1000 } }
];

const PRESET_STORAGE_KEY = 'bulk-image-resizer:size-preset';
const ACCEPTED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
  'image/bmp',
  'image/tiff',
  'image/svg+xml'
]);
const ACCEPTED_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'bmp', 'tif', 'tiff', 'svg']);

function App() {
  const [images, setImages] = useState<SourceImage[]>([]);
  const [options, setOptions] = useState<ProcessOptions>(DEFAULT_OPTIONS);
  const [selectedPreset, setSelectedPreset] = useState<SizePresetId>('custom');
  const [dragOver, setDragOver] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [isProcessing, setIsProcessing] = useState(false);
  const imageUrlsRef = useRef<string[]>([]);

  const progressPct = progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);

  const canProcess = useMemo(
    () => images.length > 0 && options.width > 0 && options.height > 0 && !isProcessing,
    [images.length, options.width, options.height, isProcessing]
  );

  useEffect(() => {
    const savedPreset = localStorage.getItem(PRESET_STORAGE_KEY);
    if (savedPreset !== 'custom' && savedPreset !== 'plp-square') {
      return;
    }

    setSelectedPreset(savedPreset);
    const preset = SIZE_PRESETS.find((item) => item.id === savedPreset);
    if (preset?.dimensions) {
      setOptions((prev) => ({ ...prev, ...preset.dimensions }));
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(PRESET_STORAGE_KEY, selectedPreset);
  }, [selectedPreset]);

  useEffect(() => {
    imageUrlsRef.current = images.map((image) => image.previewUrl);
  }, [images]);

  useEffect(
    () => () => {
      imageUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    },
    []
  );

  const onPresetChange = (presetId: SizePresetId) => {
    setSelectedPreset(presetId);
    const preset = SIZE_PRESETS.find((item) => item.id === presetId);
    if (!preset?.dimensions) {
      return;
    }

    setOptions((prev) => ({ ...prev, ...preset.dimensions }));
  };

  const onDimensionChange = (dimension: 'width' | 'height', value: number) => {
    setOptions((prev) => ({ ...prev, [dimension]: value || 1 }));
    setSelectedPreset('custom');
  };

  const getImageDimensions = (file: File): Promise<{ width: number; height: number }> =>
    new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error(`Could not read dimensions for ${file.name}`));
      };
      img.src = objectUrl;
    });

  const isAcceptedImageFile = (file: File) => {
    if (ACCEPTED_IMAGE_MIME_TYPES.has(file.type)) {
      return true;
    }

    const ext = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() ?? '' : '';
    return ACCEPTED_IMAGE_EXTENSIONS.has(ext);
  };

  const addFiles = async (files: FileList | File[]) => {
    const incoming = Array.from(files).filter((f) => isAcceptedImageFile(f));
    if (!incoming.length) {
      setGlobalError('No valid images were found. Please choose common image formats (JPEG, PNG, WebP, AVIF, GIF, BMP, TIFF, SVG).');
      return;
    }

    const settledItems = await Promise.allSettled(
      incoming.map(async (file): Promise<SourceImage> => {
        const dimensions = await getImageDimensions(file);
        const ext = file.name.includes('.') ? file.name.split('.').pop() ?? 'png' : 'png';

        return {
          id: crypto.randomUUID(),
          file,
          name: file.name.replace(/\.[^/.]+$/, ''),
          ext: ext.toLowerCase(),
          previewUrl: URL.createObjectURL(file),
          dimensions,
          status: 'idle'
        };
      })
    );

    const newItems = settledItems.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
    const rejectedCount = settledItems.length - newItems.length;

    if (!newItems.length) {
      setGlobalError('Unable to load image previews. Please try different files.');
      return;
    }

    setImages((prev) => [...prev, ...newItems]);
    setGlobalError(
      rejectedCount > 0 ? `Skipped ${rejectedCount} image${rejectedCount === 1 ? '' : 's'} that could not be read.` : null
    );
  };

  const onFileInput = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files) {
      return;
    }
    await addFiles(event.target.files);
    event.target.value = '';
  };

  const onDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    if (event.dataTransfer.files) {
      await addFiles(event.dataTransfer.files);
    }
  };

  const clearAllImages = () => {
    setImages((prev) => {
      prev.forEach((image) => URL.revokeObjectURL(image.previewUrl));
      return [];
    });
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  };

  const removeImage = (id: string) => {
    setImages((prev) => {
      const toRemove = prev.find((i) => i.id === id);
      if (toRemove) URL.revokeObjectURL(toRemove.previewUrl);
      return prev.filter((i) => i.id !== id);
    });
  };

  const updateImage = (id: string, updater: (image: SourceImage) => SourceImage) => {
    setImages((prev) => prev.map((img) => (img.id === id ? updater(img) : img)));
  };

  const updateManualFocal = (id: string, x: number, y: number) => {
    updateImage(id, (img) => ({ ...img, manualFocalPoint: { x, y }, smartCropApplied: false }));
  };

  const loadImage = (file: Blob): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Could not decode image.'));
      };
      img.src = url;
    });

  const detectAutoFocalPoint = async (
    image: SourceImage,
    img: HTMLImageElement,
    cropWidth: number,
    cropHeight: number
  ): Promise<{ x: number; y: number } | null> => {
    if (!options.useAutoFocal || image.manualFocalPoint) {
      return null;
    }

    try {
      const result = await Smartcrop.crop(img, { width: cropWidth, height: cropHeight });
      return {
        x: (result.topCrop.x + result.topCrop.width / 2) / img.naturalWidth,
        y: (result.topCrop.y + result.topCrop.height / 2) / img.naturalHeight
      };
    } catch (error) {
      console.warn(`Smartcrop failed for ${image.file.name}; falling back to centered crop.`, error);
      return null;
    }
  };

  const drawCroppedSource = (
    image: SourceImage,
    img: HTMLImageElement,
    focalPoint: { x: number; y: number } | null
  ): HTMLCanvasElement => {
    const sourceCanvas = document.createElement('canvas');
    const targetRatio = options.width / options.height;

    let cropWidth = img.naturalWidth;
    let cropHeight = img.naturalHeight;

    if (img.naturalWidth / img.naturalHeight > targetRatio) {
      cropWidth = Math.round(img.naturalHeight * targetRatio);
    } else {
      cropHeight = Math.round(img.naturalWidth / targetRatio);
    }

    let centerX = img.naturalWidth / 2;
    let centerY = img.naturalHeight / 2;

    if (image.manualFocalPoint) {
      centerX = image.manualFocalPoint.x * img.naturalWidth;
      centerY = image.manualFocalPoint.y * img.naturalHeight;
    } else if (focalPoint) {
      centerX = focalPoint.x * img.naturalWidth;
      centerY = focalPoint.y * img.naturalHeight;
    }

    const x = Math.max(0, Math.min(img.naturalWidth - cropWidth, Math.round(centerX - cropWidth / 2)));
    const y = Math.max(0, Math.min(img.naturalHeight - cropHeight, Math.round(centerY - cropHeight / 2)));

    sourceCanvas.width = cropWidth;
    sourceCanvas.height = cropHeight;
    const ctx = sourceCanvas.getContext('2d');
    if (!ctx) throw new Error('Cannot access canvas context.');

    ctx.drawImage(img, x, y, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
    return sourceCanvas;
  };

  const formatToMime = (format: OutputFormat, fallbackExt: string) => {
    if (format === 'original') {
      switch (fallbackExt) {
        case 'jpg':
        case 'jpeg':
          return { mime: 'image/jpeg', ext: 'jpg' };
        case 'webp':
          return { mime: 'image/webp', ext: 'webp' };
        case 'avif':
          return { mime: 'image/avif', ext: 'avif' };
        default:
          return { mime: 'image/png', ext: 'png' };
      }
    }

    if (format === 'jpeg') return { mime: 'image/jpeg', ext: 'jpg' };
    if (format === 'webp') return { mime: 'image/webp', ext: 'webp' };
    return { mime: 'image/avif', ext: 'avif' };
  };

  const buildName = (pattern: string, originalName: string, index: number) => {
    const withOriginal = pattern.replace(/ORIGINAL-NAME/g, originalName);
    return withOriginal
      .replace(/\{n\}/g, String(index + 1))
      .replace(/\{nn\}/g, String(index + 1).padStart(2, '0'))
      .replace(/\{nnn\}/g, String(index + 1).padStart(3, '0'));
  };

  const canvasToBlob = (canvas: HTMLCanvasElement, mime: string, quality: number) =>
    new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Encoding failed for output image.'));
            return;
          }
          resolve(blob);
        },
        mime,
        quality
      );
    });

  const processImage = async (image: SourceImage, index: number): Promise<ProcessedImage> => {
    const loaded = await loadImage(image.file);
    const destinationCanvas = document.createElement('canvas');
    destinationCanvas.width = options.width;
    destinationCanvas.height = options.height;
    const ctx = destinationCanvas.getContext('2d');
    if (!ctx) throw new Error('Cannot access canvas context.');

    // Memory/performance strategy:
    // - Keep only one decoded image + one temporary canvas per task.
    // - Render directly to the final target canvas to avoid duplicate full-size copies.
    // - Explicitly clear temporary canvases once blob encoding is complete.
    let tempCanvas: HTMLCanvasElement | null = null;
    let autoFocalPoint: { x: number; y: number } | null = null;

    if (options.fitMode === 'contain') {
      ctx.fillStyle = options.backgroundColor;
      ctx.fillRect(0, 0, options.width, options.height);

      const ratio = Math.min(options.width / loaded.naturalWidth, options.height / loaded.naturalHeight);
      const drawWidth = Math.max(1, Math.round(loaded.naturalWidth * ratio));
      const drawHeight = Math.max(1, Math.round(loaded.naturalHeight * ratio));
      const x = Math.floor((options.width - drawWidth) / 2);
      const y = Math.floor((options.height - drawHeight) / 2);

      tempCanvas = document.createElement('canvas');
      tempCanvas.width = drawWidth;
      tempCanvas.height = drawHeight;
      await pica.resize(loaded, tempCanvas);
      ctx.drawImage(tempCanvas, x, y);
    } else {
      const targetRatio = options.width / options.height;
      let cropWidth = loaded.naturalWidth;
      let cropHeight = loaded.naturalHeight;

      if (loaded.naturalWidth / loaded.naturalHeight > targetRatio) {
        cropWidth = Math.round(loaded.naturalHeight * targetRatio);
      } else {
        cropHeight = Math.round(loaded.naturalWidth / targetRatio);
      }

      autoFocalPoint = await detectAutoFocalPoint(image, loaded, cropWidth, cropHeight);
      tempCanvas = drawCroppedSource(image, loaded, autoFocalPoint);
      await pica.resize(tempCanvas, destinationCanvas);
      updateImage(image.id, (current) => ({
        ...current,
        autoFocalPoint: autoFocalPoint ?? undefined,
        smartCropApplied: !current.manualFocalPoint && Boolean(autoFocalPoint)
      }));
    }

    const { mime, ext } = formatToMime(options.format, image.ext);
    const blob = await canvasToBlob(destinationCanvas, mime, options.quality);
    const filename = `${buildName(options.renamePattern, image.name, index)}.${ext}`;

    if (tempCanvas) {
      tempCanvas.width = 0;
      tempCanvas.height = 0;
    }
    destinationCanvas.width = 0;
    destinationCanvas.height = 0;

    return {
      itemId: image.id,
      index,
      filename,
      blob
    };
  };

  const runProcessing = async (saveToFolder: boolean) => {
    setGlobalError(null);
    setIsProcessing(true);

    let directoryHandle: FileSystemDirectoryHandle | undefined;
    if (saveToFolder && supportsDirectoryPicker) {
      try {
        directoryHandle = await (
          window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }
        ).showDirectoryPicker();
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          console.info('Folder selection cancelled by user.');
          setProgress({ done: 0, total: 0 });
          setIsProcessing(false);
          return;
        }

        throw error;
      }
    }

    setProgress({ done: 0, total: images.length });
    setImages((prev) =>
      prev.map((img) => ({
        ...img,
        status: 'idle',
        error: undefined,
        autoFocalPoint: options.fitMode === 'crop' ? undefined : img.autoFocalPoint,
        smartCropApplied: options.fitMode === 'crop' ? false : img.smartCropApplied
      }))
    );

    const outputs: ProcessedImage[] = [];
    const concurrencyLimit = 3;
    let currentIndex = 0;

    const worker = async () => {
      while (currentIndex < images.length) {
        const i = currentIndex;
        currentIndex += 1;
        const image = images[i];

        updateImage(image.id, (img) => ({ ...img, status: 'processing' }));

        try {
          const result = await processImage(image, i);
          outputs.push(result);

          if (directoryHandle) {
            const fileHandle = await directoryHandle.getFileHandle(result.filename, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(result.blob);
            await writable.close();
          }

          updateImage(image.id, (img) => ({ ...img, status: 'done' }));
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown processing error';
          updateImage(image.id, (img) => ({ ...img, status: 'error', error: message }));
        }

        setProgress((prev) => ({ ...prev, done: prev.done + 1 }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrencyLimit, images.length) }, () => worker()));

    if (!directoryHandle) {
      const zip = new JSZip();
      outputs
        .sort((a, b) => a.index - b.index)
        .forEach((output) => {
          zip.file(output.filename, output.blob);
        });
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'resized-images.zip';
      anchor.click();
      URL.revokeObjectURL(url);
    }

    setIsProcessing(false);
  };

  return (
    <div className="app-shell">
      <header>
        <h1>Bulk Image Resizer</h1>
        <p>Local-only ecommerce image processing. No uploads, no server, fast batch workflow.</p>
      </header>

      <section className="panel controls">
        <div className="grid">
          <label>
            Size preset
            <select value={selectedPreset} onChange={(e) => onPresetChange(e.target.value as SizePresetId)}>
              {SIZE_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Width
            <input
              type="number"
              min={1}
              value={options.width}
              onChange={(e) => onDimensionChange('width', Number(e.target.value))}
            />
          </label>

          <label>
            Height
            <input
              type="number"
              min={1}
              value={options.height}
              onChange={(e) => onDimensionChange('height', Number(e.target.value))}
            />
          </label>

          <label>
            Fit mode
            <select
              value={options.fitMode}
              onChange={(e) => setOptions((prev) => ({ ...prev, fitMode: e.target.value as FitMode }))}
            >
              <option value="contain">Contain</option>
              <option value="crop">Crop to fill</option>
            </select>
          </label>

          <label>
            Contain background
            <input
              type="color"
              value={options.backgroundColor}
              onChange={(e) => setOptions((prev) => ({ ...prev, backgroundColor: e.target.value }))}
              disabled={options.fitMode !== 'contain'}
            />
          </label>

          <label>
            Output format
            <select
              value={options.format}
              onChange={(e) => setOptions((prev) => ({ ...prev, format: e.target.value as OutputFormat }))}
            >
              <option value="original">Original</option>
              <option value="jpeg">JPEG</option>
              <option value="webp">WebP</option>
              <option value="avif">AVIF</option>
            </select>
          </label>

          <label>
            Quality ({Math.round(options.quality * 100)})
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={options.quality}
              onChange={(e) => setOptions((prev) => ({ ...prev, quality: Number(e.target.value) }))}
              disabled={options.format === 'original'}
            />
          </label>

          <label>
            Rename pattern
            <input
              type="text"
              value={options.renamePattern}
              onChange={(e) => setOptions((prev) => ({ ...prev, renamePattern: e.target.value }))}
              placeholder="ORIGINAL-NAME-{nnn}"
            />
          </label>
        </div>

        <div className="toggles">
          <label>
            <input
              type="checkbox"
              checked={options.useAutoFocal}
              onChange={(e) => setOptions((prev) => ({ ...prev, useAutoFocal: e.target.checked }))}
              disabled={options.fitMode !== 'crop'}
            />
            Auto focal crop (smartcrop)
          </label>
          <span className="hint">Pattern tokens: ORIGINAL-NAME, {'{n}'}, {'{nn}'}, {'{nnn}'}</span>
        </div>
      </section>

      <section
        className={`panel dropzone ${dragOver ? 'active' : ''}`}
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
      >
        <p>Drag & drop images here, or use file picker.</p>
        <input
          id="picker"
          type="file"
          accept=".jpg,.jpeg,.png,.webp,.avif,.gif,.bmp,.tif,.tiff,.svg,image/jpeg,image/png,image/webp,image/avif,image/gif,image/bmp,image/tiff,image/svg+xml"
          multiple
          onChange={onFileInput}
        />
        <label htmlFor="picker" className="button secondary">
          Select Images
        </label>
      </section>

      <section className="panel actions">
        <button className="button" disabled={!canProcess} onClick={() => runProcessing(false)}>
          Process + Download ZIP
        </button>
        <button
          className="button secondary"
          disabled={!canProcess || !supportsDirectoryPicker}
          onClick={() => runProcessing(true)}
        >
          Process + Save to Folder
        </button>
        <span className="hint">
          Some system folders (such as Downloads) can be blocked by browser security. Create and select a new
          export folder if needed.
        </span>
        <button className="button secondary" disabled={isProcessing || images.length === 0} onClick={clearAllImages}>
          Clear All
        </button>
        <div className="progress">
          <div className="bar" style={{ width: `${progressPct}%` }} />
        </div>
        <span>
          Progress: {progress.done}/{progress.total}
        </span>
      </section>

      {globalError && <div className="error-banner">{globalError}</div>}

      <section className="gallery">
        {images.map((image) => (
          <article key={image.id} className="card">
            <div
              className={`thumb-wrap fit-${options.fitMode}`}
              style={
                options.fitMode === 'contain'
                  ? ({ '--contain-bg': options.backgroundColor } as CSSProperties)
                  : undefined
              }
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                const x = (event.clientX - rect.left) / rect.width;
                const y = (event.clientY - rect.top) / rect.height;
                updateManualFocal(image.id, Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y)));
              }}
            >
              <img src={image.previewUrl} alt={image.name} className={`thumb thumb-${options.fitMode}`} />
              {image.smartCropApplied && options.fitMode === 'crop' && <span className="smart-indicator">Smart</span>}
              {image.autoFocalPoint && !image.manualFocalPoint && options.fitMode === 'crop' && (
                <div
                  className="focal-dot auto"
                  style={{
                    left: `${image.autoFocalPoint.x * 100}%`,
                    top: `${image.autoFocalPoint.y * 100}%`
                  }}
                />
              )}
              {image.manualFocalPoint && (
                <div
                  className="focal-dot"
                  style={{
                    left: `${image.manualFocalPoint.x * 100}%`,
                    top: `${image.manualFocalPoint.y * 100}%`
                  }}
                />
              )}
            </div>
            <div className="meta">
              <strong>{image.file.name}</strong>
              <small>
                Original: {image.dimensions.width} × {image.dimensions.height}
              </small>
              <small>Size: {formatFileSize(image.file.size)}</small>
              <small>Status: {image.status}</small>
              {image.error && <small className="error">{image.error}</small>}
            </div>
            <button className="link" onClick={() => removeImage(image.id)} disabled={isProcessing}>
              Remove
            </button>
          </article>
        ))}
      </section>
    </div>
  );
}

export default App;
