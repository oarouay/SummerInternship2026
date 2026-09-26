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
  Check, 
  Clock, 
  X,
  FileCode,
  FileSpreadsheet,
  Search,
  Plus,
  CheckCircle2,
  Layers,
  MessageSquare
} from 'lucide-react';
import { useConfirm } from './ConfirmModal';

export default function SourceManager({ onNavigateToAsk }) {
  const confirm = useConfirm();
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');

  // Add Source Modal state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState('file'); // 'file', 'crawl', 'raw'

  // Form states
  const [selectedFile, setSelectedFile] = useState(null);
  const [crawlUrl, setCrawlUrl] = useState('');
  const [crawlName, setCrawlName] = useState('');
  const [rawTitle, setRawTitle] = useState('');
  const [rawContent, setRawContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);

  // Document Inspector Drawer state
  const [inspectSource, setInspectSource] = useState(null);
  const [inspectorTab, setInspectorTab] = useState('overview'); // 'overview' | 'chunks'
  const [chunks, setChunks] = useState([]);
  const [loadingChunks, setLoadingChunks] = useState(false);

  const fetchSources = async () => {
    try {
      setLoading(true);
      const data = await sourcesApi.list();
      setSources(data);
    } catch (err) {
      console.error('Failed to fetch knowledge sources:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSources();
  }, []);

  const handleInspect = async (source) => {
    setInspectSource(source);
    setInspectorTab('overview');
    setLoadingChunks(true);
    try {
      const chunksData = await sourcesApi.getChunks(source.id);
      setChunks(chunksData);
    } catch (err) {
      console.error('Failed to load chunks:', err);
      setChunks([]);
    } finally {
      setLoadingChunks(false);
    }
  };

  const handleReprocess = async (sourceId) => {
    try {
      await sourcesApi.reprocess(sourceId);
      setFeedback({ type: 'success', text: 'Document re-indexing enqueued.' });
      await fetchSources();
      if (inspectSource && inspectSource.id === sourceId) {
        const updated = await sourcesApi.getSource(sourceId);
        setInspectSource(updated);
      }
    } catch (err) {
      alert('Reprocess error: ' + err.message);
    }
  };

  const handleDelete = async (sourceId) => {
    const target = sources.find((s) => s.id === sourceId);
    const docName = target?.name ? `"${target.name}"` : 'this document';

    const confirmed = await confirm({
      title: 'Permanently Delete Knowledge Document?',
      description: `Are you sure you want to delete ${docName}? This will permanently remove the source file from organization storage, delete all associated chunk embeddings, and unlink its knowledge graph entities.`,
      confirmText: 'Delete Document',
      cancelText: 'Cancel',
      variant: 'danger',
      details: target?.chunks_count ? `${target.chunks_count} chunk embeddings and associated graph nodes will be permanently deleted.` : null
    });
    if (!confirmed) return;

    try {
      await sourcesApi.delete(sourceId);
      if (inspectSource && inspectSource.id === sourceId) {
        setInspectSource(null);
      }
      await fetchSources();
      setFeedback({ type: 'success', text: `Document ${docName} deleted successfully.` });
    } catch (err) {
      setFeedback({ type: 'error', text: 'Delete error: ' + err.message });
    }
  };

  // Add Source Submissions
  const handleFileUpload = async (e) => {
    e.preventDefault();
    if (!selectedFile) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      await sourcesApi.uploadFile(selectedFile);
      setFeedback({ type: 'success', text: `"${selectedFile.name}" uploaded. Ingestion pipeline started.` });
      setSelectedFile(null);
      setIsAddModalOpen(false);
      await fetchSources();
    } catch (err) {
      setFeedback({ type: 'error', text: err.message || 'File upload failed' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCrawlSubmit = async (e) => {
    e.preventDefault();
    if (!crawlUrl.trim()) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      await sourcesApi.crawlUrl(crawlUrl.trim(), crawlName.trim());
      setFeedback({ type: 'success', text: 'Webpage crawled and enqueued for indexing.' });
      setCrawlUrl('');
      setCrawlName('');
      setIsAddModalOpen(false);
      await fetchSources();
    } catch (err) {
      setFeedback({ type: 'error', text: err.message || 'Web crawl request failed' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRawSubmit = async (e) => {
    e.preventDefault();
    if (!rawTitle.trim() || !rawContent.trim()) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      await sourcesApi.createRawText(rawTitle.trim(), rawContent.trim());
      setFeedback({ type: 'success', text: 'Text document ingested and enqueued.' });
      setRawTitle('');
      setRawContent('');
      setIsAddModalOpen(false);
      await fetchSources();
    } catch (err) {
      setFeedback({ type: 'error', text: err.message || 'Text submission failed' });
    } finally {
      setSubmitting(false);
    }
  };

  const getSourceIcon = (type, name) => {
    if (type === 'url') return <Globe size={15} style={{ color: 'var(--accent-cyan)' }} />;
    if (type === 'raw_text') return <FileCode size={15} style={{ color: 'var(--accent-amber)' }} />;
    if (name?.endsWith('.csv')) return <FileSpreadsheet size={15} style={{ color: 'var(--accent-emerald)' }} />;
    return <FileText size={15} style={{ color: 'var(--accent-primary)' }} />;
  };

  const renderStatusPill = (status, errorMsg) => {
    if (status === 'completed' || status === 'indexed') {
      return (
        <span className="status-pill ready">
          <Check size={11} />
          <span>Ready</span>
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
          <span>Needs Attention</span>
        </span>
      );
    }
    return (
      <span className="status-pill queued">
        <Clock size={11} />
        <span>Queued</span>
      </span>
    );
  };

  // Metrics computation
  const totalCount = sources.length;
  const readyCount = sources.filter((s) => s.status === 'indexed' || s.status === 'completed').length;
  const processingCount = sources.filter((s) => s.status === 'processing' || s.status === 'pending').length;
  const attentionCount = sources.filter((s) => s.status === 'failed').length;

  // Filtered list
  const filteredSources = sources.filter((s) => {
    const matchesSearch = s.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'ready' && (s.status === 'indexed' || s.status === 'completed')) ||
      (statusFilter === 'processing' && (s.status === 'processing' || s.status === 'pending')) ||
      (statusFilter === 'attention' && s.status === 'failed');
    const matchesType = typeFilter === 'all' || s.source_type === typeFilter;
    return matchesSearch && matchesStatus && matchesType;
  });

  return (
    <div className="workspace-page">
      {/* Workspace Header */}
      <div className="workspace-header">
        <div>
          <h1 className="workspace-title">
            <Layers size={20} color="var(--accent-primary)" />
            <span>Knowledge Base</span>
          </h1>
          <p className="workspace-subtitle">
            Manage corporate documents, web sources, and technical policies indexed for multi-hop GraphRAG.
          </p>
        </div>

        <button
          onClick={() => setIsAddModalOpen(true)}
          className="btn btn-primary"
          style={{ padding: '8px 16px', gap: '8px' }}
        >
          <Plus size={15} />
          <span>Add Source</span>
        </button>
      </div>

      {/* Factual Metric Counters */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        <div className="calm-panel" style={{ padding: '14px 18px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
            Total Sources
          </div>
          <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)', marginTop: '4px' }} className="tabular-nums">
            {totalCount}
          </div>
        </div>

        <div className="calm-panel" style={{ padding: '14px 18px' }}>
          <div style={{ fontSize: '11px', color: 'var(--accent-emerald-text)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
            Ready for Answering
          </div>
          <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--accent-emerald-text)', marginTop: '4px' }} className="tabular-nums">
            {readyCount}
          </div>
        </div>

        <div className="calm-panel" style={{ padding: '14px 18px' }}>
          <div style={{ fontSize: '11px', color: 'var(--accent-amber-text)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
            In Processing
          </div>
          <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--accent-amber-text)', marginTop: '4px' }} className="tabular-nums">
            {processingCount}
          </div>
        </div>

        <div className="calm-panel" style={{ padding: '14px 18px' }}>
          <div style={{ fontSize: '11px', color: attentionCount > 0 ? 'var(--accent-rose-text)' : 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
            Needs Attention
          </div>
          <div style={{ fontSize: '22px', fontWeight: 700, color: attentionCount > 0 ? 'var(--accent-rose-text)' : 'var(--text-muted)', marginTop: '4px' }} className="tabular-nums">
            {attentionCount}
          </div>
        </div>
      </div>

      {/* Global Feedback Banner */}
      {feedback && (
        <div
          style={{
            padding: '10px 16px',
            borderRadius: '8px',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '12.5px',
            background: feedback.type === 'success' ? 'var(--accent-emerald-subtle)' : 'var(--accent-rose-subtle)',
            border: `1px solid ${feedback.type === 'success' ? 'var(--accent-emerald-border)' : 'var(--accent-rose-border)'}`,
            color: feedback.type === 'success' ? 'var(--accent-emerald-text)' : 'var(--accent-rose-text)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {feedback.type === 'success' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
            <span>{feedback.text}</span>
          </div>
          <button onClick={() => setFeedback(null)} className="btn-ghost" style={{ padding: '2px' }}>
            <X size={13} />
          </button>
        </div>
      )}

      {/* Search & Filtering Controls */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '14px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '10px', flex: 1, minWidth: '280px' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={14} color="var(--text-muted)" style={{ position: 'absolute', left: '10px', top: '10px' }} />
            <input
              type="search"
              placeholder="Filter sources by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ paddingLeft: '32px' }}
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ width: '150px' }}
            aria-label="Filter by status"
          >
            <option value="all">All Statuses</option>
            <option value="ready">Ready</option>
            <option value="processing">In Processing</option>
            <option value="attention">Needs Attention</option>
          </select>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            style={{ width: '130px' }}
            aria-label="Filter by type"
          >
            <option value="all">All Types</option>
            <option value="file">Files</option>
            <option value="url">Websites</option>
            <option value="raw_text">Text</option>
          </select>
        </div>

        <button
          onClick={fetchSources}
          className="btn btn-secondary"
          style={{ padding: '8px 12px', fontSize: '12px' }}
          title="Refresh source list"
        >
          <RefreshCw size={13} className={loading ? 'spin' : ''} />
          <span>Refresh List</span>
        </button>
      </div>

      {/* Document Table */}
      <div className="data-table-container">
        {filteredSources.length === 0 ? (
          <div className="empty-state-box">
            <div className="empty-state-icon">
              <FileText size={22} />
            </div>
            {totalCount === 0 ? (
              <>
                <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '6px' }}>
                  No knowledge sources ingested yet
                </h3>
                <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginBottom: '16px', maxWidth: '45ch' }}>
                  Upload PDFs, spreadsheets, crawling URLs, or paste technical documentation to power your AI assistant with grounded facts.
                </p>
                <button
                  onClick={() => setIsAddModalOpen(true)}
                  className="btn btn-primary"
                  style={{ padding: '8px 16px' }}
                >
                  <Plus size={14} />
                  <span>Add Your First Source</span>
                </button>
              </>
            ) : (
              <>
                <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>
                  No matching sources found
                </h3>
                <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginBottom: '14px' }}>
                  Try adjusting your search query or status filter.
                </p>
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setStatusFilter('all');
                    setTypeFilter('all');
                  }}
                  className="btn btn-secondary"
                >
                  Clear Filters
                </button>
              </>
            )}
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ minWidth: '240px' }}>Source Name</th>
                <th>Type</th>
                <th>Status</th>
                <th>Chunks</th>
                <th>Ingested</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredSources.map((src) => (
                <tr
                  key={src.id}
                  onClick={() => handleInspect(src)}
                  style={{ cursor: 'pointer' }}
                >
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '9px', fontWeight: 500 }}>
                      {getSourceIcon(src.source_type, src.name)}
                      <span style={{ color: 'var(--text-primary)' }}>{src.name}</span>
                    </div>
                  </td>
                  <td>
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'capitalize' }}>
                      {src.source_type === 'raw_text' ? 'Text' : src.source_type}
                    </span>
                  </td>
                  <td>{renderStatusPill(src.status, src.error_message)}</td>
                  <td className="tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                    {src.chunk_count ?? 0}
                  </td>
                  <td className="tabular-nums" style={{ color: 'var(--text-muted)', fontSize: '11.5px' }}>
                    {new Date(src.created_at).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric'
                    })}
                  </td>
                  <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'inline-flex', gap: '6px' }}>
                      <button
                        onClick={() => handleInspect(src)}
                        className="btn btn-secondary"
                        style={{ padding: '4px 8px', fontSize: '11.5px' }}
                        title="Inspect details and chunks"
                        aria-label={`Inspect ${src.name}`}
                      >
                        <Eye size={12} />
                        <span>Inspect</span>
                      </button>
                      <button
                        onClick={() => handleReprocess(src.id)}
                        className="btn btn-secondary"
                        style={{ padding: '4px 8px' }}
                        title="Reprocess and rebuild embeddings"
                        aria-label={`Reprocess ${src.name}`}
                      >
                        <RefreshCw size={12} />
                      </button>
                      <button
                        onClick={() => handleDelete(src.id)}
                        className="btn btn-danger"
                        style={{ padding: '4px 8px' }}
                        title="Delete source"
                        aria-label={`Delete ${src.name}`}
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

      {/* Add Source Modal Dialog */}
      {isAddModalOpen && (
        <div className="modal-backdrop" onClick={() => !submitting && setIsAddModalOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '560px' }}>
            {/* Modal Header */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-hairline)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ fontSize: '15px', fontWeight: 600 }}>Add Knowledge Source</h3>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Ingest files, web content, or documentation into your tenant
                </p>
              </div>
              <button
                onClick={() => !submitting && setIsAddModalOpen(false)}
                className="btn-ghost"
                style={{ padding: '4px' }}
                aria-label="Close add source modal"
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Sub-Tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border-hairline)', background: 'var(--bg-surface-2)', padding: '0 20px' }}>
              <button
                onClick={() => setModalTab('file')}
                className="btn-ghost"
                style={{
                  borderRadius: 0,
                  padding: '10px 14px',
                  fontSize: '12.5px',
                  fontWeight: modalTab === 'file' ? 600 : 500,
                  color: modalTab === 'file' ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  borderBottom: modalTab === 'file' ? '2px solid var(--accent-primary)' : '2px solid transparent'
                }}
              >
                <UploadCloud size={14} />
                <span>Upload File</span>
              </button>

              <button
                onClick={() => setModalTab('crawl')}
                className="btn-ghost"
                style={{
                  borderRadius: 0,
                  padding: '10px 14px',
                  fontSize: '12.5px',
                  fontWeight: modalTab === 'crawl' ? 600 : 500,
                  color: modalTab === 'crawl' ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  borderBottom: modalTab === 'crawl' ? '2px solid var(--accent-primary)' : '2px solid transparent'
                }}
              >
                <Globe size={14} />
                <span>Add Website</span>
              </button>

              <button
                onClick={() => setModalTab('raw')}
                className="btn-ghost"
                style={{
                  borderRadius: 0,
                  padding: '10px 14px',
                  fontSize: '12.5px',
                  fontWeight: modalTab === 'raw' ? 600 : 500,
                  color: modalTab === 'raw' ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  borderBottom: modalTab === 'raw' ? '2px solid var(--accent-primary)' : '2px solid transparent'
                }}
              >
                <FileCode size={14} />
                <span>Paste Text</span>
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '20px' }}>
              {/* Tab 1: File Upload */}
              {modalTab === 'file' && (
                <form onSubmit={handleFileUpload} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div
                    style={{
                      border: '2px dashed var(--border-subtle)',
                      borderRadius: '10px',
                      padding: '32px 20px',
                      textAlign: 'center',
                      background: 'var(--bg-surface-2)',
                      cursor: 'pointer'
                    }}
                    onClick={() => document.getElementById('file-upload-input').click()}
                  >
                    <input
                      id="file-upload-input"
                      type="file"
                      accept=".pdf,.txt,.docx,.csv,.md"
                      style={{ display: 'none' }}
                      onChange={(e) => setSelectedFile(e.target.files[0] || null)}
                    />
                    <UploadCloud size={32} style={{ color: 'var(--accent-primary)', margin: '0 auto 10px auto' }} />
                    <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>
                      {selectedFile ? selectedFile.name : 'Choose a document or drag & drop'}
                    </div>
                    <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px' }}>
                      Supports PDF, DOCX, TXT, CSV, Markdown (up to 25MB)
                    </div>
                    {selectedFile && (
                      <div style={{ marginTop: '10px', fontSize: '11.5px', color: 'var(--accent-primary)', fontWeight: 600 }}>
                        Selected: {(selectedFile.size / 1024).toFixed(1)} KB
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={() => setIsAddModalOpen(false)}
                      className="btn btn-secondary"
                      disabled={submitting}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={!selectedFile || submitting}
                      className="btn btn-primary"
                    >
                      {submitting ? 'Ingesting...' : 'Start Ingestion'}
                    </button>
                  </div>
                </form>
              )}

              {/* Tab 2: Web Crawl */}
              {modalTab === 'crawl' && (
                <form onSubmit={handleCrawlSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div>
                    <label>Public Webpage URL *</label>
                    <input
                      type="text"
                      required
                      placeholder="https://docs.example.com/architecture"
                      value={crawlUrl}
                      onChange={(e) => setCrawlUrl(e.target.value)}
                    />
                  </div>

                  <div>
                    <label>Custom Document Title (Optional)</label>
                    <input
                      type="text"
                      placeholder="e.g. Architecture Reference Guide"
                      value={crawlName}
                      onChange={(e) => setCrawlName(e.target.value)}
                    />
                  </div>

                  <div style={{ background: 'var(--bg-surface-2)', padding: '10px 12px', borderRadius: '8px', fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                    <strong>Crawl Scope:</strong> Crawls and cleans readable text from this single public webpage with SSRF protection.
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={() => setIsAddModalOpen(false)}
                      className="btn btn-secondary"
                      disabled={submitting}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={!crawlUrl.trim() || submitting}
                      className="btn btn-primary"
                    >
                      {submitting ? 'Crawling...' : 'Index Webpage'}
                    </button>
                  </div>
                </form>
              )}

              {/* Tab 3: Raw Text */}
              {modalTab === 'raw' && (
                <form onSubmit={handleRawSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div>
                    <label>Document Title *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Enterprise Security Policy"
                      value={rawTitle}
                      onChange={(e) => setRawTitle(e.target.value)}
                    />
                  </div>

                  <div>
                    <label>Content & Policy Text *</label>
                    <textarea
                      required
                      rows={6}
                      placeholder="Paste internal policies, FAQs, or operational procedures..."
                      value={rawContent}
                      onChange={(e) => setRawContent(e.target.value)}
                    />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={() => setIsAddModalOpen(false)}
                      className="btn btn-secondary"
                      disabled={submitting}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={!rawTitle.trim() || !rawContent.trim() || submitting}
                      className="btn btn-primary"
                    >
                      {submitting ? 'Saving...' : 'Save & Index'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Document Inspector Slide-Over Drawer */}
      {inspectSource && (
        <div className="drawer-backdrop" onClick={() => setInspectSource(null)}>
          <div className="drawer-panel" onClick={(e) => e.stopPropagation()} style={{ width: '480px' }}>
            {/* Drawer Header */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-hairline)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                {getSourceIcon(inspectSource.source_type, inspectSource.name)}
                <h3 style={{ fontSize: '14px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {inspectSource.name}
                </h3>
              </div>
              <button onClick={() => setInspectSource(null)} className="btn-ghost" style={{ padding: '4px' }}>
                <X size={16} />
              </button>
            </div>

            {/* Drawer Sub-Tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border-hairline)', background: 'var(--bg-surface-2)', padding: '0 20px' }}>
              <button
                onClick={() => setInspectorTab('overview')}
                className="btn-ghost"
                style={{
                  borderRadius: 0,
                  padding: '10px 14px',
                  fontSize: '12px',
                  fontWeight: inspectorTab === 'overview' ? 600 : 500,
                  color: inspectorTab === 'overview' ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  borderBottom: inspectorTab === 'overview' ? '2px solid var(--accent-primary)' : '2px solid transparent'
                }}
              >
                Overview
              </button>

              <button
                onClick={() => setInspectorTab('chunks')}
                className="btn-ghost"
                style={{
                  borderRadius: 0,
                  padding: '10px 14px',
                  fontSize: '12px',
                  fontWeight: inspectorTab === 'chunks' ? 600 : 500,
                  color: inspectorTab === 'chunks' ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  borderBottom: inspectorTab === 'chunks' ? '2px solid var(--accent-primary)' : '2px solid transparent'
                }}
              >
                Semantic Chunks ({chunks.length})
              </button>
            </div>

            {/* Drawer Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
              {inspectorTab === 'overview' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Status Card */}
                  <div className="calm-panel" style={{ padding: '14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 500 }}>
                        Ingestion Status
                      </span>
                      {renderStatusPill(inspectSource.status, inspectSource.error_message)}
                    </div>
                    {inspectSource.error_message && (
                      <div style={{ fontSize: '11.5px', color: 'var(--accent-rose-text)', marginTop: '6px', background: 'var(--accent-rose-subtle)', padding: '8px', borderRadius: '6px' }}>
                        {inspectSource.error_message}
                      </div>
                    )}
                  </div>

                  {/* Metadata Table */}
                  <div className="calm-panel" style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Source ID</span>
                      <span className="tabular-nums" style={{ color: 'var(--text-primary)' }}>#{inspectSource.id}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Content Type</span>
                      <span style={{ color: 'var(--text-primary)' }}>{inspectSource.mime_type || 'Unknown'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>File Size</span>
                      <span className="tabular-nums" style={{ color: 'var(--text-primary)' }}>
                        {inspectSource.file_size ? `${(inspectSource.file_size / 1024).toFixed(1)} KB` : 'N/A'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Processed Chunks</span>
                      <span className="tabular-nums" style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>
                        {chunks.length} chunks
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Ingested On</span>
                      <span style={{ color: 'var(--text-primary)' }}>
                        {new Date(inspectSource.created_at).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {/* Quick Action: Ask About This Source */}
                  {onNavigateToAsk && (
                    <button
                      onClick={() => {
                        onNavigateToAsk({ sourceId: inspectSource.id, sourceName: inspectSource.name });
                        setInspectSource(null);
                      }}
                      className="btn btn-primary"
                      style={{ width: '100%', padding: '9px 14px', justifyContent: 'center' }}
                    >
                      <MessageSquare size={14} />
                      <span>Ask questions about this document</span>
                    </button>
                  )}

                  {/* Maintenance Actions */}
                  <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                    <button
                      onClick={() => handleReprocess(inspectSource.id)}
                      className="btn btn-secondary"
                      style={{ flex: 1 }}
                    >
                      <RefreshCw size={13} />
                      <span>Reprocess Source</span>
                    </button>
                    <button
                      onClick={() => handleDelete(inspectSource.id)}
                      className="btn btn-danger"
                      style={{ flex: 1 }}
                    >
                      <Trash2 size={13} />
                      <span>Delete Source</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Tab 2: Semantic Chunks Viewer */}
              {inspectorTab === 'chunks' && (
                <div>
                  {loadingChunks ? (
                    <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                      <RefreshCw size={18} className="spin" style={{ margin: '0 auto 8px auto' }} />
                      <div>Loading semantic passages...</div>
                    </div>
                  ) : chunks.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                      <Layers size={22} style={{ margin: '0 auto 8px auto', opacity: 0.5 }} />
                      <div>No chunks generated yet for this source.</div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                        Showing {chunks.length} extracted passages with vector embeddings:
                      </div>
                      {chunks.map((chunk, idx) => (
                        <div key={chunk.id || idx} className="calm-panel" style={{ padding: '12px', fontSize: '12px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '11px', color: 'var(--text-muted)' }}>
                            <span style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>
                              Chunk #{chunk.chunk_index !== undefined ? chunk.chunk_index : idx}
                            </span>
                            <span className="tabular-nums">
                              {chunk.content ? `${chunk.content.length} chars` : ''}
                            </span>
                          </div>
                          <div style={{ color: 'var(--text-primary)', lineHeight: 1.55, whiteSpace: 'pre-wrap', maxHeight: '180px', overflowY: 'auto' }}>
                            {chunk.content}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
