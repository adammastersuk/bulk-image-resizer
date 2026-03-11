import { useState } from 'react';
import BulkImageResizerTool from './BulkImageResizerTool';
import FileConverterTool from './FileConverterTool';
import DocumentConverterTool from './DocumentConverterTool';

type ToolTab = 'resizer' | 'converter' | 'document';

function App() {
  const [activeTab, setActiveTab] = useState<ToolTab>('resizer');

  return (
    <div className="app-shell">
      <header className="suite-header panel">
        <h1>E-Commerce Tools</h1>
        <p>Useful tools for ecommerce image and file workflows</p>

        <nav className="tabs" aria-label="Tool tabs">
          <button
            className={`tab ${activeTab === 'resizer' ? 'active' : ''}`}
            onClick={() => setActiveTab('resizer')}
            type="button"
          >
            Bulk Image Resizer
          </button>
          <button
            className={`tab ${activeTab === 'converter' ? 'active' : ''}`}
            onClick={() => setActiveTab('converter')}
            type="button"
          >
            Image Converter
          </button>

          <button
            className={`tab ${activeTab === 'document' ? 'active' : ''}`}
            onClick={() => setActiveTab('document')}
            type="button"
          >
            Document Converter
          </button>
        </nav>
      </header>

      {activeTab === 'resizer' && <BulkImageResizerTool />}
      {activeTab === 'converter' && <FileConverterTool />}
      {activeTab === 'document' && <DocumentConverterTool />}
    </div>
  );
}

export default App;
