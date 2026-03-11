import { ChangeEvent, DragEvent, useMemo, useState } from 'react';
import {
  DOCUMENT_FORMAT_OPTIONS,
  DocumentOutputFormat,
  SUPPORTED_DOCUMENT_PICKER_TYPES,
  getDocumentFormatByFileName
} from './documentConverterCapabilities';

type DocumentFileStatus = 'ready' | 'server-required' | 'coming-soon' | 'unsupported';

interface DocumentFileItem {
  id: string;
  file: File;
  status: DocumentFileStatus;
  message: string;
  formatLabel: string;
  extension: string;
  sizeLabel: string;
}

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

const STATUS_LABELS: Record<DocumentFileStatus, string> = {
  ready: 'Ready',
  'server-required': 'Server-powered',
  'coming-soon': 'Coming soon',
  unsupported: 'Unsupported'
};

function DocumentConverterTool() {
  const [files, setFiles] = useState<DocumentFileItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [outputFormat, setOutputFormat] = useState<DocumentOutputFormat>('pdf');
  const [error, setError] = useState<string | null>(null);

  const serverReadyCount = files.filter((file) => file.status === 'server-required').length;
  const unsupportedCount = files.filter((file) => file.status === 'unsupported').length;
  const canPrepareConversion = useMemo(() => serverReadyCount > 0, [serverReadyCount]);

  const addFiles = (incomingFiles: File[]) => {
    if (!incomingFiles.length) {
      return;
    }

    const nextFiles = incomingFiles.map((file): DocumentFileItem => {
      const format = getDocumentFormatByFileName(file.name);
      const extension = file.name.split('.').pop()?.toUpperCase() ?? 'Unknown';

      if (!format) {
        return {
          id: crypto.randomUUID(),
          file,
          status: 'unsupported',
          formatLabel: 'Unknown format',
          extension,
          sizeLabel: formatBytes(file.size),
          message: 'This file type is not supported. Please upload DOC, DOCX, PPT, PPTX, XLS, XLSX, or PUB files.'
        };
      }

      return {
        id: crypto.randomUUID(),
        file,
        status: format.availability === 'server' ? 'server-required' : 'ready',
        formatLabel: format.label,
        extension,
        sizeLabel: formatBytes(file.size),
        message: format.statusMessage
      };
    });

    setFiles((prev) => [...prev, ...nextFiles]);
    setError(null);
  };

  const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files) {
      return;
    }

    addFiles(Array.from(event.target.files));
    event.target.value = '';
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragOver(false);
    addFiles(Array.from(event.dataTransfer.files));
  };

  const clearAll = () => {
    setFiles([]);
    setError(null);
  };

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((file) => file.id !== id));
  };

  const onPrepareConversion = () => {
    if (!canPrepareConversion) {
      setError('Add supported office document files to continue.');
      return;
    }

    setError(
      'Conversion execution is not enabled in this app yet. These recognized files are marked as server-powered and require a backend conversion endpoint.'
    );
  };

  return (
    <>
      {error && <div className="error-banner">{error}</div>}

      <div className="workspace">
        <main className="workspace-main">
          <section className="panel converter-intro">
            <h2>Convert supported document types to PDF</h2>
            <p>Some document types may require server-side conversion depending on availability.</p>
          </section>

          <input id="document-picker" type="file" accept={SUPPORTED_DOCUMENT_PICKER_TYPES} multiple onChange={onInputChange} />

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
                  <p>Drop more documents anywhere in this workspace to queue them for conversion.</p>
                  <p className="status-summary">{serverReadyCount} files ready for server-powered conversion</p>
                  <p className="status-summary">{unsupportedCount} unsupported files</p>
                </>
              ) : (
                <>
                  <p>Drag and drop office documents to prepare a PDF conversion batch.</p>
                  <p className="status-summary">Supported inputs: DOC, DOCX, PPT, PPTX, XLS, XLSX, and PUB.</p>
                </>
              )}
              <label htmlFor="document-picker" className="button secondary compact-picker-button">
                Select Document Files
              </label>
            </div>

            <section className="gallery document-gallery">
              {files.map((item) => (
                <article key={item.id} className="card document-card">
                  <div className="card-header">
                    <div className="tile-actions">
                      <button className="link" onClick={() => removeFile(item.id)} type="button">
                        Remove
                      </button>
                    </div>
                  </div>
                  <div className="meta">
                    <strong>{item.file.name}</strong>
                    <small className="badge-row">
                      <span className="format-badge">{item.extension}</span>
                      <span>{item.sizeLabel}</span>
                    </small>
                    <small>{item.formatLabel}</small>
                    <small className={item.status === 'unsupported' ? 'error' : 'status-pill'}>Status: {STATUS_LABELS[item.status]}</small>
                    <small>{item.message}</small>
                  </div>
                </article>
              ))}
            </section>
          </section>
        </main>

        <aside className="panel controls-sidebar">
          <h2>Document Converter Controls</h2>
          <p className="hint no-top-margin">Review support details, upload documents, then convert supported files to PDF.</p>

          <section className="support-panel">
            <h3>Supported document types</h3>
            <div className="support-list">
              <div className="support-item">
                <span>Word: DOC, DOCX</span>
                <span className="status-tag server">Server-powered</span>
              </div>
              <div className="support-item">
                <span>PowerPoint: PPT, PPTX</span>
                <span className="status-tag server">Server-powered</span>
              </div>
              <div className="support-item">
                <span>Excel: XLS, XLSX</span>
                <span className="status-tag server">Server-powered</span>
              </div>
              <div className="support-item">
                <span>Publisher: PUB</span>
                <span className="status-tag coming">Coming soon</span>
              </div>
              <div className="support-item">
                <span>PDF tools: Merge, Compress</span>
                <span className="status-tag coming">Coming soon</span>
              </div>
            </div>
          </section>

          <section className="summary-panel">
            <h3>Conversion summary</h3>
            <ul>
              <li>Supported inputs: DOC, DOCX, PPT, PPTX, XLS, XLSX, PUB</li>
              <li>Target output: PDF</li>
              <li>Current limitation: recognized formats need server-side conversion for reliable output</li>
            </ul>
          </section>

          <div className="grid compact-grid">
            <label>
              Output format
              <select value={outputFormat} onChange={(event) => setOutputFormat(event.target.value as DocumentOutputFormat)}>
                <option value="pdf">PDF (primary output)</option>
              </select>
            </label>
          </div>

          <div className="actions compact-actions">
            <button className="button" onClick={onPrepareConversion} type="button">
              Convert supported files to PDF
            </button>
            <button className="button secondary" onClick={clearAll} disabled={files.length === 0} type="button">
              Clear All
            </button>
            <span>{serverReadyCount} ready · {unsupportedCount} unsupported</span>
          </div>

          <ul className="hint capability-list">
            {DOCUMENT_FORMAT_OPTIONS.map((option) => (
              <li key={option.id}>
                {option.label} → PDF: {option.availability === 'server' ? 'Server-powered' : 'Available now'}
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </>
  );
}

export default DocumentConverterTool;
