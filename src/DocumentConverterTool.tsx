import { ChangeEvent, DragEvent, useMemo, useState } from 'react';
import {
  DOCUMENT_FORMAT_OPTIONS,
  DocumentOutputFormat,
  SUPPORTED_DOCUMENT_PICKER_TYPES,
  getDocumentFormatByFileName
} from './documentConverterCapabilities';

type DocumentFileStatus = 'queued' | 'server-required' | 'unsupported';

interface DocumentFileItem {
  id: string;
  file: File;
  status: DocumentFileStatus;
  message: string;
  formatLabel: string;
}

function DocumentConverterTool() {
  const [files, setFiles] = useState<DocumentFileItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [outputFormat, setOutputFormat] = useState<DocumentOutputFormat>('pdf');
  const [error, setError] = useState<string | null>(null);

  const canPrepareConversion = useMemo(
    () => files.some((file) => file.status === 'server-required'),
    [files]
  );

  const addFiles = (incomingFiles: File[]) => {
    if (!incomingFiles.length) {
      return;
    }

    const nextFiles = incomingFiles.map((file): DocumentFileItem => {
      const format = getDocumentFormatByFileName(file.name);

      if (!format) {
        return {
          id: crypto.randomUUID(),
          file,
          status: 'unsupported',
          formatLabel: 'Unknown format',
          message: 'This file type is not in the current roadmap for document conversion.'
        };
      }

      return {
        id: crypto.randomUUID(),
        file,
        status: format.availability === 'server' ? 'server-required' : 'queued',
        formatLabel: format.label,
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
      'Conversion execution is not available in-browser for these formats yet. Connect a server conversion endpoint in a future update.'
    );
  };

  return (
    <>
      {error && <div className="error-banner">{error}</div>}

      <div className="workspace">
        <main className="workspace-main">
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
              <p>
                {files.length > 0
                  ? 'Drop more documents anywhere in this workspace to queue them for conversion.'
                  : 'Drag & drop documents to start building a PDF conversion batch.'}
              </p>
              <label htmlFor="document-picker" className="button secondary compact-picker-button">
                Select Documents
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
                    <small>{item.formatLabel}</small>
                    <small>Size: {(item.file.size / 1024 / 1024).toFixed(2)} MB</small>
                    <small className={item.status === 'unsupported' ? 'error' : 'status-pill'}>
                      {item.status === 'unsupported' ? 'Unsupported in roadmap' : 'Server processing required'}
                    </small>
                    <small>{item.message}</small>
                  </div>
                </article>
              ))}
            </section>
          </section>
        </main>

        <aside className="panel controls-sidebar">
          <h2>Document Converter Controls</h2>
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
              Prepare Conversion Batch
            </button>
            <button className="button secondary" onClick={clearAll} disabled={files.length === 0} type="button">
              Clear All
            </button>
          </div>

          <p className="hint">
            Browser-only conversion is limited for complex office document formats. Some document conversions require server-side
            rendering for reliable output fidelity.
          </p>
          <ul className="hint capability-list">
            {DOCUMENT_FORMAT_OPTIONS.map((option) => (
              <li key={option.id}>
                {option.label} → PDF: {option.availability === 'server' ? 'Planned via server workflow' : 'Available in browser'}
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </>
  );
}

export default DocumentConverterTool;
