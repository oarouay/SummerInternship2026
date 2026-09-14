import React, { useState, useEffect } from 'react';
import { sourcesApi } from '../api/client';
import { 
  UploadCloud, 
  Globe, 
  FileText, 
  RefreshCw, 
  Trash2, 
  Eye, 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  X,
  Database,
  Layers,
  ShieldCheck,
  FileCode,
  FileSpreadsheet
} from 'lucide-react';

export default function SourceManager() {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('upload'); // 'upload', 'crawl', 'raw'
  const [feedback, setFeedback] = useState(null);

  // Form states
  const [selectedFile, setSelectedFile] = useState(null);
  const [crawlUrl, setCrawlUrl] = useState('');
  const [crawlName, setCrawlName] = useState('');
  const [rawTitle, setRawTitle] = useState('');
  const [rawContent, setRawContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Slide-over Chunk Inspector state
  const [inspectSource, setInspectSource] = useState(null);
  const [chunks, setChunks] = useState([]);
  const [loadingChunks, setLoadingChunks] = useState(false);

  const fetchSources = async () => {
    setLoading(true);
    try {
      const data = await sourcesApi.list();
      setSources(data);
    } catch (err) {
      console.error('Failed to load sources:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSources();
    const interval = setInterval(fetchSources, 6000);
    return () => clearInterval(interval);
  }, []);

  const handleFileUpload = async (e) => {
    e.preventDefault();
    if (!selectedFile) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      await sourcesApi.uploadFile(selectedFile);
      setSelectedFile(null);
      setFeedback({ type: 'success', text: `Document "${selectedFile.name}" enqueued for ingestion and graph extraction.` });
      await fetchSources();
    } catch (err) {
      setFeedback({ type: 'error', text: err.message || 'File upload failed.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCrawlSubmit = async (e) => {
    e.preventDefault();
    if (!crawlUrl) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      await sourcesApi.crawlUrl(crawlUrl, crawlName);
      setCrawlUrl('');
      setCrawlName('');
      setFeedback({ type: 'success', text: `Webpage URL enqueued and verified through SSRF safety validation.` });
      await fetchSources();
    } catch (err) {
      setFeedback({ type: 'error', text: err.message || 'URL crawl failed.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRawSubmit = async (e) => {
    e.preventDefault();
    if (!rawTitle || !rawContent) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      await sourcesApi.createRawText(rawTitle, rawContent);
      setRawTitle('');
      setRawContent('');
      setFeedback({ type: 'success', text: `Knowledge passage indexed successfully.` });
      await fetchSources();
    } catch (err) {
      setFeedback({ type: 'error', text: err.message || 'Text ingestion failed.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleInspectChunks = async (source) => {
    setInspectSource(source);
    setLoadingChunks(true);
    try {
      const data = await sourcesApi.getChunks(source.id);
      setChunks(data);
    } catch (err) {
      console.error('Failed to load chunks:', err);
    } finally {
      setLoadingChunks(false);
    }
  };

  const handleReprocess = async (sourceId) => {
    try {
      await sourcesApi.reprocess(sourceId);
      setFeedback({ type: 'success', text: 'Document re-indexing triggered.' });
      await fetchSources();
    } catch (err) {
      alert('Reprocess error: ' + err.message);
    }
  };

  const handleDelete = async (sourceId) => {
    if (!confirm('Permanently delete this document and remove all vector embeddings and graph links?')) return;
    try {
      await sourcesApi.delete(sourceId);
      if (inspectSource && inspectSource.id === sourceId) {
        setInspectSource(null);
      }
      await fetchSources();
    } catch (err) {
      alert('Delete error: ' + err.message);
    }
  };

  const getSourceIcon = (type, name) => {
    if (type === 'url') return <Globe size={15} color="var(--accent-cyan)" />;
    if (type === 'raw_text') return <FileCode size={15} color="var(--accent-amber)" />;
    if (name?.endsWith('.csv')) return <FileSpreadsheet size={15} color="var(--accent-emerald)" />;
    return <FileText size={15} color="var(--accent-primary)" />;
  };

  const renderStatus = (status, errorMsg) => {
    if (status === 'completed' || status === 'indexed') {
      return (
        <span className="status-pill indexed">
          <span className="telemetry-dot online" style={{ width: '5px', height: '5px' }}></span>
          <span>Indexed</span>
        </span>
      );
    }
    if (status === 'processing') {
      return (
        <span className="status-pill processing">
          <Clock size={11} className="spin" />
          <span>Processing</span>
        </span>
      );
    }
    if (status === 'failed') {
      return (
        <span className="status-pill failed" title={errorMsg || 'Failed to index'}>
          <AlertCircle size={11} />
          <span>Failed</span>
        </span>
      );
    }
    return (
      <span className="status-pill" style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)' }}>
        <Clock size={11} />
        <span>Pending</span>
      </span>
    );
  };

  return (
    <div className="workspace-page">
      {/* Workspace Header */}
      <div className="workspace-header">
        <div>
          <h1 className="workspace-title">
            <Database size={20} color="var(--accent-primary)" />
            <span>Knowledge Base & Ingestion</span>
          </h1>
          <p className="workspace-subtitle">
            Connect enterprise data sources to construct isolated vector embeddings and knowledge graph entities.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '8px', 
            padding: '6px 12px', 
            borderRadius: '8px', 
            background: 'var(--bg-surface-1)', 
            border: '1px solid var(--border-hairline)',
            fontSize: '12px',
            color: 'var(--text-secondary)'
          }}>
            <span>Indexed Documents:</span>
            <strong className="tabular-nums" style={{ color: 'var(--text-primary)' }}>{sources.length}</strong>
          </div>
          <button 
            onClick={fetchSources} 
            className="btn btn-secondary"
            title="Refresh documents list"
          >
            <RefreshCw size={13} className={loading ? 'spin' : ''} />
            <span>Sync</span>
          </button>
        </div>
      </div>

      {/* Unified Ingestion Console */}
      <div className="glass-panel" style={{ padding: '20px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div className="segmented-control">
            <button
              onClick={() => { setActiveTab('upload'); setFeedback(null); }}
              className={activeTab === 'upload' ? 'active' : ''}
            >
              <UploadCloud size={14} />
              <span>Document Upload</span>
            </button>
            <button
              onClick={() => { setActiveTab('crawl'); setFeedback(null); }}
              className={activeTab === 'crawl' ? 'active' : ''}
            >
              <Globe size={14} />
              <span>Web Scraper</span>
            </button>
            <button
              onClick={() => { setActiveTab('raw'); setFeedback(null); }}
              className={activeTab === 'raw' ? 'active' : ''}
            >
              <FileText size={14} />
              <span>Raw Text / Markdown</span>
            </button>
          </div>

          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            768-dim Vector Embeddings · Recursive Chunking
          </div>
        </div>

        {/* Feedback Alert */}
        {feedback && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 12px',
            borderRadius: '6px',
            marginBottom: '16px',
            fontSize: '12px',
            background: feedback.type === 'success' ? 'var(--accent-emerald-subtle)' : 'var(--accent-rose-subtle)',
            color: feedback.type === 'success' ? 'var(--accent-emerald)' : 'var(--accent-rose)',
            border: `1px solid ${feedback.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`
          }}>
            {feedback.type === 'success' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
            <span>{feedback.text}</span>
          </div>
        )}

        {/* Mode 1: File Upload */}
        {activeTab === 'upload' && (
          <form onSubmit={handleFileUpload}>
            <div 
              style={{
                border: '1px dashed var(--border-subtle)',
                borderRadius: '10px',
                padding: '32px 20px',
                textAlign: 'center',
                background: 'var(--bg-surface-2)',
                cursor: 'pointer',
                transition: 'border-color 0.2s ease',
              }}
              onClick={() => document.getElementById('file-input-field').click()}
            >
              <input
                id="file-input-field"
                type="file"
                style={{ display: 'none' }}
                accept=".pdf,.docx,.txt,.csv,.md"
                onChange={(e) => setSelectedFile(e.target.files[0] || null)}
              />
              <UploadCloud size={32} color="var(--accent-primary)" style={{ marginBottom: '8px' }} />
              <div style={{ fontSize: '13.5px', fontWeight: 500, color: 'var(--text-primary)' }}>
                {selectedFile ? selectedFile.name : 'Select or drag & drop a file to index'}
              </div>
              <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px' }}>
                PDF, DOCX, TXT, CSV, Markdown · Up to 25 MB
              </div>
            </div>

            {selectedFile && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px', gap: '8px' }}>
                <button 
                  type="button" 
                  onClick={() => setSelectedFile(null)} 
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={submitting} 
                  className="btn btn-primary"
                >
                  {submitting ? 'Indexing...' : `Ingest "${selectedFile.name}"`}
                </button>
              </div>
            )}
          </form>
        )}

        {/* Mode 2: Web Scraper */}
        {activeTab === 'crawl' && (
          <form onSubmit={handleCrawlSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '5px', display: 'block' }}>
                  Target Webpage URL *
                </label>
                <input
                  type="text"
                  required
                  placeholder="https://docs.example.com/api"
                  value={crawlUrl}
                  onChange={(e) => setCrawlUrl(e.target.value)}
                />
              </div>
              <div>
                <label style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '5px', display: 'block' }}>
                  Document Title (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. API Reference"
                  value={crawlName}
                  onChange={(e) => setCrawlName(e.target.value)}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                <ShieldCheck size={13} color="var(--accent-emerald)" />
                <span>SSRF Defense active: Internal networks, private loopbacks, and link-local IPs are blocked.</span>
              </span>
              <button 
                type="submit" 
                disabled={submitting || !crawlUrl} 
                className="btn btn-primary"
              >
                {submitting ? 'Scraping...' : 'Crawl & Extract'}
              </button>
            </div>
          </form>
        )}

        {/* Mode 3: Raw Text */}
        {activeTab === 'raw' && (
          <form onSubmit={handleRawSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '5px', display: 'block' }}>
                Document Title *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Deployment Architecture Guide"
                value={rawTitle}
                onChange={(e) => setRawTitle(e.target.value)}
              />
            </div>
            <div>
              <label style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '5px', display: 'block' }}>
                Content & Documentation *
              </label>
              <textarea
                required
                rows={4}
                placeholder="Paste technical documentation, FAQs, or enterprise policies..."
                value={rawContent}
                onChange={(e) => setRawContent(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button 
                type="submit" 
                disabled={submitting || !rawTitle || !rawContent} 
                className="btn btn-primary"
              >
                {submitting ? 'Indexing...' : 'Save & Extract Graph'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Indexed Knowledge Inventory Table */}
      <div className="data-table-container">
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
            Indexed Knowledge Documents
          </div>
          <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
            Row-Level Isolated across Tenant
          </span>
        </div>

        {sources.length === 0 ? (
          <div className="empty-state-box">
            <div className="empty-state-icon">
              <FileText size={24} />
            </div>
            <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '4px' }}>
              No Knowledge Sources Yet
            </div>
            <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', maxWidth: '45ch' }}>
              Upload your technical documents, crawl API docs, or paste markdown notes above to begin building your knowledge graph.
            </div>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Document Name</th>
                <th>Type</th>
                <th>Status</th>
                <th>Chunks</th>
                <th>Ingested</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((src) => (
                <tr key={src.id}>
                  <td style={{ fontWeight: 500 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {getSourceIcon(src.source_type, src.name)}
                      <span>{src.name}</span>
                    </div>
                  </td>
                  <td>
                    <span className="eyebrow-tag" style={{ fontSize: '9.5px' }}>
                      {src.source_type}
                    </span>
                  </td>
                  <td>
                    {renderStatus(src.status, src.error_message)}
                  </td>
                  <td className="tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                    {src.chunk_count || 0}
                  </td>
                  <td className="tabular-nums" style={{ color: 'var(--text-muted)', fontSize: '11.5px' }}>
                    {new Date(src.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '6px' }}>
                      <button
                        onClick={() => handleInspectChunks(src)}
                        className="btn btn-secondary"
                        style={{ padding: '4px 8px', fontSize: '11.5px' }}
                        title="View chunks & embeddings"
                      >
                        <Eye size={12} />
                        <span>Chunks</span>
                      </button>
                      <button
                        onClick={() => handleReprocess(src.id)}
                        className="btn btn-secondary"
                        style={{ padding: '4px 8px', fontSize: '11.5px' }}
                        title="Reprocess and rebuild graph"
                      >
                        <RefreshCw size={12} />
                      </button>
                      <button
                        onClick={() => handleDelete(src.id)}
                        className="btn btn-danger"
                        style={{ padding: '4px 8px', fontSize: '11.5px' }}
                        title="Delete source"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Slide-Over Chunk Inspector Drawer */}
      {inspectSource && (
        <div className="drawer-backdrop" onClick={() => setInspectSource(null)}>
          <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
            <div style={{ 
              padding: '18px 24px', 
              borderBottom: '1px solid var(--border-hairline)', 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center' 
            }}>
              <div>
                <h3 style={{ fontSize: '15px', fontWeight: 600 }}>{inspectSource.name}</h3>
                <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  {chunks.length} total chunks · 768d pgvector embeddings
                </div>
              </div>
              <button 
                onClick={() => setInspectSource(null)} 
                className="btn btn-ghost" 
                style={{ padding: '6px', borderRadius: '6px' }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {loadingChunks ? (
                <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                  Loading vector chunks...
                </div>
              ) : chunks.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                  No chunks generated for this source.
                </div>
              ) : (
                chunks.map((chunk) => (
                  <div key={chunk.id} className="glass-panel" style={{ padding: '12px 14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '11px' }}>
                      <span className="tabular-nums" style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>
                        Chunk #{chunk.chunk_index}
                      </span>
                      <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>
                        {chunk.char_count} chars
                      </span>
                    </div>
                    <div style={{ 
                      fontSize: '12px', 
                      color: 'var(--text-secondary)', 
                      lineHeight: 1.6, 
                      fontFamily: 'var(--font-mono)', 
                      whiteSpace: 'pre-wrap',
                      background: 'var(--bg-surface-2)',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-hairline)'
                    }}>
                      {chunk.content}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
