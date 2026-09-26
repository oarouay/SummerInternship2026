import React, { useState, useEffect, useRef } from 'react';
import { chatbotApi, publicWidgetApi } from '../api/client';
import MarkdownMessage from './MarkdownMessage';
import { 
  Code2, 
  Copy, 
  Check, 
  MessageSquare, 
  ShieldCheck, 
  ExternalLink, 
  Send, 
  Bot, 
  X, 
  CheckCircle2, 
  AlertCircle,
  RefreshCw,
  Sun,
  Moon,
  Sparkles,
  HelpCircle,
  CornerDownLeft
} from 'lucide-react';

export default function Integrations({ tenant }) {
  const [primaryColor, setPrimaryColor] = useState('#4F5BD5');
  const [position, setPosition] = useState('right');
  const [copied, setCopied] = useState(false);

  // Verification status
  const [verifying, setVerifying] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState(null); // null | 'verified' | 'failed'
  const [verificationMsg, setVerificationMsg] = useState('');

  // Interactive Live Preview State
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTheme, setPreviewTheme] = useState('dark'); // 'dark' | 'light'
  const [previewMessages, setPreviewMessages] = useState([
    { 
      role: 'assistant', 
      content: 'Hello! I am your AI assistant. How can I help you today? Ask me anything about your documents or knowledge graph.',
      isStreaming: false,
      metadata: null
    }
  ]);
  const [previewInput, setPreviewInput] = useState('');
  const [previewSending, setPreviewSending] = useState(false);

  // Refs for streaming buffer throttle and autoscroll
  const streamBufferRef = useRef('');
  const throttleTimeoutRef = useRef(null);
  const abortControllerRef = useRef(null);
  const messagesEndRef = useRef(null);

  const tenantSlug = tenant?.slug || 'your-organization';

  // Environment-correct production script snippet
  const hostOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://your-domain.com';
  const widgetScriptCode = `<!-- OmniGraph Knowledge Widget -->
<script 
  src="${hostOrigin}/widget.js" 
  data-tenant-slug="${tenantSlug}"
  data-primary-color="${primaryColor}"
  data-position="${position}"
  defer>
</script>`;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (previewOpen) {
      scrollToBottom();
    }
  }, [previewMessages, previewOpen]);

  // Clean up streaming abort controller and timeouts on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
      if (throttleTimeoutRef.current) clearTimeout(throttleTimeoutRef.current);
    };
  }, []);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(widgetScriptCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleVerifyEndpoint = async () => {
    setVerifying(true);
    setVerificationStatus(null);
    try {
      const config = await publicWidgetApi.getConfig(tenantSlug);
      if (config) {
        setVerificationStatus('verified');
        setVerificationMsg(`Connected to "${config.name || 'Assistant'}" on tenant "${config.tenant_slug}".`);
      }
    } catch (err) {
      setVerificationStatus('failed');
      setVerificationMsg(err.message || 'Endpoint verification request failed');
    } finally {
      setVerifying(false);
    }
  };

  const flushBuffer = () => {
    const fullText = streamBufferRef.current;
    setPreviewMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last && last.role === 'assistant') {
        next[next.length - 1] = { ...last, content: fullText };
      }
      return next;
    });
  };

  const handleSendPreviewMessage = async (e, customText = null) => {
    if (e && e.preventDefault) e.preventDefault();
    const text = (customText !== null ? customText : previewInput).trim();
    if (!text || previewSending) return;

    setPreviewInput('');
    setPreviewSending(true);

    const userMsg = { role: 'user', content: text };
    const history = previewMessages.map((m) => ({ role: m.role, content: m.content }));

    setPreviewMessages((prev) => [
      ...prev,
      userMsg,
      { role: 'assistant', content: '', isStreaming: true, metadata: null }
    ]);

    streamBufferRef.current = '';

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortCtrl = new AbortController();
    abortControllerRef.current = abortCtrl;

    try {
      await publicWidgetApi.streamMessage(
        tenantSlug,
        text,
        history,
        {
          signal: abortCtrl.signal,
          onToken: (token) => {
            streamBufferRef.current += token;
            if (!throttleTimeoutRef.current) {
              throttleTimeoutRef.current = setTimeout(() => {
                flushBuffer();
                throttleTimeoutRef.current = null;
              }, 35);
            }
          },
          onMetadata: (meta) => {
            setPreviewMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === 'assistant') {
                next[next.length - 1] = { ...last, metadata: meta };
              }
              return next;
            });
          },
          onDone: () => {
            if (throttleTimeoutRef.current) {
              clearTimeout(throttleTimeoutRef.current);
              throttleTimeoutRef.current = null;
            }
            flushBuffer();
            setPreviewMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === 'assistant') {
                next[next.length - 1] = { ...last, isStreaming: false };
              }
              return next;
            });
          },
          onError: (err) => {
            if (throttleTimeoutRef.current) {
              clearTimeout(throttleTimeoutRef.current);
              throttleTimeoutRef.current = null;
            }
            flushBuffer();
            setPreviewMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === 'assistant') {
                next[next.length - 1] = {
                  ...last,
                  content: last.content || `Connection interrupted: ${err.message}`,
                  isStreaming: false
                };
              }
              return next;
            });
          }
        }
      );
    } catch (err) {
      if (err.name === 'AbortError') return;
      setPreviewMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === 'assistant') {
          next[next.length - 1] = {
            ...last,
            content: last.content || `Error: ${err.message}`,
            isStreaming: false
          };
        }
        return next;
      });
    } finally {
      if (throttleTimeoutRef.current) {
        clearTimeout(throttleTimeoutRef.current);
        throttleTimeoutRef.current = null;
      }
      setPreviewSending(false);
    }
  };

  return (
    <div className="workspace-page">
      {/* Workspace Header */}
      <div className="workspace-header">
        <div>
          <h1 className="workspace-title">
            <Code2 size={20} color="var(--accent-primary)" />
            <span>Web Widget Integration</span>
          </h1>
          <p className="workspace-subtitle">
            Configure, preview, and deploy an isolated, embeddable website assistant powered by your GraphRAG cluster.
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 420px', gap: '24px', alignItems: 'start' }}>
        {/* Left Column: Configuration & Installation Instructions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Section 1: Appearance & Placement */}
          <div className="calm-panel" style={{ padding: '20px' }}>
            <h2 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '14px' }}>
              1. Appearance & Position
            </h2>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <label>Brand Accent Color</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    style={{
                      width: '36px',
                      height: '34px',
                      padding: 0,
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      background: 'transparent'
                    }}
                    aria-label="Pick widget accent color"
                  />
                  <input
                    type="text"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    style={{ flex: 1 }}
                  />
                </div>
              </div>

              <div>
                <label>Screen Float Position</label>
                <select value={position} onChange={(e) => setPosition(e.target.value)}>
                  <option value="right">Bottom Right (Standard)</option>
                  <option value="left">Bottom Left</option>
                </select>
              </div>
            </div>
          </div>

          {/* Section 2: Access & Knowledge Scope Notice */}
          <div className="calm-panel" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <ShieldCheck size={16} color="var(--accent-primary)" />
              <h2 style={{ fontSize: '14px', fontWeight: 600 }}>2. Public Knowledge Scope Boundary</h2>
            </div>
            <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              The embeddable widget communicates with the unauthenticated visitor endpoint (<code>/api/v1/chat/public/{tenantSlug}/message</code>).
              It retrieves answers exclusively from documents ingested within your active organization <strong>{tenant?.name}</strong>.
            </p>
          </div>

          {/* Section 3: Installation Script */}
          <div className="calm-panel" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <div>
                <h2 style={{ fontSize: '14px', fontWeight: 600 }}>3. Install on Your Website</h2>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Paste this snippet before the closing <code>&lt;/body&gt;</code> tag of your web pages.
                </p>
              </div>

              <button
                onClick={handleCopyCode}
                className="btn btn-primary"
                style={{ padding: '6px 12px', fontSize: '12px' }}
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
                <span>{copied ? 'Copied' : 'Copy Snippet'}</span>
              </button>
            </div>

            <pre
              style={{
                background: 'var(--bg-surface-2)',
                border: '1px solid var(--border-hairline)',
                borderRadius: '8px',
                padding: '14px',
                fontSize: '12px',
                color: 'var(--text-primary)',
                overflowX: 'auto',
                lineHeight: 1.55,
                marginTop: '10px'
              }}
            >
              {widgetScriptCode}
            </pre>

            {/* Verification Status Check */}
            <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border-hairline)', paddingTop: '14px' }}>
              <div>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Installation Verification
                </div>
                <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                  {verificationStatus === 'verified'
                    ? verificationMsg
                    : verificationStatus === 'failed'
                    ? verificationMsg
                    : 'Verify that your tenant’s public widget endpoint is responsive.'}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {verificationStatus === 'verified' && (
                  <span className="status-pill ready">Verified Live</span>
                )}
                {verificationStatus === 'failed' && (
                  <span className="status-pill failed">Check Failed</span>
                )}

                <button
                  type="button"
                  onClick={handleVerifyEndpoint}
                  disabled={verifying}
                  className="btn btn-secondary"
                  style={{ padding: '6px 12px', fontSize: '12px' }}
                >
                  <RefreshCw size={12} className={verifying ? 'spin' : ''} />
                  <span>{verifying ? 'Pinging...' : 'Verify Endpoint'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Live Interactive Widget Preview */}
        <aside className="calm-panel" style={{ padding: '18px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <div>
              <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.04em' }}>
                Interactive Preview
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                Click the launcher bubble to test the widget live.
              </div>
            </div>

            <button
              onClick={() => setPreviewTheme(previewTheme === 'dark' ? 'light' : 'dark')}
              className="btn-ghost"
              style={{ padding: '4px 8px', fontSize: '11px', gap: '4px' }}
              title="Toggle preview frame theme"
            >
              {previewTheme === 'dark' ? <Sun size={12} /> : <Moon size={12} />}
              <span>{previewTheme === 'dark' ? 'Light Preview' : 'Dark Preview'}</span>
            </button>
          </div>

          {/* Browser Mockup Window */}
          <div
            style={{
              background: previewTheme === 'dark' ? '#0F1218' : '#F4F5F8',
              borderRadius: '10px',
              border: '1px solid var(--border-subtle)',
              height: '520px',
              position: 'relative',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            {/* Browser Chrome Header */}
            <div
              style={{
                background: previewTheme === 'dark' ? '#171B24' : '#E8EBF2',
                padding: '8px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                borderBottom: '1px solid rgba(0,0,0,0.1)'
              }}
            >
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#EF4444' }}></span>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#F59E0B' }}></span>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10B981' }}></span>
              <span
                style={{
                  background: previewTheme === 'dark' ? '#212735' : '#FFFFFF',
                  padding: '2px 10px',
                  borderRadius: '4px',
                  fontSize: '10px',
                  color: previewTheme === 'dark' ? '#94A3B8' : '#64748B',
                  marginLeft: '8px',
                  flex: 1,
                  fontFamily: 'var(--font-mono)'
                }}
              >
                https://your-website.com
              </span>
            </div>

            {/* Mock website content */}
            <div style={{ padding: '20px', opacity: 0.7 }}>
              <div style={{ height: '14px', width: '45%', background: previewTheme === 'dark' ? '#2A3346' : '#CBD5E1', borderRadius: '3px', marginBottom: '12px' }}></div>
              <div style={{ height: '8px', width: '80%', background: previewTheme === 'dark' ? '#1E2535' : '#E2E8F0', borderRadius: '2px', marginBottom: '6px' }}></div>
              <div style={{ height: '8px', width: '60%', background: previewTheme === 'dark' ? '#1E2535' : '#E2E8F0', borderRadius: '2px', marginBottom: '20px' }}></div>
              <div style={{ height: '80px', width: '100%', background: previewTheme === 'dark' ? '#1E2535' : '#E2E8F0', borderRadius: '6px' }}></div>
            </div>

            {/* Floating Chat Window (When Open) */}
            {previewOpen && (
              <div
                style={{
                  position: 'absolute',
                  bottom: '76px',
                  [position === 'left' ? 'left' : 'right']: '16px',
                  width: '336px',
                  height: '420px',
                  background: previewTheme === 'dark' ? '#0B0E14' : '#FFFFFF',
                  border: previewTheme === 'dark' ? '1px solid rgba(255, 255, 255, 0.12)' : '1px solid rgba(0, 0, 0, 0.1)',
                  borderRadius: '16px',
                  boxShadow: '0 20px 48px -10px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05)',
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                  zIndex: 20,
                  animation: 'previewWindowPop 0.22s cubic-bezier(0.16, 1, 0.3, 1)'
                }}
              >
                {/* Chat Header */}
                <div
                  style={{
                    background: previewTheme === 'dark'
                      ? 'linear-gradient(180deg, #161B26 0%, #0F141E 100%)'
                      : 'linear-gradient(180deg, #FFFFFF 0%, #F8FAFC 100%)',
                    borderBottom: previewTheme === 'dark' ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid rgba(0, 0, 0, 0.08)',
                    padding: '12px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexShrink: 0
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                    <div
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '9px',
                        background: `linear-gradient(135deg, ${primaryColor} 0%, #1E1B4B 100%)`,
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#FFFFFF',
                        boxShadow: '0 2px 6px rgba(0,0,0,0.3)'
                      }}
                    >
                      <Bot size={17} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '13px', color: previewTheme === 'dark' ? '#F8FAFC' : '#0F172A', lineHeight: 1.2 }}>
                        AI Assistant
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '2px' }}>
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10B981', boxShadow: '0 0 6px #10B981' }} />
                        <span style={{ fontSize: '10.5px', color: previewTheme === 'dark' ? '#94A3B8' : '#64748B' }}>
                          GraphRAG Active
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => setPreviewOpen(false)}
                    style={{
                      width: '26px',
                      height: '26px',
                      borderRadius: '6px',
                      background: previewTheme === 'dark' ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.05)',
                      border: 'none',
                      color: previewTheme === 'dark' ? '#94A3B8' : '#64748B',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'background 0.15s ease'
                    }}
                    aria-label="Close preview chat"
                  >
                    <X size={14} />
                  </button>
                </div>

                {/* Messages Feed */}
                <div
                  style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    background: previewTheme === 'dark' ? '#0B0E14' : '#F8FAFC'
                  }}
                >
                  {previewMessages.map((msg, idx) => (
                    <div
                      key={idx}
                      style={{
                        alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                        maxWidth: msg.role === 'user' ? '85%' : '92%',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start'
                      }}
                    >
                      <div
                        style={{
                          background: msg.role === 'user'
                            ? primaryColor
                            : (previewTheme === 'dark' ? '#141923' : '#FFFFFF'),
                          color: msg.role === 'user'
                            ? '#FFFFFF'
                            : (previewTheme === 'dark' ? '#F1F5F9' : '#0F172A'),
                          border: msg.role === 'user'
                            ? 'none'
                            : (previewTheme === 'dark' ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(0,0,0,0.08)'),
                          padding: '10px 13px',
                          borderRadius: msg.role === 'user' ? '16px 16px 3px 16px' : '16px 16px 16px 3px',
                          fontSize: '12.5px',
                          lineHeight: 1.55,
                          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
                          wordBreak: 'break-word',
                          width: '100%'
                        }}
                      >
                        {msg.role === 'user' ? (
                          msg.content
                        ) : (
                          <>
                            {msg.isStreaming && !msg.content ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 0' }}>
                                <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'currentColor', opacity: 0.5, animation: 'pulse 1.2s infinite' }} />
                                <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'currentColor', opacity: 0.5, animation: 'pulse 1.2s 0.2s infinite' }} />
                                <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'currentColor', opacity: 0.5, animation: 'pulse 1.2s 0.4s infinite' }} />
                              </div>
                            ) : (
                              <MarkdownMessage
                                content={msg.content}
                                isStreaming={msg.isStreaming}
                              />
                            )}
                          </>
                        )}
                      </div>

                      {/* Clarification prompt indicator */}
                      {msg.role === 'assistant' && msg.metadata?.needs_clarification && (
                        <div
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            marginTop: '5px',
                            fontSize: '10.5px',
                            color: '#F59E0B',
                            background: 'rgba(245, 158, 11, 0.1)',
                            border: '1px solid rgba(245, 158, 11, 0.2)',
                            borderRadius: '5px',
                            padding: '2px 7px'
                          }}
                        >
                          <HelpCircle size={11} />
                          <span>Clarification suggested</span>
                        </div>
                      )}

                      {/* Follow-up suggestion chips */}
                      {msg.role === 'assistant' && Array.isArray(msg.metadata?.suggested_followups) && msg.metadata.suggested_followups.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '6px' }}>
                          {msg.metadata.suggested_followups.map((suggestion, sIdx) => (
                            <button
                              key={sIdx}
                              type="button"
                              onClick={() => handleSendPreviewMessage(null, suggestion)}
                              disabled={previewSending}
                              style={{
                                background: previewTheme === 'dark' ? 'rgba(255, 255, 255, 0.05)' : '#FFFFFF',
                                border: previewTheme === 'dark' ? '1px solid rgba(255, 255, 255, 0.12)' : '1px solid rgba(0, 0, 0, 0.12)',
                                borderRadius: '12px',
                                padding: '3px 9px',
                                fontSize: '10.5px',
                                color: previewTheme === 'dark' ? '#93C5FD' : primaryColor,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                transition: 'all 0.15s ease'
                              }}
                            >
                              <Sparkles size={10} />
                              <span>{suggestion}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>

                {/* Input Composer */}
                <form
                  onSubmit={handleSendPreviewMessage}
                  style={{
                    padding: '9px 11px',
                    borderTop: previewTheme === 'dark' ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid rgba(0, 0, 0, 0.08)',
                    display: 'flex',
                    gap: '6px',
                    background: previewTheme === 'dark' ? '#121620' : '#FAFAFA'
                  }}
                >
                  <input
                    type="text"
                    placeholder="Ask a question..."
                    value={previewInput}
                    onChange={(e) => setPreviewInput(e.target.value)}
                    style={{
                      flex: 1,
                      fontSize: '12px',
                      height: '32px',
                      padding: '0 12px',
                      borderRadius: '8px',
                      background: previewTheme === 'dark' ? '#1A202C' : '#FFFFFF',
                      border: previewTheme === 'dark' ? '1px solid rgba(255, 255, 255, 0.12)' : '1px solid rgba(0, 0, 0, 0.15)',
                      color: previewTheme === 'dark' ? '#F8FAFC' : '#0F172A',
                      outline: 'none'
                    }}
                  />
                  <button
                    type="submit"
                    disabled={!previewInput.trim() || previewSending}
                    style={{
                      background: primaryColor,
                      border: 'none',
                      borderRadius: '8px',
                      color: '#FFFFFF',
                      width: '32px',
                      height: '32px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: !previewInput.trim() || previewSending ? 'not-allowed' : 'pointer',
                      opacity: !previewInput.trim() || previewSending ? 0.5 : 1,
                      transition: 'transform 0.15s ease, opacity 0.15s ease'
                    }}
                    aria-label="Send preview message"
                  >
                    <Send size={13} />
                  </button>
                </form>
              </div>
            )}

            {/* Floating Launcher Button */}
            <div
              style={{
                position: 'absolute',
                bottom: '16px',
                [position === 'left' ? 'left' : 'right']: '16px',
                zIndex: 10
              }}
            >
              <button
                onClick={() => setPreviewOpen(!previewOpen)}
                style={{
                  background: primaryColor,
                  width: '48px',
                  height: '48px',
                  borderRadius: '24px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#FFFFFF',
                  boxShadow: `0 8px 20px -3px ${primaryColor}88, 0 4px 12px rgba(0, 0, 0, 0.3)`,
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  cursor: 'pointer',
                  transition: 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease',
                  position: 'relative'
                }}
                title={previewOpen ? 'Close Assistant' : 'Open Assistant'}
                aria-label="Toggle assistant widget"
              >
                {!previewOpen && (
                  <span
                    style={{
                      position: 'absolute',
                      top: '1px',
                      right: '1px',
                      width: '11px',
                      height: '11px',
                      borderRadius: '50%',
                      background: '#10B981',
                      border: '2px solid #0B0E14',
                      boxShadow: '0 0 0 2px rgba(16, 185, 129, 0.35)'
                    }}
                  />
                )}
                <div
                  style={{
                    transform: previewOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                    transition: 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  {previewOpen ? <X size={18} /> : <MessageSquare size={18} />}
                </div>
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
