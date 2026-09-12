import React, { useState, useEffect } from 'react';
import { sourcesApi } from '../api/client';
import { 
  UploadCloud, 
  Globe, 
  FileText, 
  RefreshCw, 
  Trash2, 
  Eye, 
  Search, 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  X,
  FileCode,
  Layers,
  ArrowUpRight,
  ShieldCheck
} from 'lucide-react';

export default function SourceManager() {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('upload'); // 'upload', 'crawl', 'raw', 'search'
  const [feedback, setFeedback] = useState(null);

  // Form states
  const [selectedFile, setSelectedFile] = useState(null);
  const [crawlUrl, setCrawlUrl] = useState('');
  const [crawlName, setCrawlName] = useState('');
  const [rawTitle, setRawTitle] = useState('');
  const [rawContent, setRawContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Chunk Inspector state
  const [inspectSource, setInspectSource] = useState(null);
  const [chunks, setChunks] = useState([]);
  const [loadingChunks, setLoadingChunks] = useState(false);

  // Semantic Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchTopK, setSearchTopK] = useState(4);
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);

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
      setFeedback({ type: 'success', text: `Document "${selectedFile.name}" enqueued for ingestion.` });
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
      setFeedback({ type: 'success', text: `Webpage URL enqueued and protected by SSRF validation.` });
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
      setFeedback({ type: 'success', text: `Raw snippet indexed successfully.` });
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
      await fetchSources();
    } catch (err) {
      alert('Reprocess error: ' + err.message);
    }
  };

  const handleDelete = async (sourceId) => {
    if (!confirm('Permanently delete this document and remove all its pgvector embeddings?')) return;
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

  const handleSemanticSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await sourcesApi.search(searchQuery, searchTopK);
      setSearchResults(res);
    } catch (err) {
      alert('Search failed: ' + err.message);
    } finally {
      setSearching(false);
    }
  };

  const renderStatus = (status, errorMsg) => {
    if (status === 'completed') {
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: 'var(--accent-emerald)', fontSize: '12px' }}>
          <span className="telemetry-dot online"></span>
          <span>Indexed</span>
        </span>
      );
    }
    if (status === 'processing') {
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: 'var(--accent-amber)', fontSize: '12px' }}>
          <Clock size={12} className="spin" />
          <span>Processing</span>
        </span>
      );
    }
    if (status === 'failed') {
      return (
        <span title={errorMsg || 'Failed'} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: 'var(--accent-rose)', fontSize: '12px', cursor: 'help' }}>
          <AlertCircle size={12} />
          <span>Failed</span>
        </span>
      );
    }
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: 'var(--text-muted)', fontSize: '12px' }}>
        <Clock size={12} />
        <span>Pending</span>
      </span>
    );
  };

  return (
    <div style={{ padding: '28px 36px', maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
      {/* Title & Actions */}
      <div style={{ marginBottom: '28px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 600 }}>Document Base & Ingestion</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '4px' }}>
            Manage tenant-isolated knowledge files, scrape public URLs with SSRF protection, and inspect semantic embeddings.
          </p>
        </div>
        <button 
          onClick={fetchSources} 
          className="btn btn-secondary"
          style={{ fontSize: '12px', padding: '6px 12px' }}
        >
          <RefreshCw size={13} className={loading ? 'spin' : ''} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Ingestion Hub Card */}
      <div className="hairline-card" style={{ padding: '20px', marginBottom: '28px' }}>
        {/* Segmented Mode Selector */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
          <div className="segmented-control">
            <button
              onClick={() => { setActiveTab('upload'); setFeedback(null); }}
              className={activeTab === 'upload' ? 'active' : ''}
            >
              <UploadCloud size={13} />
              <span>Document Upload</span>
            </button>
            <button
              onClick={() => { setActiveTab('crawl'); setFeedback(null); }}
              className={activeTab === 'crawl' ? 'active' : ''}
            >
              <Globe size={13} />
              <span>Web Scraper</span>
            </button>
            <button
              onClick={() => { setActiveTab('raw'); setFeedback(null); }}
              className={activeTab === 'raw' ? 'active' : ''}
            >
              <FileText size={13} />
              <span>Raw Text</span>
            </button>
            <button
              onClick={() => { setActiveTab('search'); setFeedback(null); }}
              className={activeTab === 'search' ? 'active' : ''}
            >
              <Search size={13} />
              <span>Vector Query Test</span>
            </button>
          </div>

          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            Gemini 768-dim embeddings · Cosine Distance
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

        {/* 1. File Upload Mode */}
        {activeTab === 'upload' && (
          <form onSubmit={handleFileUpload}>
            <div 
              style={{
                border: '1px dashed var(--border-subtle)',
                borderRadius: '10px',
                padding: '36px 20px',
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
              <UploadCloud size={30} color="var(--accent-primary)" style={{ marginBottom: '8px' }} />
              <div style={{ fontSize: '13.5px', fontWeight: 500, color: 'var(--text-primary)' }}>
                {selectedFile ? selectedFile.name : 'Select or drop a document to ingest'}
              </div>
              <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px' }}>
                PDF, DOCX, TXT, CSV, Markdown · Maximum 25 MB
              </div>
            </div>

            {selectedFile && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px', gap: '8px' }}>
                <button 
                  type="button" 
                  onClick={() => setSelectedFile(null)} 
                  className="btn btn-secondary"
                  style={{ fontSize: '12px' }}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={submitting} 
                  className="btn btn-primary"
                  style={{ fontSize: '12px' }}
                >
                  {submitting ? 'Indexing...' : `Upload "${selectedFile.name}"`}
                </button>
              </div>
            )}
          </form>
        )}

        {/* 2. Web Crawler Mode */}
        {activeTab === 'crawl' && (
          <form onSubmit={handleCrawlSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>
                  Target Webpage URL *
                </label>
                <input
                  type="text"
                  required
                  placeholder="https://en.wikipedia.org/wiki/Neo4j"
                  value={crawlUrl}
                  onChange={(e) => setCrawlUrl(e.target.value)}
                />
              </div>
              <div>
                <label style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>
                  Document Name (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Neo4j Overview"
                  value={crawlName}
                  onChange={(e) => setCrawlName(e.target.value)}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <ShieldCheck size={13} color="var(--accent-emerald)" />
                <span>SSRF Defense active: Internal networks, private loopbacks, and link-local IPs are blocked.</span>
              </span>
              <button 
                type="submit" 
                disabled={submitting || !crawlUrl} 
                className="btn btn-primary"
                style={{ fontSize: '12px' }}
              >
                {submitting ? 'Scraping...' : 'Crawl & Index'}
              </button>
            </div>
          </form>
        )}

        {/* 3. Raw Text Mode */}
        {activeTab === 'raw' && (
          <form onSubmit={handleRawSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>
                Document Title *
              </label>
              <input
                type="text"
                required
                placeholder="Knowledge Snippet Title"
                value={rawTitle}
                onChange={(e) => setRawTitle(e.target.value)}
              />
            </div>
            <div>
              <label style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>
                Content *
              </label>
              <textarea
                required
                rows={4}
                placeholder="Paste guidelines, FAQs, or raw markdown documentation..."
                value={rawContent}
                onChange={(e) => setRawContent(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button 
                type="submit" 
                disabled={submitting || !rawTitle || !rawContent} 
                className="btn btn-primary"
                style={{ fontSize: '12px' }}
              >
                {submitting ? 'Indexing...' : 'Save Snippet'}
              </button>
            </div>
          </form>
        )}

        {/* 4. Vector Query Playground */}
        {activeTab === 'search' && (
          <div>
            <form onSubmit={handleSemanticSearch} style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', marginBottom: '16px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>
                  Semantic Search Test Query
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. What database architectures are supported?"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <div style={{ width: '80px' }}>
                <label style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>
                  Top-K
                </label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={searchTopK}
                  onChange={(e) => setSearchTopK(parseInt(e.target.value) || 4)}
                />
              </div>
              <button type="submit" disabled={searching} className="btn btn-primary" style={{ height: '35px' }}>
                <Search size={13} />
                <span>{searching ? 'Querying...' : 'Query'}</span>
              </button>
            </form>

            {searchResults.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                  Found {searchResults.length} closest semantic matches:
                </div>
                {searchResults.map((res, idx) => (
                  <div key={idx} className="hairline-card" style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '11.5px' }}>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                        {res.source_name} <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>#chunk-{res.chunk_index}</span>
                      </span>
                      <span className="tabular-nums" style={{ color: 'var(--accent-emerald)', fontWeight: 600 }}>
                        {(res.similarity_score * 100).toFixed(1)}% match
                      </span>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5, fontFamily: 'var(--font-mono)' }}>
                      "{res.content}"
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sources Data Grid Table */}
      <div className="hairline-card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-primary)' }}>
            Knowledge Documents ({sources.length})
          </div>
        </div>

        {sources.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
            No sources uploaded yet. Ingest a document or crawl a URL above.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12.5px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-hairline)', color: 'var(--text-muted)', fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                <th style={{ padding: '8px 16px', fontWeight: 500 }}>Source Name</th>
                <th style={{ padding: '8px 16px', fontWeight: 500 }}>Type</th>
                <th style={{ padding: '8px 16px', fontWeight: 500 }}>Status</th>
                <th style={{ padding: '8px 16px', fontWeight: 500 }}>Chunks</th>
                <th style={{ padding: '8px 16px', fontWeight: 500 }}>Date</th>
                <th style={{ padding: '8px 16px', textAlign: 'right', fontWeight: 500 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((src) => (
                <tr key={src.id} style={{ borderBottom: '1px solid var(--border-hairline)', transition: 'background 0.15s ease' }}>
                  <td style={{ padding: '10px 16px', fontWeight: 500, color: 'var(--text-primary)' }}>
                    {src.name}
                  </td>
                  <td style={{ padding: '10px 16px' }}>
                    <span className="eyebrow-tag" style={{ fontSize: '9.5px', padding: '1px 5px' }}>
                      {src.source_type}
                    </span>
                  </td>
                  <td style={{ padding: '10px 16px' }}>
                    {renderStatus(src.status, src.error_message)}
                  </td>
                  <td className="tabular-nums" style={{ padding: '10px 16px', color: 'var(--text-secondary)' }}>
                    {src.chunk_count || 0}
                  </td>
                  <td className="tabular-nums" style={{ padding: '10px 16px', color: 'var(--text-muted)', fontSize: '11.5px' }}>
                    {new Date(src.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '4px' }}>
                      <button
                        onClick={() => handleInspectChunks(src)}
                        className="btn btn-secondary"
                        style={{ padding: '3px 7px', fontSize: '11px', borderRadius: '4px' }}
                        title="View chunks"
                      >
                        <Eye size={12} />
                        <span>Chunks</span>
                      </button>
                      <button
                        onClick={() => handleReprocess(src.id)}
                        className="btn btn-secondary"
                        style={{ padding: '3px 7px', fontSize: '11px', borderRadius: '4px' }}
                        title="Reprocess"
                      >
                        <RefreshCw size={12} />
                      </button>
                      <button
                        onClick={() => handleDelete(src.id)}
                        className="btn btn-danger"
                        style={{ padding: '3px 7px', fontSize: '11px', borderRadius: '4px' }}
                        title="Delete"
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

      {/* Chunks Inspector Slide Modal */}
      {inspectSource && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(6px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '24px'
        }}>
          <div className="hairline-card" style={{ width: '100%', maxWidth: '750px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', padding: '20px', background: 'var(--bg-surface-1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1px solid var(--border-hairline)', paddingBottom: '10px' }}>
              <div>
                <h3 style={{ fontSize: '15px', fontWeight: 600 }}>Chunks: {inspectSource.name}</h3>
                <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                  {chunks.length} total chunks · 768d pgvector embeddings
                </div>
              </div>
              <button onClick={() => setInspectSource(null)} className="btn-ghost" style={{ padding: '4px', borderRadius: '4px' }}>
                <X size={16} />
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {loadingChunks ? (
                <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Loading chunks...</div>
              ) : chunks.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>No chunks generated yet.</div>
              ) : (
                chunks.map((chunk) => (
                  <div key={chunk.id} className="hairline-card" style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '11px' }}>
                      <span className="tabular-nums" style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>Chunk #{chunk.chunk_index}</span>
                      <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>{chunk.char_count} chars</span>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5, fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap' }}>
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
