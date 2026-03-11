import { useState } from 'react';
import BulkImageResizerTool from './BulkImageResizerTool';
import FileConverterTool from './FileConverterTool';

type ToolTab = 'resizer' | 'converter';

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
        </nav>
      </header>

      {activeTab === 'resizer' ? <BulkImageResizerTool /> : <FileConverterTool />}
    </div>
  );
}

export default App;
