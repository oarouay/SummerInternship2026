import React, { useState, useEffect } from 'react';
import { chatbotApi, publicWidgetApi } from '../api/client';
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
  Moon
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
    { role: 'assistant', content: 'Hello! I am your AI assistant. How can I help you today?' }
  ]);
  const [previewInput, setPreviewInput] = useState('');
  const [previewSending, setPreviewSending] = useState(false);

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

  const handleSendPreviewMessage = async (e) => {
    e.preventDefault();
    const text = previewInput.trim();
    if (!text || previewSending) return;

    setPreviewInput('');
    setPreviewSending(true);

    const userMsg = { role: 'user', content: text };
    setPreviewMessages((prev) => [...prev, userMsg]);

    try {
      const history = previewMessages.map((m) => ({ role: m.role, content: m.content }));
      const response = await publicWidgetApi.sendMessage(tenantSlug, text, history);
      setPreviewMessages((prev) => [...prev, { role: 'assistant', content: response.answer || 'Thank you for your inquiry.' }]);
    } catch (err) {
      setPreviewMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${err.message}` }]);
    } finally {
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
                  width: '320px',
                  height: '380px',
                  background: previewTheme === 'dark' ? '#191D24' : '#FFFFFF',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '12px',
                  boxShadow: 'var(--shadow-lg)',
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                  zIndex: 20
                }}
              >
                {/* Chat Header */}
                <div
                  style={{
                    background: primaryColor,
                    color: '#FFFFFF',
                    padding: '12px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Bot size={16} />
                    <span style={{ fontWeight: 600, fontSize: '13px' }}>AI Assistant</span>
                  </div>
                  <button
                    onClick={() => setPreviewOpen(false)}
                    style={{ background: 'transparent', border: 'none', color: '#FFFFFF', cursor: 'pointer', padding: '2px' }}
                    aria-label="Close preview chat"
                  >
                    <X size={14} />
                  </button>
                </div>

                {/* Messages Feed */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {previewMessages.map((msg, idx) => (
                    <div
                      key={idx}
                      style={{
                        alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                        background: msg.role === 'user' ? primaryColor : (previewTheme === 'dark' ? '#222833' : '#F1F5F9'),
                        color: msg.role === 'user' ? '#FFFFFF' : (previewTheme === 'dark' ? '#F2F4F8' : '#1E293B'),
                        padding: '8px 12px',
                        borderRadius: '8px',
                        fontSize: '12px',
                        maxWidth: '85%',
                        lineHeight: 1.45
                      }}
                    >
                      {msg.content}
                    </div>
                  ))}
                  {previewSending && (
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      Assistant is typing...
                    </div>
                  )}
                </div>

                {/* Input Composer */}
                <form
                  onSubmit={handleSendPreviewMessage}
                  style={{
                    padding: '8px',
                    borderTop: '1px solid var(--border-hairline)',
                    display: 'flex',
                    gap: '6px',
                    background: previewTheme === 'dark' ? '#14171E' : '#FAFAFA'
                  }}
                >
                  <input
                    type="text"
                    placeholder="Type a message..."
                    value={previewInput}
                    onChange={(e) => setPreviewInput(e.target.value)}
                    style={{ fontSize: '12px', height: '30px' }}
                  />
                  <button
                    type="submit"
                    disabled={!previewInput.trim() || previewSending}
                    className="btn btn-primary"
                    style={{ background: primaryColor, borderColor: primaryColor, padding: '0 10px', height: '30px' }}
                    aria-label="Send preview message"
                  >
                    <Send size={12} />
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
                  width: '46px',
                  height: '46px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#FFFFFF',
                  boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'transform var(--transition-fast)'
                }}
                title="Toggle Assistant"
                aria-label="Toggle assistant widget"
              >
                {previewOpen ? <X size={20} /> : <MessageSquare size={20} />}
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
