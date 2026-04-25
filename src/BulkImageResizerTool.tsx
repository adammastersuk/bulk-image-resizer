import Pica from 'pica';
import JSZip from 'jszip';
import Smartcrop from 'smartcrop';
import { CSSProperties, ChangeEvent, DragEvent, MouseEvent, PointerEvent, useEffect, useMemo, useRef, useState } from 'react';

type FitMode = 'contain' | 'crop';
type OutputFormat = 'original' | 'jpeg' | 'webp' | 'avif';
type ItemStatus = 'idle' | 'processing' | 'done' | 'error';
type SizePresetId = 'custom' | 'plp-square' | 'hero-landscape' | 'social-portrait';

interface SourceImage {
  id: string;
  file: File;
  name: string;
  ext: string;
  previewUrl: string;
  dimensions: { width: number; height: number };
  manualFocalPoint?: { x: number; y: number };
  manualCropOverride?: { x: number; y: number };
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

type NoticeTone = 'success' | 'info';

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
  width: 1000,
  height: 1000,
  fitMode: 'crop',
  backgroundColor: '#ffffff',
  useAutoFocal: true,
  format: 'webp',
  quality: 0.8,
  renamePattern: 'ORIGINAL-NAME-{nnn}'
};

interface SizePreset {
  id: SizePresetId;
  label: string;
  dimensions?: { width: number; height: number };
}

interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const SIZE_PRESETS: SizePreset[] = [
  { id: 'custom', label: 'Custom' },
  { id: 'plp-square', label: 'PLP Square (1000x1000)', dimensions: { width: 1000, height: 1000 } },
  { id: 'hero-landscape', label: 'Hero Landscape (1600x900)', dimensions: { width: 1600, height: 900 } },
  { id: 'social-portrait', label: 'Social Portrait (1080x1350)', dimensions: { width: 1080, height: 1350 } }
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

function BulkImageResizerTool() {
  const [images, setImages] = useState<SourceImage[]>([]);
  const [options, setOptions] = useState<ProcessOptions>(DEFAULT_OPTIONS);
  const [selectedPreset, setSelectedPreset] = useState<SizePresetId>('plp-square');
  const [dragOver, setDragOver] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [globalNotice, setGlobalNotice] = useState<{ tone: NoticeTone; message: string } | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [isProcessing, setIsProcessing] = useState(false);
  const imageUrlsRef = useRef<string[]>([]);
  const cropEditorFrameRef = useRef<HTMLDivElement | null>(null);
  const [editingImageId, setEditingImageId] = useState<string | null>(null);
  const [editorCropRect, setEditorCropRect] = useState<CropRect | null>(null);
  const [isDraggingCrop, setIsDraggingCrop] = useState(false);
  const dragStateRef = useRef<{ startX: number; startY: number; origin: CropRect } | null>(null);
  const editingImageIdRef = useRef<string | null>(null);
  const isDraggingCropRef = useRef(false);

  const progressPct = progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);

  const canProcess = useMemo(
    () => images.length > 0 && options.width > 0 && options.height > 0 && !isProcessing,
    [images.length, options.width, options.height, isProcessing]
  );

  useEffect(() => {
    const savedPreset = localStorage.getItem(PRESET_STORAGE_KEY);
    if (!SIZE_PRESETS.some((preset) => preset.id === savedPreset)) {
      return;
    }

    setSelectedPreset(savedPreset as SizePresetId);
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

  useEffect(() => {
    editingImageIdRef.current = editingImageId;
  }, [editingImageId]);

  useEffect(() => {
    isDraggingCropRef.current = isDraggingCrop;
  }, [isDraggingCrop]);

  useEffect(() => {
    const onGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        disableInlineCropEditing();
      }
    };

    const onGlobalPointerDown = (event: globalThis.PointerEvent) => {
      if (isDraggingCropRef.current) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }

      if (target.closest('.card') || target.closest('.controls-sidebar') || target.closest('.dropzone') || target.closest('.topbar')) {
        return;
      }

      disableInlineCropEditing();
    };

    window.addEventListener('keydown', onGlobalKeyDown);
    window.addEventListener('pointerdown', onGlobalPointerDown);

    return () => {
      window.removeEventListener('keydown', onGlobalKeyDown);
      window.removeEventListener('pointerdown', onGlobalPointerDown);
    };
  }, []);

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
    setGlobalError(null);
    setGlobalNotice(null);
    const existingKeys = new Set(images.map((image) => `${image.file.name}-${image.file.size}-${image.file.lastModified}`));
    const uniqueIncoming = Array.from(files).filter((file) => {
      const key = `${file.name}-${file.size}-${file.lastModified}`;
      const isDuplicate = existingKeys.has(key);
      if (!isDuplicate) {
        existingKeys.add(key);
      }
      return !isDuplicate;
    });
    const incoming = uniqueIncoming.filter((f) => isAcceptedImageFile(f));
    const duplicateCount = Array.from(files).length - uniqueIncoming.length;
    const invalidCount = uniqueIncoming.length - incoming.length;

    if (!incoming.length) {
      const reason = duplicateCount > 0 ? 'All selected files were already added.' : 'No valid images were found.';
      setGlobalError(`${reason} Please choose common image formats (JPEG, PNG, WebP, AVIF, GIF, BMP, TIFF, SVG).`);
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
    const skipped = rejectedCount + invalidCount + duplicateCount;
    if (skipped > 0) {
      setGlobalNotice({
        tone: 'info',
        message: `Added ${newItems.length} image${newItems.length === 1 ? '' : 's'}. Skipped ${skipped} file${
          skipped === 1 ? '' : 's'
        } (${duplicateCount} duplicate, ${invalidCount} unsupported, ${rejectedCount} unreadable).`
      });
      return;
    }

    setGlobalNotice({ tone: 'success', message: `Added ${newItems.length} image${newItems.length === 1 ? '' : 's'} to your batch.` });
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
    disableInlineCropEditing();
    setImages((prev) => {
      prev.forEach((image) => URL.revokeObjectURL(image.previewUrl));
      return [];
    });
    setProgress({ done: 0, total: 0 });
    setGlobalNotice({ tone: 'info', message: 'Cleared all images from the workspace.' });
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  };

  const removeImage = (id: string) => {
    if (editingImageIdRef.current === id) {
      disableInlineCropEditing();
    }
    setImages((prev) => {
      const toRemove = prev.find((i) => i.id === id);
      if (toRemove) URL.revokeObjectURL(toRemove.previewUrl);
      return prev.filter((i) => i.id !== id);
    });
  };

  const updateImage = (id: string, updater: (image: SourceImage) => SourceImage) => {
    setImages((prev) => prev.map((img) => (img.id === id ? updater(img) : img)));
  };

  const clearManualCropOverride = (id: string) => {
    updateImage(id, (img) => ({ ...img, manualCropOverride: undefined }));
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
    if (!options.useAutoFocal || image.manualFocalPoint || image.manualCropOverride) {
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
    img: HTMLImageElement,
    cropRect: CropRect
  ): HTMLCanvasElement => {
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = cropRect.width;
    sourceCanvas.height = cropRect.height;
    const ctx = sourceCanvas.getContext('2d');
    if (!ctx) throw new Error('Cannot access canvas context.');

    ctx.drawImage(
      img,
      cropRect.x,
      cropRect.y,
      cropRect.width,
      cropRect.height,
      0,
      0,
      cropRect.width,
      cropRect.height
    );
    return sourceCanvas;
  };

  const getEffectiveFocalPoint = (image: SourceImage) => image.manualFocalPoint ?? image.autoFocalPoint ?? { x: 0.5, y: 0.5 };

  const getCropRect = (sourceWidth: number, sourceHeight: number, focalPoint: { x: number; y: number }): CropRect => {
    const targetRatio = options.width / options.height;
    let cropWidth = sourceWidth;
    let cropHeight = sourceHeight;

    if (sourceWidth / sourceHeight > targetRatio) {
      cropWidth = Math.round(sourceHeight * targetRatio);
    } else {
      cropHeight = Math.round(sourceWidth / targetRatio);
    }

    const centerX = focalPoint.x * sourceWidth;
    const centerY = focalPoint.y * sourceHeight;
    const x = Math.max(0, Math.min(sourceWidth - cropWidth, Math.round(centerX - cropWidth / 2)));
    const y = Math.max(0, Math.min(sourceHeight - cropHeight, Math.round(centerY - cropHeight / 2)));

    return { x, y, width: cropWidth, height: cropHeight };
  };

  const getCropRectFromOverride = (
    sourceWidth: number,
    sourceHeight: number,
    override: { x: number; y: number }
  ): CropRect => {
    const centered = getCropRect(sourceWidth, sourceHeight, { x: 0.5, y: 0.5 });
    const maxX = sourceWidth - centered.width;
    const maxY = sourceHeight - centered.height;
    return {
      ...centered,
      x: Math.max(0, Math.min(maxX, Math.round(override.x * sourceWidth))),
      y: Math.max(0, Math.min(maxY, Math.round(override.y * sourceHeight)))
    };
  };

  const getEffectiveCropRect = (image: SourceImage, sourceWidth: number, sourceHeight: number) => {
    if (image.manualCropOverride) {
      return getCropRectFromOverride(sourceWidth, sourceHeight, image.manualCropOverride);
    }

    const focalPoint = getEffectiveFocalPoint(image);
    return getCropRect(sourceWidth, sourceHeight, focalPoint);
  };

  const enableInlineCropEditing = (image: SourceImage) => {
    if (options.fitMode !== 'crop') {
      return;
    }
    setEditingImageId(image.id);
    setEditorCropRect(getEffectiveCropRect(image, image.dimensions.width, image.dimensions.height));
  };

  const disableInlineCropEditing = () => {
    setEditingImageId(null);
    setEditorCropRect(null);
    setIsDraggingCrop(false);
    dragStateRef.current = null;
  };

  const onCropDragStart = (event: PointerEvent<HTMLDivElement>) => {
    if (!editorCropRect || !cropEditorFrameRef.current) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDraggingCrop(true);
    dragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      origin: editorCropRect
    };
  };

  const finishCropDrag = (image: SourceImage) => {
    if (!dragStateRef.current || !editorCropRect) {
      return;
    }

    setIsDraggingCrop(false);
    dragStateRef.current = null;

    updateImage(image.id, (current) => ({
      ...current,
      manualCropOverride: {
        x: editorCropRect.x / current.dimensions.width,
        y: editorCropRect.y / current.dimensions.height
      },
      smartCropApplied: false
    }));
  };

  const onCropDragMove = (event: PointerEvent<HTMLDivElement>, image: SourceImage) => {
    if (!dragStateRef.current || !cropEditorFrameRef.current) {
      return;
    }
    const frameRect = cropEditorFrameRef.current.getBoundingClientRect();
    if (!frameRect.width || !frameRect.height) {
      return;
    }

    const dx = event.clientX - dragStateRef.current.startX;
    const dy = event.clientY - dragStateRef.current.startY;

    const sourceDeltaX = (dx / frameRect.width) * dragStateRef.current.origin.width;
    const sourceDeltaY = (dy / frameRect.height) * dragStateRef.current.origin.height;
    const maxX = image.dimensions.width - dragStateRef.current.origin.width;
    const maxY = image.dimensions.height - dragStateRef.current.origin.height;

    setEditorCropRect({
      ...dragStateRef.current.origin,
      x: Math.max(0, Math.min(maxX, Math.round(dragStateRef.current.origin.x - sourceDeltaX))),
      y: Math.max(0, Math.min(maxY, Math.round(dragStateRef.current.origin.y - sourceDeltaY)))
    });
  };

  const onCropDragEnd = (event: PointerEvent<HTMLDivElement>, image: SourceImage) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    finishCropDrag(image);
  };

  const onCropMouseDragEnd = (event: MouseEvent<HTMLDivElement>, image: SourceImage) => {
    event.preventDefault();
    finishCropDrag(image);
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
    const basePattern = pattern.trim() || 'ORIGINAL-NAME-{nnn}';
    const withOriginal = basePattern.replace(/ORIGINAL-NAME/g, originalName);
    const resolved = withOriginal
      .replace(/\{n\}/g, String(index + 1))
      .replace(/\{nn\}/g, String(index + 1).padStart(2, '0'))
      .replace(/\{nnn\}/g, String(index + 1).padStart(3, '0'));
    const sanitized = resolved.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').replace(/\s+/g, ' ').trim();
    return sanitized || `image-${String(index + 1).padStart(3, '0')}`;
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
      const initialCrop = getCropRect(loaded.naturalWidth, loaded.naturalHeight, { x: 0.5, y: 0.5 });
      autoFocalPoint = await detectAutoFocalPoint(image, loaded, initialCrop.width, initialCrop.height);
      const cropRect = image.manualCropOverride
        ? getCropRectFromOverride(loaded.naturalWidth, loaded.naturalHeight, image.manualCropOverride)
        : getCropRect(loaded.naturalWidth, loaded.naturalHeight, image.manualFocalPoint ?? autoFocalPoint ?? { x: 0.5, y: 0.5 });

      tempCanvas = drawCroppedSource(loaded, cropRect);
      await pica.resize(tempCanvas, destinationCanvas);
      updateImage(image.id, (current) => ({
        ...current,
        autoFocalPoint: autoFocalPoint ?? undefined,
        smartCropApplied: !current.manualFocalPoint && !current.manualCropOverride && Boolean(autoFocalPoint)
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
    setGlobalNotice(null);
    setIsProcessing(true);
    try {
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
            setGlobalNotice({ tone: 'info', message: 'Folder selection cancelled. No files were processed.' });
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
      const usedFilenames = new Set<string>();

      const worker = async () => {
        while (currentIndex < images.length) {
          const i = currentIndex;
          currentIndex += 1;
          const image = images[i];

          updateImage(image.id, (img) => ({ ...img, status: 'processing' }));

          try {
            const result = await processImage(image, i);
            const lastDotIndex = result.filename.lastIndexOf('.');
            const baseName = lastDotIndex > 0 ? result.filename.slice(0, lastDotIndex) : result.filename;
            const ext = lastDotIndex > 0 ? result.filename.slice(lastDotIndex + 1) : 'png';
            let filename = `${baseName}.${ext}`;
            let sequence = 1;
            while (usedFilenames.has(filename.toLowerCase())) {
              filename = `${baseName}-${String(sequence).padStart(2, '0')}.${ext}`;
              sequence += 1;
            }
            usedFilenames.add(filename.toLowerCase());
            outputs.push({ ...result, filename });

            if (directoryHandle) {
              const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
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

      const failedCount = images.length - outputs.length;
      if (outputs.length > 0) {
        setGlobalNotice({
          tone: failedCount === 0 ? 'success' : 'info',
          message: `Processed ${outputs.length}/${images.length} image${images.length === 1 ? '' : 's'}${
            failedCount > 0 ? ` (${failedCount} failed)` : ''
          }. ${directoryHandle ? 'Saved to selected folder.' : 'ZIP download started.'}`
        });
      } else {
        setGlobalError('No files were exported. Please review per-image errors and try again.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected processing error.';
      setGlobalError(`Processing stopped: ${message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const failedCount = images.filter((image) => image.status === 'error').length;
  const doneCount = images.filter((image) => image.status === 'done').length;

  return (
    <div className="tool-shell">
      <header className="topbar">
        <div>
          <h1>Bulk Image Resizer</h1>
          <p>Local-only ecommerce image processing. No uploads, no server, fast batch workflow.</p>
        </div>
        <label htmlFor="picker" className="button secondary">
          Add Images
        </label>
      </header>

      {globalError && <div className="error-banner" role="alert">{globalError}</div>}
      {globalNotice && <div className={`notice-banner ${globalNotice.tone}`}>{globalNotice.message}</div>}

      <div className="workspace">
        <main className="workspace-main">
          <input
            id="picker"
            type="file"
            accept=".jpg,.jpeg,.png,.webp,.avif,.gif,.bmp,.tif,.tiff,.svg,image/jpeg,image/png,image/webp,image/avif,image/gif,image/bmp,image/tiff,image/svg+xml"
            multiple
            onChange={onFileInput}
          />

          <section
            className={`panel workspace-canvas dropzone ${dragOver ? 'active' : ''} ${images.length > 0 ? 'populated' : 'empty'}`}
            onDrop={onDrop}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            aria-label="Image upload dropzone"
          >
            <div className={`canvas-overlay ${images.length > 0 ? 'subtle' : ''}`}>
              <p>
                {images.length > 0
                  ? 'Drop more images anywhere in the workspace canvas to add to your batch.'
                  : 'Drag & drop images to begin your workspace.'}
              </p>
              <label htmlFor="picker" className="button secondary compact-picker-button">
                Select Images
              </label>
            </div>

            {images.length > 0 && options.fitMode === 'crop' && (
              <p className="workspace-instruction hint">Click a tile, then drag to adjust crop inline.</p>
            )}

            <section className="gallery">
              {images.map((image) => {
              const focal = getEffectiveFocalPoint(image);
              const cropRect = image.manualCropOverride
                ? getCropRectFromOverride(image.dimensions.width, image.dimensions.height, image.manualCropOverride)
                : getCropRect(image.dimensions.width, image.dimensions.height, focal);
              const previewRect = editingImageId === image.id && editorCropRect ? editorCropRect : cropRect;
              const cropPreviewStyle: CSSProperties = {
                width: `${(image.dimensions.width / previewRect.width) * 100}%`,
                height: `${(image.dimensions.height / previewRect.height) * 100}%`,
                left: `${(-previewRect.x / previewRect.width) * 100}%`,
                top: `${(-previewRect.y / previewRect.height) * 100}%`
              };
              const isInlineEditing = options.fitMode === 'crop' && editingImageId === image.id;

              return (
                <article key={image.id} className={`card ${isInlineEditing ? 'editing' : ''}`}>
                  <div className="card-header">
                    <div className="tile-actions">
                      <button
                        className="link"
                        onClick={(event) => {
                          event.stopPropagation();
                          removeImage(image.id);
                        }}
                        disabled={isProcessing}
                        type="button"
                      >
                        Remove
                      </button>
                      {image.manualCropOverride && options.fitMode === 'crop' && (
                        <button
                          className="link"
                          onClick={(event) => {
                            event.stopPropagation();
                            clearManualCropOverride(image.id);
                            if (editingImageId === image.id) {
                              setEditorCropRect(getCropRect(image.dimensions.width, image.dimensions.height, getEffectiveFocalPoint(image)));
                            }
                          }}
                          disabled={isProcessing}
                          type="button"
                        >
                          Reset crop
                        </button>
                      )}
                    </div>
                  </div>

                  <div
                    ref={isInlineEditing ? cropEditorFrameRef : null}
                    className={`thumb-wrap fit-${options.fitMode} ${isInlineEditing ? 'inline-editing' : ''}`}
                    style={
                      {
                        '--contain-bg': options.backgroundColor,
                        aspectRatio: `${options.width} / ${options.height}`
                      } as CSSProperties
                    }
                    onClick={() => {
                      if (options.fitMode === 'crop') {
                        enableInlineCropEditing(image);
                      }
                    }}
                  >
                    {options.fitMode === 'contain' ? (
                      <img src={image.previewUrl} alt={image.name} className="thumb thumb-contain" />
                    ) : (
                      <img
                        src={image.previewUrl}
                        alt={image.name}
                        className={`thumb thumb-crop-exact ${isDraggingCrop && isInlineEditing ? 'dragging' : ''}`}
                        style={cropPreviewStyle}
                        draggable={false}
                      />
                    )}

                    {options.fitMode === 'crop' && !isInlineEditing && (
                      <span className="inline-hint">Click and drag to adjust crop</span>
                    )}
                    {isInlineEditing && <span className="inline-hint active">Dragging updates crop instantly</span>}

                    {image.manualCropOverride && options.fitMode === 'crop' && <span className="manual-indicator">Manual</span>}
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

                    {isInlineEditing && (
                      <div
                        className="crop-drag-surface"
                        onPointerDown={(event) => {
                          if (isProcessing) {
                            return;
                          }
                          onCropDragStart(event);
                        }}
                        onPointerMove={(event) => {
                          if (isProcessing) {
                            return;
                          }
                          onCropDragMove(event, image);
                        }}
                        onPointerUp={(event) => {
                          if (isProcessing) {
                            return;
                          }
                          onCropDragEnd(event, image);
                        }}
                        onPointerCancel={(event) => {
                          if (isProcessing) {
                            return;
                          }
                          onCropDragEnd(event, image);
                        }}
                        onPointerLeave={(event) => {
                          if (isProcessing) {
                            return;
                          }
                          onCropDragEnd(event, image);
                        }}
                        onMouseUp={(event) => {
                          if (isProcessing) {
                            return;
                          }
                          onCropMouseDragEnd(event, image);
                        }}
                        onMouseLeave={(event) => {
                          if (isProcessing) {
                            return;
                          }
                          onCropMouseDragEnd(event, image);
                        }}
                      />
                    )}
                  </div>

                  <div className="meta">
                    <strong>{image.file.name}</strong>
                    <small>
                      {image.dimensions.width} × {image.dimensions.height} • {formatFileSize(image.file.size)}
                    </small>
                    <small>Status: {image.status}</small>
                    {image.error && <small className="error">{image.error}</small>}
                  </div>
                </article>
              );
              })}
            </section>
          </section>
        </main>

        <aside className="panel controls-sidebar">
          <h2>Output Controls</h2>
          <div className="grid compact-grid">
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
                onChange={(e) => {
                  setOptions((prev) => ({ ...prev, fitMode: e.target.value as FitMode }));
                  disableInlineCropEditing();
                }}
              >
                <option value="crop">Crop to fill</option>
                <option value="contain">Fit inside</option>
              </select>
            </label>

            {options.fitMode === 'contain' && (
              <label>
                Contain background
                <div className="contain-bg-control">
                  <select
                    value={options.backgroundColor}
                    onChange={(e) => setOptions((prev) => ({ ...prev, backgroundColor: e.target.value }))}
                  >
                    <option value="#ffffff">White</option>
                    <option value="transparent">Transparent</option>
                    <option value="#000000">Black</option>
                  </select>
                  <span
                    className={`bg-swatch ${options.backgroundColor === 'transparent' ? 'transparent' : ''}`}
                    style={options.backgroundColor === 'transparent' ? undefined : { backgroundColor: options.backgroundColor }}
                  />
                </div>
              </label>
            )}

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
              Quality ({Math.round(options.quality * 100)}%)
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

            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={options.useAutoFocal}
                onChange={(e) => setOptions((prev) => ({ ...prev, useAutoFocal: e.target.checked }))}
                disabled={options.fitMode !== 'crop'}
              />
              Auto focal crop
            </label>
          </div>

          <div className="actions compact-actions">
            <button className="button" disabled={!canProcess} onClick={() => runProcessing(false)} type="button">
              Process + Download ZIP
            </button>
            <button
              className="button secondary"
              disabled={!canProcess || !supportsDirectoryPicker}
              onClick={() => runProcessing(true)}
              type="button"
            >
              Process + Save to Folder
            </button>
            <button className="button secondary" disabled={isProcessing || images.length === 0} onClick={clearAllImages} type="button">
              Clear All
            </button>
            <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPct}>
              <div className="bar" style={{ width: `${progressPct}%` }} />
            </div>
            <span aria-live="polite">
              Progress: {progress.done}/{progress.total} ({progressPct}%)
            </span>
            <span className="status-summary">
              Queue: {images.length} total · {doneCount} done · {failedCount} failed
            </span>
          </div>

          <p className="hint">Pattern tokens: ORIGINAL-NAME, {'{n}'}, {'{nn}'}, {'{nnn}'}</p>
          <p className="hint">Crop to fill trims overflow. Fit inside preserves full image and can add background.</p>
        </aside>
      </div>
    </div>
  );
}

export default BulkImageResizerTool;
