import Pica from 'pica';
import JSZip from 'jszip';
import Smartcrop from 'smartcrop';
import { ChangeEvent, DragEvent, useMemo, useState } from 'react';

type FitMode = 'contain' | 'crop';
type OutputFormat = 'original' | 'jpeg' | 'webp' | 'avif';
type ItemStatus = 'idle' | 'processing' | 'done' | 'error';

interface SourceImage {
  id: string;
  file: File;
  name: string;
  ext: string;
  previewUrl: string;
  manualFocalPoint?: { x: number; y: number };
  status: ItemStatus;
  error?: string;
}

interface ProcessedImage {
  itemId: string;
  filename: string;
  blob: Blob;
}

interface ProcessOptions {
  width: number;
  height: number;
  fitMode: FitMode;
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
  useAutoFocal: true,
  format: 'original',
  quality: 0.9,
  renamePattern: 'ORIGINAL-NAME-{nnn}'
};

function App() {
  const [images, setImages] = useState<SourceImage[]>([]);
  const [options, setOptions] = useState<ProcessOptions>(DEFAULT_OPTIONS);
  const [dragOver, setDragOver] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [isProcessing, setIsProcessing] = useState(false);

  const progressPct = progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);

  const canProcess = useMemo(
    () => images.length > 0 && options.width > 0 && options.height > 0 && !isProcessing,
    [images.length, options.width, options.height, isProcessing]
  );

  const addFiles = (files: FileList | File[]) => {
    const incoming = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (!incoming.length) {
      setGlobalError('No valid images were found. Please drop or select image files.');
      return;
    }

    const newItems = incoming.map((file) => {
      const ext = file.name.includes('.') ? file.name.split('.').pop() ?? 'png' : 'png';
      return {
        id: crypto.randomUUID(),
        file,
        name: file.name.replace(/\.[^/.]+$/, ''),
        ext: ext.toLowerCase(),
        previewUrl: URL.createObjectURL(file),
        status: 'idle' as ItemStatus
      };
    });

    setImages((prev) => [...prev, ...newItems]);
    setGlobalError(null);
  };

  const onFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files) {
      return;
    }
    addFiles(event.target.files);
    event.target.value = '';
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    if (event.dataTransfer.files) {
      addFiles(event.dataTransfer.files);
    }
  };

  const removeImage = (id: string) => {
    setImages((prev) => {
      const toRemove = prev.find((i) => i.id === id);
      if (toRemove) URL.revokeObjectURL(toRemove.previewUrl);
      return prev.filter((i) => i.id !== id);
    });
  };

  const updateManualFocal = (id: string, x: number, y: number) => {
    setImages((prev) =>
      prev.map((img) => (img.id === id ? { ...img, manualFocalPoint: { x, y } } : img))
    );
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

  const drawCroppedSource = async (image: SourceImage, img: HTMLImageElement): Promise<HTMLCanvasElement> => {
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
    } else if (options.useAutoFocal) {
      const result = await Smartcrop.crop(img, { width: cropWidth, height: cropHeight });
      centerX = result.topCrop.x + result.topCrop.width / 2;
      centerY = result.topCrop.y + result.topCrop.height / 2;
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

  const drawContainedSource = (img: HTMLImageElement): HTMLCanvasElement => {
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = img.naturalWidth;
    sourceCanvas.height = img.naturalHeight;
    const ctx = sourceCanvas.getContext('2d');
    if (!ctx) throw new Error('Cannot access canvas context.');
    ctx.drawImage(img, 0, 0);
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
    const sourceCanvas =
      options.fitMode === 'crop' ? await drawCroppedSource(image, loaded) : drawContainedSource(loaded);

    const destinationCanvas = document.createElement('canvas');
    destinationCanvas.width = options.width;
    destinationCanvas.height = options.height;

    if (options.fitMode === 'contain') {
      const ctx = destinationCanvas.getContext('2d');
      if (!ctx) throw new Error('Cannot access canvas context.');
      ctx.clearRect(0, 0, options.width, options.height);

      const ratio = Math.min(options.width / sourceCanvas.width, options.height / sourceCanvas.height);
      const drawWidth = Math.round(sourceCanvas.width * ratio);
      const drawHeight = Math.round(sourceCanvas.height * ratio);
      const x = Math.floor((options.width - drawWidth) / 2);
      const y = Math.floor((options.height - drawHeight) / 2);

      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = drawWidth;
      tempCanvas.height = drawHeight;
      await pica.resize(sourceCanvas, tempCanvas);
      ctx.drawImage(tempCanvas, x, y);
    } else {
      await pica.resize(sourceCanvas, destinationCanvas);
    }

    const { mime, ext } = formatToMime(options.format, image.ext);
    const blob = await canvasToBlob(destinationCanvas, mime, options.quality);
    const filename = `${buildName(options.renamePattern, image.name, index)}.${ext}`;

    return {
      itemId: image.id,
      filename,
      blob
    };
  };

  const runProcessing = async (saveToFolder: boolean) => {
    setGlobalError(null);
    setIsProcessing(true);
    setProgress({ done: 0, total: images.length });
    setImages((prev) => prev.map((img) => ({ ...img, status: 'idle', error: undefined })));

    let directoryHandle: FileSystemDirectoryHandle | undefined;
    if (saveToFolder && supportsDirectoryPicker) {
      directoryHandle = await (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker();
    }

    const outputs: ProcessedImage[] = [];

    for (let i = 0; i < images.length; i += 1) {
      const image = images[i];
      setImages((prev) => prev.map((img) => (img.id === image.id ? { ...img, status: 'processing' } : img)));

      try {
        const result = await processImage(image, i);
        outputs.push(result);

        if (directoryHandle) {
          const fileHandle = await directoryHandle.getFileHandle(result.filename, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(result.blob);
          await writable.close();
        }

        setImages((prev) => prev.map((img) => (img.id === image.id ? { ...img, status: 'done' } : img)));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown processing error';
        setImages((prev) =>
          prev.map((img) => (img.id === image.id ? { ...img, status: 'error', error: message } : img))
        );
      }

      setProgress((prev) => ({ ...prev, done: prev.done + 1 }));
    }

    if (!directoryHandle) {
      const zip = new JSZip();
      outputs.forEach((output) => zip.file(output.filename, output.blob));
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
            Width
            <input
              type="number"
              min={1}
              value={options.width}
              onChange={(e) => setOptions((prev) => ({ ...prev, width: Number(e.target.value) || 1 }))}
            />
          </label>

          <label>
            Height
            <input
              type="number"
              min={1}
              value={options.height}
              onChange={(e) => setOptions((prev) => ({ ...prev, height: Number(e.target.value) || 1 }))}
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
        <input id="picker" type="file" accept="image/*" multiple onChange={onFileInput} />
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
              className="thumb-wrap"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                const x = (event.clientX - rect.left) / rect.width;
                const y = (event.clientY - rect.top) / rect.height;
                updateManualFocal(image.id, Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y)));
              }}
            >
              <img src={image.previewUrl} alt={image.name} className="thumb" />
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
