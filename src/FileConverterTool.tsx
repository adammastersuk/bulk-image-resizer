import JSZip from 'jszip';
import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from 'react';

type ConvertFormat = 'jpeg' | 'png' | 'webp' | 'avif';
type FileStatus = 'idle' | 'processing' | 'done' | 'error';

interface SourceFileItem {
  id: string;
  file: File;
  name: string;
  previewUrl: string;
  dimensions: { width: number; height: number };
  status: FileStatus;
  error?: string;
}

const ACCEPTED_IMAGE = '.jpg,.jpeg,.png,.webp,.avif,image/jpeg,image/png,image/webp,image/avif';

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
  const supportsAvif = useMemo(() => {
    if (typeof document === 'undefined') {
      return false;
    }

    const canvas = document.createElement('canvas');
    return canvas.toDataURL('image/avif').startsWith('data:image/avif');
  }, []);

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

  const addFiles = async (inputFiles: File[]) => {
    const incoming = inputFiles.filter((file) => file.type.startsWith('image/'));
    if (!incoming.length) {
      setError('Please add image files (JPG, PNG, WebP, AVIF).');
      return;
    }

    const next = await Promise.all(
      incoming.map(async (file) => {
        const dimensions = await readImageDimensions(file);
        return {
          id: crypto.randomUUID(),
          file,
          name: file.name.replace(/\.[^/.]+$/, ''),
          previewUrl: URL.createObjectURL(file),
          dimensions,
          status: 'idle' as const
        };
      })
    );

    setFiles((prev) => {
      const updated = [...prev, ...next];
      urlsRef.current = updated.map((item) => item.previewUrl);
      return updated;
    });
    setError(null);
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
    setFiles((prev) => prev.filter((item) => item.id !== id));
  };

  const clearAll = () => {
    revokeAllUrls();
    setFiles([]);
    setProgress({ done: 0, total: 0 });
    setError(null);
  };

  const extForFormat = (format: ConvertFormat) => (format === 'jpeg' ? 'jpg' : format);

  const toBlob = (canvas: HTMLCanvasElement, format: ConvertFormat, outputQuality: number): Promise<Blob> =>
    new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Browser conversion failed for this file.'));
            return;
          }
          resolve(blob);
        },
        `image/${format}`,
        format === 'png' ? undefined : outputQuality
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
    return toBlob(canvas, outputFormat, quality);
  };

  const onConvert = async () => {
    if (!canConvert) {
      return;
    }

    setIsConverting(true);
    setProgress({ done: 0, total: files.length });
    setError(null);

    const zip = new JSZip();

    for (const [index, item] of files.entries()) {
      setFiles((prev) => prev.map((current) => (current.id === item.id ? { ...current, status: 'processing', error: undefined } : current)));

      try {
        const blob = await convertOne(item);
        zip.file(`${item.name}.${extForFormat(outputFormat)}`, blob);
        setFiles((prev) => prev.map((current) => (current.id === item.id ? { ...current, status: 'done' } : current)));
      } catch (conversionError) {
        const message = conversionError instanceof Error ? conversionError.message : 'Unknown conversion error';
        setFiles((prev) =>
          prev.map((current) => (current.id === item.id ? { ...current, status: 'error', error: message } : current))
        );
      }

      setProgress({ done: index + 1, total: files.length });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const archiveBlob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(archiveBlob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `converted-${outputFormat}.zip`;
    anchor.click();
    URL.revokeObjectURL(url);

    setIsConverting(false);
  };

  return (
    <>
      {error && <div className="error-banner">{error}</div>}

      <div className="workspace">
        <main className="workspace-main">
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
              <p>
                {files.length > 0
                  ? 'Drop more images anywhere in this workspace to queue them for conversion.'
                  : 'Drag & drop images to start converting files.'}
              </p>
              <label htmlFor="converter-picker" className="button secondary compact-picker-button">
                Select Files
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
                    <small>
                      {item.dimensions.width} × {item.dimensions.height}
                    </small>
                    <small>Status: {item.status}</small>
                    {item.error && <small className="error">{item.error}</small>}
                  </div>
                </article>
              ))}
            </section>
          </section>
        </main>

        <aside className="panel controls-sidebar">
          <h2>Converter Controls</h2>
          <div className="grid compact-grid">
            <label>
              Output format
              <select value={outputFormat} onChange={(event) => setOutputFormat(event.target.value as ConvertFormat)}>
                <option value="jpeg">JPG / JPEG</option>
                <option value="png">PNG</option>
                <option value="webp">WebP</option>
                <option value="avif" disabled={!supportsAvif}>
                  AVIF {!supportsAvif ? '(Not supported in this browser)' : ''}
                </option>
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
                disabled={outputFormat === 'png'}
              />
            </label>
          </div>

          <div className="actions compact-actions">
            <button className="button" onClick={onConvert} disabled={!canConvert}>
              Convert + Download ZIP
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
          </div>

          <p className="hint">All conversion happens locally in your browser. Files are never uploaded.</p>
        </aside>
      </div>
    </>
  );
}

export default FileConverterTool;
