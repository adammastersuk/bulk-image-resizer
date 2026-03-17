import JSZip from 'jszip';
import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from 'react';

type ConvertFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'tiff' | 'bmp' | 'gif';
type FileStatus = 'ready' | 'processing' | 'done' | 'unsupported' | 'error';

interface SourceFileItem {
  id: string;
  file: File;
  name: string;
  previewUrl: string;
  dimensions: { width: number; height: number };
  status: FileStatus;
  error?: string;
  extension: string;
  sizeLabel: string;
}

interface FormatOption {
  value: ConvertFormat;
  label: string;
  extension: string;
  mimeType: string;
  qualityAdjustable: boolean;
}

const FORMAT_OPTIONS: FormatOption[] = [
  { value: 'jpeg', label: 'JPG / JPEG', extension: 'jpg', mimeType: 'image/jpeg', qualityAdjustable: true },
  { value: 'png', label: 'PNG', extension: 'png', mimeType: 'image/png', qualityAdjustable: false },
  { value: 'webp', label: 'WebP', extension: 'webp', mimeType: 'image/webp', qualityAdjustable: true },
  { value: 'avif', label: 'AVIF', extension: 'avif', mimeType: 'image/avif', qualityAdjustable: true },
  { value: 'tiff', label: 'TIFF / TIF', extension: 'tiff', mimeType: 'image/tiff', qualityAdjustable: false },
  { value: 'bmp', label: 'BMP', extension: 'bmp', mimeType: 'image/bmp', qualityAdjustable: false },
  { value: 'gif', label: 'GIF (static)', extension: 'gif', mimeType: 'image/gif', qualityAdjustable: false }
];

const ACCEPTED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
  'image/bmp',
  'image/tiff'
]);

const ACCEPTED_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif', 'tif', 'tiff', 'bmp', 'gif']);
const ACCEPTED_IMAGE =
  '.jpg,.jpeg,.png,.webp,.avif,.tif,.tiff,.bmp,.gif,image/jpeg,image/png,image/webp,image/avif,image/tiff,image/bmp,image/gif';
const supportsDirectoryPicker = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

const STATUS_LABELS: Record<FileStatus, string> = {
  ready: 'Ready',
  processing: 'Converting',
  done: 'Done',
  unsupported: 'Unsupported',
  error: 'Failed'
};

const formatBytes = (bytes: number) => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }

  return `${(kb / 1024).toFixed(2)} MB`;
};

function FileConverterTool() {
  const [files, setFiles] = useState<SourceFileItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [outputFormat, setOutputFormat] = useState<ConvertFormat>('webp');
  const [quality, setQuality] = useState(0.9);
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const urlsRef = useRef<string[]>([]);

  const canConvert = useMemo(() => files.length > 0 && !isConverting, [files.length, isConverting]);
  const progressPct = progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);
  const unsupportedCount = files.filter((file) => file.status === 'unsupported').length;
  const doneCount = files.filter((file) => file.status === 'done').length;
  const convertingCount = files.filter((file) => file.status === 'processing').length;
  const readyCount = files.filter((file) => file.status === 'ready').length;

  const supportedOutputFormats = useMemo(() => {
    if (typeof document === 'undefined') {
      return new Set<ConvertFormat>(['jpeg', 'png']);
    }

    const canvas = document.createElement('canvas');
    const supported = FORMAT_OPTIONS.filter((option) => canvas.toDataURL(option.mimeType).startsWith(`data:${option.mimeType}`)).map(
      (option) => option.value
    );

    return new Set<ConvertFormat>(supported);
  }, []);

  const availableFormatOptions = useMemo(
    () => FORMAT_OPTIONS.filter((option) => supportedOutputFormats.has(option.value)),
    [supportedOutputFormats]
  );
  const unavailableFormatLabels = useMemo(
    () => FORMAT_OPTIONS.filter((option) => !supportedOutputFormats.has(option.value)).map((option) => option.label),
    [supportedOutputFormats]
  );

  const selectedFormat = FORMAT_OPTIONS.find((option) => option.value === outputFormat) ?? FORMAT_OPTIONS[0];

  useEffect(() => {
    if (supportedOutputFormats.has(outputFormat)) {
      return;
    }

    const firstSupported = FORMAT_OPTIONS.find((option) => supportedOutputFormats.has(option.value));
    if (firstSupported) {
      setOutputFormat(firstSupported.value);
    }
  }, [outputFormat, supportedOutputFormats]);

  const revokeAllUrls = () => {
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    urlsRef.current = [];
  };

  useEffect(() => () => revokeAllUrls(), []);

  const readImageDimensions = (file: File): Promise<{ width: number; height: number }> =>
    new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error(`Could not read ${file.name}`));
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

  const addFiles = async (inputFiles: File[]) => {
    const incoming = inputFiles.filter((file) => isAcceptedImageFile(file));
    if (!incoming.length) {
      setError('Please add image files (JPG, PNG, WebP, AVIF, TIFF, BMP, GIF).');
      return;
    }

    const settled = await Promise.allSettled(
      incoming.map(async (file): Promise<SourceFileItem> => {
        const dimensions = await readImageDimensions(file);
        return {
          id: crypto.randomUUID(),
          file,
          name: file.name.replace(/\.[^/.]+$/, ''),
          previewUrl: URL.createObjectURL(file),
          dimensions,
          status: 'ready',
          extension: file.name.split('.').pop()?.toUpperCase() ?? 'Unknown',
          sizeLabel: formatBytes(file.size)
        };
      })
    );

    const loaded = settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
    const failedCount = settled.length - loaded.length;

    if (!loaded.length) {
      setError('Unable to load the selected images. Please try different files.');
      return;
    }

    setFiles((prev) => {
      const updated = [...prev, ...loaded];
      urlsRef.current = updated.map((item) => item.previewUrl);
      return updated;
    });

    setError(failedCount > 0 ? `Skipped ${failedCount} file${failedCount === 1 ? '' : 's'} that could not be read.` : null);
  };

  const onInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const list = event.target.files;
    if (!list) {
      return;
    }

    await addFiles(Array.from(list));
    event.target.value = '';
  };

  const onDrop = async (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragOver(false);
    await addFiles(Array.from(event.dataTransfer.files));
  };

  const removeFile = (id: string) => {
    setFiles((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((item) => item.id !== id);
    });
  };

  const clearAll = () => {
    revokeAllUrls();
    setFiles([]);
    setProgress({ done: 0, total: 0 });
    setError(null);
  };

  const toBlob = (canvas: HTMLCanvasElement, option: FormatOption, outputQuality: number): Promise<Blob> =>
    new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error(`${option.label} export is not supported by this browser.`));
            return;
          }
          resolve(blob);
        },
        option.mimeType,
        option.qualityAdjustable ? outputQuality : undefined
      );
    });

  const convertOne = async (item: SourceFileItem) => {
    const imageBitmap = await createImageBitmap(item.file);
    const canvas = document.createElement('canvas');
    canvas.width = imageBitmap.width;
    canvas.height = imageBitmap.height;
    const context = canvas.getContext('2d');

    if (!context) {
      imageBitmap.close();
      throw new Error('Could not create canvas context.');
    }

    context.drawImage(imageBitmap, 0, 0);
    imageBitmap.close();
    return toBlob(canvas, selectedFormat, quality);
  };

  const onConvert = async (saveToFolder: boolean) => {
    if (!canConvert) {
      return;
    }

    if (!supportedOutputFormats.has(outputFormat)) {
      setError(`${selectedFormat.label} conversion is not supported in this browser.`);
      return;
    }

    setIsConverting(true);
    setProgress({ done: 0, total: files.length });
    setError(null);

    let directoryHandle: FileSystemDirectoryHandle | undefined;
    if (saveToFolder && supportsDirectoryPicker) {
      try {
        directoryHandle = await (
          window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }
        ).showDirectoryPicker();
      } catch (directoryError) {
        if (directoryError instanceof DOMException && directoryError.name === 'AbortError') {
          setProgress({ done: 0, total: 0 });
          setIsConverting(false);
          return;
        }

        throw directoryError;
      }
    }

    const zip = new JSZip();

    for (const [index, item] of files.entries()) {
      setFiles((prev) => prev.map((current) => (current.id === item.id ? { ...current, status: 'processing', error: undefined } : current)));

      try {
        const blob = await convertOne(item);
        const filename = `${item.name}.${selectedFormat.extension}`;

        if (directoryHandle) {
          const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
        } else {
          zip.file(filename, blob);
        }

        setFiles((prev) => prev.map((current) => (current.id === item.id ? { ...current, status: 'done' } : current)));
      } catch (conversionError) {
        const message = conversionError instanceof Error ? conversionError.message : 'Unknown conversion error';
        setFiles((prev) =>
          prev.map((current) =>
            current.id === item.id
              ? { ...current, status: 'unsupported', error: `Could not convert ${current.file.name} to ${selectedFormat.label}. ${message}` }
              : current
          )
        );
      }

      setProgress({ done: index + 1, total: files.length });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    if (!directoryHandle) {
      const archiveBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(archiveBlob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `converted-${selectedFormat.extension}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
    }

    setIsConverting(false);
  };

  return (
    <>
      {error && <div className="error-banner">{error}</div>}

      <div className="workspace">
        <main className="workspace-main">
          <section className="panel converter-intro">
            <h2>Convert image files in bulk</h2>
            <p>
              Supports common ecommerce image formats and processes everything locally in the browser where possible.
            </p>
            <div className="format-chip-group">
              {FORMAT_OPTIONS.map((format) => (
                <span key={format.value} className="format-chip">
                  {format.label}
                </span>
              ))}
            </div>
          </section>

          <input id="converter-picker" type="file" accept={ACCEPTED_IMAGE} multiple onChange={onInputChange} />

          <section
            className={`panel workspace-canvas dropzone ${dragOver ? 'active' : ''} ${files.length > 0 ? 'populated' : 'empty'}`}
            onDrop={onDrop}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
          >
            <div className={`canvas-overlay ${files.length > 0 ? 'subtle' : ''}`}>
              {files.length > 0 ? (
                <>
                  <p>Drop more images anywhere in this workspace to queue them for conversion.</p>
                  <p className="status-summary">{readyCount} files ready to convert</p>
                  <p className="status-summary">Output format: {selectedFormat.label}</p>
                </>
              ) : (
                <>
                  <p>Drag and drop product images to begin.</p>
                  <p className="status-summary">Supports JPG, PNG, WebP, AVIF, TIFF, BMP, and static GIF files.</p>
                </>
              )}
              <label htmlFor="converter-picker" className="button secondary compact-picker-button">
                Select Image Files
              </label>
            </div>

            <section className="gallery">
              {files.map((item) => (
                <article key={item.id} className="card">
                  <div className="card-header">
                    <div className="tile-actions">
                      <button className="link" onClick={() => removeFile(item.id)} disabled={isConverting}>
                        Remove
                      </button>
                    </div>
                  </div>
                  <div className="thumb-wrap">
                    <img src={item.previewUrl} alt={item.file.name} className="thumb thumb-contain" />
                  </div>
                  <div className="meta">
                    <strong>{item.file.name}</strong>
                    <small className="badge-row">
                      <span className="format-badge">{item.extension}</span>
                      <span>{item.sizeLabel}</span>
                    </small>
                    <small>
                      {item.dimensions.width} × {item.dimensions.height}
                    </small>
                    <small>Status: {STATUS_LABELS[item.status]}</small>
                    {item.error && <small className="error">{item.error}</small>}
                  </div>
                </article>
              ))}
            </section>
          </section>
        </main>

        <aside className="panel controls-sidebar">
          <h2>Image Converter Controls</h2>
          <p className="hint no-top-margin">Choose output format, then convert to a ZIP or save directly into a folder.</p>

          <section className="support-panel">
            <h3>Supported formats</h3>
            <div className="format-chip-group">
              {FORMAT_OPTIONS.map((format) => (
                <span key={format.value} className="format-chip">
                  {format.label}
                </span>
              ))}
            </div>
          </section>

          <div className="grid compact-grid">
            <label>
              Output format
              <select value={outputFormat} onChange={(event) => setOutputFormat(event.target.value as ConvertFormat)}>
                {availableFormatOptions.map((format) => (
                  <option key={format.value} value={format.value}>
                    {format.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Quality ({Math.round(quality * 100)})
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={quality}
                onChange={(event) => setQuality(Number(event.target.value))}
                disabled={!selectedFormat.qualityAdjustable}
              />
            </label>
          </div>

          {unavailableFormatLabels.length > 0 && (
            <p className="hint">Unavailable in this browser: {unavailableFormatLabels.join(', ')}. Try a different browser for these outputs.</p>
          )}

          <div className="actions compact-actions">
            <button className="button" onClick={() => onConvert(false)} disabled={!canConvert || availableFormatOptions.length === 0}>
              Convert + Download ZIP
            </button>
            <button
              className="button secondary"
              onClick={() => onConvert(true)}
              disabled={!canConvert || availableFormatOptions.length === 0 || !supportsDirectoryPicker}
            >
              Convert + Save to Folder
            </button>
            <button className="button secondary" disabled={isConverting || files.length === 0} onClick={clearAll}>
              Clear All
            </button>
            <div className="progress">
              <div className="bar" style={{ width: `${progressPct}%` }} />
            </div>
            <span>
              Progress: {progress.done}/{progress.total}
            </span>
            <span>{doneCount} done · {convertingCount} converting · {unsupportedCount} unsupported</span>
          </div>

          <p className="hint">All conversion happens locally in your browser. Files are never uploaded.</p>
        </aside>
      </div>
    </>
  );
}

export default FileConverterTool;
