import React, { useState, useEffect } from 'react';
import { chatbotApi } from '../api/client';
import { 
  Bot, 
  Code, 
  Copy, 
  Check, 
  Sliders, 
  Save, 
  Sparkles, 
  ShieldCheck,
  MessageSquare,
  Key,
  Eye,
  EyeOff,
  AlertCircle,
  ExternalLink,
  Cpu,
  X
} from 'lucide-react';

export default function ChatbotSettings({ tenant }) {
  const [activeSubTab, setActiveSubTab] = useState('persona'); // 'persona' or 'widget'
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [copied, setCopied] = useState(false);

  // Persona configuration
  const [name, setName] = useState('OmniGraph Assistant');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [welcomeMessage, setWelcomeMessage] = useState('Hello! How can I assist your team today?');
  const [tone, setTone] = useState('professional');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [defaultTopK, setDefaultTopK] = useState(4);
  const [defaultMaxHops, setDefaultMaxHops] = useState(2);
  const [temperature, setTemperature] = useState(0.2);

  // Gemini API Key & Engine State
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [hasCustomApiKey, setHasCustomApiKey] = useState(false);
  const [apiKeyPreview, setApiKeyPreview] = useState(null);
  const [systemKeyConfigured, setSystemKeyConfigured] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [clearKeyRequested, setClearKeyRequested] = useState(false);
  const [validatingKey, setValidatingKey] = useState(false);
  const [validationResult, setValidationResult] = useState(null);

  // Widget customizer
  const [primaryColor, setPrimaryColor] = useState('#5E6AD2');
  const [position, setPosition] = useState('right');

  const tenantSlug = tenant?.slug || 'your-tenant-slug';

  useEffect(() => {
    const fetchSettings = async () => {
      setLoading(true);
      try {
        const data = await chatbotApi.getSettings();
        if (data) {
          setName(data.name || 'OmniGraph Assistant');
          setAvatarUrl(data.avatar_url || '');
          setWelcomeMessage(data.welcome_message || '');
          setTone(data.tone || 'professional');
          setSystemPrompt(data.system_prompt || '');
          setDefaultTopK(data.default_top_k || 4);
          setDefaultMaxHops(data.default_max_hops || 2);
          setTemperature(data.temperature ?? 0.2);
          setHasCustomApiKey(data.has_custom_api_key || false);
          setApiKeyPreview(data.gemini_api_key_preview || null);
          setSystemKeyConfigured(data.system_api_key_configured || false);
        }
      } catch (err) {
        console.error('Error fetching chatbot settings:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, []);

  const handleTestKey = async () => {
    setValidatingKey(true);
    setValidationResult(null);
    try {
      const keyToTest = geminiApiKey.trim() || undefined;
      const res = await chatbotApi.validateGeminiKey(keyToTest);
      setValidationResult(res);
    } catch (err) {
      setValidationResult({ valid: false, message: err.message || 'Validation request failed' });
    } finally {
      setValidatingKey(false);
    }
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveSuccess(false);
    try {
      const payload = {
        name,
        avatar_url: avatarUrl || null,
        welcome_message: welcomeMessage,
        tone,
        system_prompt: systemPrompt || null,
        default_top_k: defaultTopK,
        default_max_hops: defaultMaxHops,
        temperature,
      };

      if (clearKeyRequested) {
        payload.gemini_api_key = '';
      } else if (geminiApiKey.trim()) {
        payload.gemini_api_key = geminiApiKey.trim();
      }

      const updated = await chatbotApi.updateSettings(payload);
      if (updated) {
        setHasCustomApiKey(updated.has_custom_api_key || false);
        setApiKeyPreview(updated.gemini_api_key_preview || null);
        setSystemKeyConfigured(updated.system_api_key_configured || false);
        setGeminiApiKey('');
        setClearKeyRequested(false);
      }

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (err) {
      alert('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };


  const widgetScriptCode = `<!-- OmniGraph GraphRAG Embed Widget -->
<script 
  src="${window.location.origin}/widget.js" 
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

  return (
    <div style={{ padding: '28px 36px', maxWidth: '1100px', margin: '0 auto', width: '100%' }}>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 600 }}>Persona Tuning & Widget Deployment</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '4px' }}>
          Tune model instructions, response temperature, and generate an isolated Shadow DOM embed tag for client websites.
        </p>
      </div>

      {/* Segmented Controller */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
        <div className="segmented-control">
          <button
            onClick={() => setActiveSubTab('persona')}
            className={activeSubTab === 'persona' ? 'active' : ''}
          >
            <Bot size={13} />
            <span>Persona & Parameters</span>
          </button>
          <button
            onClick={() => setActiveSubTab('widget')}
            className={activeSubTab === 'widget' ? 'active' : ''}
          >
            <Code size={13} />
            <span>Embed Snippet</span>
          </button>
        </div>
      </div>

      {/* Sub-Tab 1: Persona Tuning Form */}
      {activeSubTab === 'persona' && (
        <form onSubmit={handleSaveSettings} className="hairline-card" style={{ padding: '24px', maxWidth: '800px' }}>
          {saveSuccess && (
            <div style={{
              background: 'var(--accent-emerald-subtle)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              borderRadius: '6px',
              padding: '10px 14px',
              marginBottom: '18px',
              color: 'var(--accent-emerald)',
              fontSize: '12.5px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <Check size={14} />
              <span>Persona configuration saved successfully.</span>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            <div>
              <label style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>
                Assistant Display Name
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div>
              <label style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>
                Tone & Communication Style
              </label>
              <select value={tone} onChange={(e) => setTone(e.target.value)}>
                <option value="professional">Professional (Formal & Precise)</option>
                <option value="technical">Technical (In-depth & Code-focused)</option>
                <option value="friendly">Friendly (Warm & Explanatory)</option>
                <option value="concise">Concise (Direct Bullet Points)</option>
              </select>
            </div>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>
              Welcome Greeting Message
            </label>
            <input
              type="text"
              required
              value={welcomeMessage}
              onChange={(e) => setWelcomeMessage(e.target.value)}
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>
              Custom System Directives (Gemini 3.8 Flash)
            </label>
            <textarea
              rows={4}
              placeholder="e.g. You are the AI documentation specialist for our platform. Always highlight security implications..."
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
            />
          </div>

          {/* LLM Engine & Google Gemini API Key Card */}
          <div style={{
            background: 'var(--bg-surface-2)',
            padding: '16px',
            borderRadius: '8px',
            border: '1px solid var(--border-hairline)',
            marginBottom: '20px'
          }}>
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between',
              marginBottom: '12px'
            }}>
              <div style={{ 
                fontSize: '11px', 
                textTransform: 'uppercase', 
                color: 'var(--text-muted)', 
                fontWeight: 600, 
                display: 'flex', 
                alignItems: 'center', 
                gap: '6px' 
              }}>
                <Key size={13} style={{ color: 'var(--accent-primary)' }} />
                <span>Google Gemini AI Engine & API Key</span>
              </div>

              {/* Status Badge */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {hasCustomApiKey && !clearKeyRequested ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{
                      fontSize: '11px',
                      color: 'var(--accent-emerald)',
                      background: 'rgba(16, 185, 129, 0.08)',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      border: '1px solid rgba(16, 185, 129, 0.25)',
                      fontFamily: 'monospace'
                    }}>
                      ● Custom Key ({apiKeyPreview})
                    </span>
                    <button
                      type="button"
                      onClick={() => setClearKeyRequested(true)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-muted)',
                        fontSize: '11px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '3px',
                        textDecoration: 'underline'
                      }}
                      title="Revert to server-wide default key"
                    >
                      <X size={11} /> Revert to system
                    </button>
                  </div>
                ) : clearKeyRequested ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{
                      fontSize: '11px',
                      color: '#F59E0B',
                      background: 'rgba(245, 158, 11, 0.08)',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      border: '1px solid rgba(245, 158, 11, 0.25)'
                    }}>
                      ● Will revert to .env on Save
                    </span>
                    <button
                      type="button"
                      onClick={() => setClearKeyRequested(false)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-muted)',
                        fontSize: '11px',
                        cursor: 'pointer'
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : systemKeyConfigured ? (
                  <span style={{
                    fontSize: '11px',
                    color: 'var(--accent-cyan)',
                    background: 'rgba(6, 182, 212, 0.08)',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    border: '1px solid rgba(6, 182, 212, 0.25)'
                  }}>
                    ● Server Default (.env) Active
                  </span>
                ) : (
                  <span style={{
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    background: 'var(--bg-surface-3)',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    border: '1px solid var(--border-hairline)'
                  }}>
                    ○ Mock Mode (No Key Set)
                  </span>
                )}
              </div>
            </div>

            {/* Input Row */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <input
                  type={showApiKey ? 'text' : 'password'}
                  placeholder={hasCustomApiKey && !clearKeyRequested ? 'Enter new API key to rotate existing...' : 'Enter Gemini API Key (e.g. AIzaSy...)'}
                  value={geminiApiKey}
                  onChange={(e) => {
                    setGeminiApiKey(e.target.value);
                    if (clearKeyRequested) setClearKeyRequested(false);
                    if (validationResult) setValidationResult(null);
                  }}
                  style={{
                    fontFamily: showApiKey ? 'monospace' : 'inherit',
                    paddingRight: '36px',
                    fontSize: '12px',
                    width: '100%'
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    padding: '2px'
                  }}
                  title={showApiKey ? 'Hide Key' : 'Show Key'}
                >
                  {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>

              <button
                type="button"
                onClick={handleTestKey}
                disabled={validatingKey || (!geminiApiKey.trim() && !hasCustomApiKey && !systemKeyConfigured)}
                className="btn btn-secondary"
                style={{ 
                  padding: '7px 14px', 
                  fontSize: '11.5px',
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <Cpu size={13} />
                <span>{validatingKey ? 'Verifying...' : 'Test Connection'}</span>
              </button>
            </div>

            {/* Live Validation Result Banner */}
            {validationResult && (
              <div style={{
                background: validationResult.valid ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                border: `1px solid ${validationResult.valid ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                borderRadius: '6px',
                padding: '8px 12px',
                marginBottom: '8px',
                fontSize: '11.5px',
                color: validationResult.valid ? 'var(--accent-emerald)' : '#EF4444',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}>
                {validationResult.valid ? <Check size={13} /> : <AlertCircle size={13} />}
                <span>{validationResult.message}</span>
              </div>
            )}

            {/* Helper Caption */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              <span>
                Tenant keys are securely stored and isolated. Leave empty to use server <code style={{ color: 'var(--text-secondary)' }}>.env</code> fallback.
              </span>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                style={{
                  color: 'var(--accent-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                  textDecoration: 'none'
                }}
              >
                <span>Get API key from Google AI Studio</span>
                <ExternalLink size={10} />
              </a>
            </div>
          </div>

          {/* Hyperparameters Box */}
          <div style={{
            background: 'var(--bg-surface-2)',
            padding: '16px',
            borderRadius: '8px',
            border: '1px solid var(--border-hairline)',
            marginBottom: '20px'
          }}>
            <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '5px' }}>
              <Sliders size={13} />
              <span>Default Retrieval Hyperparameters</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', marginBottom: '4px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Vector Top-K:</span>
                  <strong className="tabular-nums" style={{ color: 'var(--accent-primary)' }}>{defaultTopK}</strong>
                </div>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={defaultTopK}
                  onChange={(e) => setDefaultTopK(parseInt(e.target.value))}
                />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', marginBottom: '4px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Graph Hops:</span>
                  <strong className="tabular-nums" style={{ color: 'var(--accent-cyan)' }}>{defaultMaxHops}</strong>
                </div>
                <input
                  type="range"
                  min={1}
                  max={3}
                  value={defaultMaxHops}
                  onChange={(e) => setDefaultMaxHops(parseInt(e.target.value))}
                />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', marginBottom: '4px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Temperature:</span>
                  <strong className="tabular-nums" style={{ color: 'var(--accent-emerald)' }}>{temperature.toFixed(2)}</strong>
                </div>
                <input
                  type="range"
                  min={0.0}
                  max={1.0}
                  step={0.05}
                  value={temperature}
                  onChange={(e) => setTemperature(parseFloat(e.target.value))}
                />
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="submit"
              disabled={saving}
              className="btn btn-primary"
              style={{ padding: '8px 18px', fontSize: '12.5px' }}
            >
              <Save size={14} />
              <span>{saving ? 'Saving...' : 'Save Configuration'}</span>
            </button>
          </div>
        </form>
      )}

      {/* Sub-Tab 2: Widget Embed Generator */}
      {activeSubTab === 'widget' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '24px' }}>
          <div className="hairline-card" style={{ padding: '24px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '6px' }}>
              Micro-Frontend Script Snippet
            </h3>
            <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginBottom: '16px' }}>
              Embed right before the closing <code>&lt;/body&gt;</code> tag of your website or web application.
            </p>

            <div style={{ position: 'relative', marginBottom: '20px' }}>
              <pre style={{
                background: 'var(--bg-surface-2)',
                border: '1px solid var(--border-hairline)',
                borderRadius: '8px',
                padding: '14px 16px',
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                color: 'var(--text-primary)',
                overflowX: 'auto',
                lineHeight: 1.6
              }}>
                {widgetScriptCode}
              </pre>

              <button
                onClick={handleCopyCode}
                className="btn btn-primary"
                style={{
                  position: 'absolute',
                  top: '10px',
                  right: '10px',
                  fontSize: '11px',
                  padding: '4px 8px'
                }}
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '16px' }}>
              <div>
                <label style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>
                  Accent Theme Color
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    style={{ width: '36px', height: '32px', padding: '0', border: 'none', borderRadius: '4px', cursor: 'pointer', background: 'transparent' }}
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
                <label style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>
                  Screen Float Anchor
                </label>
                <select value={position} onChange={(e) => setPosition(e.target.value)}>
                  <option value="right">Bottom Right (Default)</option>
                  <option value="left">Bottom Left</option>
                </select>
              </div>
            </div>

            <div style={{ background: 'var(--bg-surface-2)', padding: '12px', borderRadius: '6px', fontSize: '11.5px', color: 'var(--text-muted)' }}>
              <strong style={{ color: 'var(--text-primary)' }}>Shadow DOM Protected:</strong> Host website CSS styles (e.g. Tailwind resets, global styles) will never bleed into or break this widget.
            </div>
          </div>

          {/* Right Column: Live Mockup Frame */}
          <div className="hairline-card" style={{ padding: '16px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '10px' }}>
              Host Website Preview
            </div>

            <div style={{
              flex: 1,
              background: '#FFFFFF',
              borderRadius: '8px',
              position: 'relative',
              overflow: 'hidden',
              minHeight: '380px',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.08)'
            }}>
              <div style={{ background: '#F1F5F9', padding: '6px 10px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#CBD5E1' }}></span>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#CBD5E1' }}></span>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#CBD5E1' }}></span>
                <span style={{ background: '#FFFFFF', padding: '1px 6px', borderRadius: '3px', fontSize: '9px', color: '#94A3B8', marginLeft: '6px', flex: 1 }}>
                  https://client-site.com
                </span>
              </div>

              <div style={{ padding: '16px' }}>
                <div style={{ height: '10px', width: '50%', background: '#E2E8F0', borderRadius: '3px', marginBottom: '8px' }}></div>
                <div style={{ height: '6px', width: '80%', background: '#F1F5F9', borderRadius: '2px', marginBottom: '4px' }}></div>
                <div style={{ height: '6px', width: '65%', background: '#F1F5F9', borderRadius: '2px', marginBottom: '14px' }}></div>
                <div style={{ height: '50px', width: '100%', background: '#F8FAFC', borderRadius: '6px' }}></div>
              </div>

              {/* Mock Floating Widget Bubble */}
              <div style={{
                position: 'absolute',
                bottom: '12px',
                [position === 'left' ? 'left' : 'right']: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}>
                <div style={{
                  background: primaryColor,
                  width: '42px',
                  height: '42px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#FFFFFF',
                  boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
                  position: 'relative'
                }}>
                  <MessageSquare size={18} />
                  <span style={{
                    position: 'absolute',
                    top: '0px',
                    right: '0px',
                    width: '9px',
                    height: '9px',
                    borderRadius: '50%',
                    background: '#10B981',
                    border: '1.5px solid #FFFFFF'
                  }}></span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
