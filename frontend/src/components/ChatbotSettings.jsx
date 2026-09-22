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
  X,
  Settings as SettingsIcon
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
          setWelcomeMessage(data.welcome_message || 'Hello! How can I assist your team today?');
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

  const widgetScriptCode = `<!-- OmniGraph Knowledge Widget -->
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
    <div className="workspace-page" style={{ padding: '20px 32px' }}>
      {/* Workspace Header */}
      <div className="workspace-header" style={{ marginBottom: '16px' }}>
        <div>
          <h1 className="workspace-title">
            <SettingsIcon size={20} color="var(--accent-primary)" />
            <span>Integration & Bot Settings</span>
          </h1>
          <p className="workspace-subtitle">
            Configure the AI assistant persona, validate Gemini LLM credentials, and deploy the embeddable web widget.
          </p>
        </div>

        {/* Sub-workspace Tabs */}
        <div className="segmented-control">
          <button
            onClick={() => setActiveSubTab('persona')}
            className={activeSubTab === 'persona' ? 'active' : ''}
          >
            <Bot size={14} />
            <span>AI Persona & Engine</span>
          </button>
          <button
            onClick={() => setActiveSubTab('widget')}
            className={activeSubTab === 'widget' ? 'active' : ''}
          >
            <Code size={14} />
            <span>Embeddable Widget</span>
          </button>
        </div>
      </div>

      {/* Sub-Tab 1: Persona Tuning & LLM Engine Form */}
      {activeSubTab === 'persona' && (
        <form onSubmit={handleSaveSettings} className="glass-panel" style={{ padding: '20px', maxWidth: '840px' }}>
          {saveSuccess && (
            <div style={{
              background: 'var(--accent-emerald-subtle)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              borderRadius: '8px',
              padding: '10px 14px',
              marginBottom: '20px',
              color: 'var(--accent-emerald)',
              fontSize: '12.5px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <Check size={14} />
              <span>Persona & LLM configuration updated successfully.</span>
            </div>
          )}

          {/* Primary Identity Section */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            <div>
              <label style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '5px', display: 'block' }}>
                Assistant Display Name *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div>
              <label style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '5px', display: 'block' }}>
                Persona Tone & Communication Style
              </label>
              <select value={tone} onChange={(e) => setTone(e.target.value)}>
                <option value="professional">Professional (Formal & Precise)</option>
                <option value="technical">Technical (Code & Architecture Focused)</option>
                <option value="friendly">Friendly (Warm & Explanatory)</option>
                <option value="concise">Concise (Direct Bullet Points)</option>
              </select>
            </div>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '5px', display: 'block' }}>
              Welcome Greeting Message
            </label>
            <input
              type="text"
              required
              value={welcomeMessage}
              onChange={(e) => setWelcomeMessage(e.target.value)}
            />
          </div>

          <div style={{ marginBottom: '14px' }}>
            <label style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '5px', display: 'block' }}>
              Custom System Directives
            </label>
            <textarea
              rows={3}
              placeholder="e.g. You are the AI architecture guide for our enterprise stack. Always highlight security implications..."
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
            />
          </div>

          {/* LLM Engine & Google Gemini API Key Panel */}
          <div style={{
            background: 'var(--bg-surface-2)',
            padding: '14px',
            borderRadius: '8px',
            border: '1px solid var(--border-hairline)',
            marginBottom: '14px'
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
                <span>Google Gemini Credentials & Engine</span>
              </div>

              {/* Status Badge */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {hasCustomApiKey && !clearKeyRequested ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="status-pill indexed">
                      Custom Key ({apiKeyPreview})
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
                    <span className="status-pill processing">
                      Reverts on Save
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
                  <span className="status-pill indexed" style={{ color: '#38BDF8', borderColor: 'rgba(56, 189, 248, 0.3)', background: 'rgba(56, 189, 248, 0.08)' }}>
                    System Key Active
                  </span>
                ) : (
                  <span className="status-pill" style={{ background: 'var(--bg-surface-3)', color: 'var(--text-muted)' }}>
                    Mock Mode
                  </span>
                )}
              </div>
            </div>

            {/* API Key Input Row */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <input
                  type={showApiKey ? 'text' : 'password'}
                  placeholder={hasCustomApiKey && !clearKeyRequested ? 'Enter new API key to rotate...' : 'Enter Gemini API Key (e.g. AIzaSy...)'}
                  value={geminiApiKey}
                  onChange={(e) => {
                    setGeminiApiKey(e.target.value);
                    if (clearKeyRequested) setClearKeyRequested(false);
                    if (validationResult) setValidationResult(null);
                  }}
                  style={{
                    fontFamily: showApiKey ? 'var(--font-mono)' : 'inherit',
                    paddingRight: '36px',
                    fontSize: '12px'
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
                  fontSize: '12px',
                  whiteSpace: 'nowrap'
                }}
              >
                <Cpu size={13} />
                <span>{validatingKey ? 'Testing...' : 'Test Connection'}</span>
              </button>
            </div>

            {/* Validation Banner */}
            {validationResult && (
              <div style={{
                background: validationResult.valid ? 'var(--accent-emerald-subtle)' : 'var(--accent-rose-subtle)',
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

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              <span>
                Multi-tenant row-level isolation guarantees private API key storage.
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
                <span>Google AI Studio Key</span>
                <ExternalLink size={10} />
              </a>
            </div>
          </div>

          {/* Hyperparameters Configuration */}
          <div style={{
            background: 'var(--bg-surface-2)',
            padding: '14px',
            borderRadius: '8px',
            border: '1px solid var(--border-hairline)',
            marginBottom: '14px'
          }}>
            <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '5px' }}>
              <Sliders size={13} />
              <span>Default Retrieval Hyperparameters</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', marginBottom: '5px' }}>
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
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', marginBottom: '5px' }}>
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
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', marginBottom: '5px' }}>
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
              style={{ padding: '8px 20px', fontSize: '12.5px' }}
            >
              <Save size={14} />
              <span>{saving ? 'Saving...' : 'Save Configuration'}</span>
            </button>
          </div>
        </form>
      )}

      {/* Sub-Tab 2: Web Widget Embed Generator */}
      {activeSubTab === 'widget' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '24px' }}>
          <div className="glass-panel" style={{ padding: '24px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '6px' }}>
              Micro-Frontend Script Embed
            </h3>
            <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginBottom: '18px', lineHeight: 1.5 }}>
              Paste this script tag before the closing <code>&lt;/body&gt;</code> tag on your web platform. It mounts an isolated Shadow DOM chat widget.
            </p>

            <div style={{ position: 'relative', marginBottom: '20px' }}>
              <pre style={{
                background: 'var(--bg-surface-2)',
                border: '1px solid var(--border-hairline)',
                borderRadius: '8px',
                padding: '16px',
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
                  top: '12px',
                  right: '12px',
                  fontSize: '11px',
                  padding: '4px 10px'
                }}
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
              <div>
                <label style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '5px', display: 'block' }}>
                  Widget Accent Color
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
                <label style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '5px', display: 'block' }}>
                  Screen Float Position
                </label>
                <select value={position} onChange={(e) => setPosition(e.target.value)}>
                  <option value="right">Bottom Right (Standard)</option>
                  <option value="left">Bottom Left</option>
                </select>
              </div>
            </div>

            <div style={{ background: 'var(--bg-surface-2)', padding: '12px 14px', borderRadius: '8px', fontSize: '11.5px', color: 'var(--text-muted)', border: '1px solid var(--border-hairline)' }}>
              <strong style={{ color: 'var(--text-primary)' }}>Shadow DOM Protected:</strong> Host CSS resets and frameworks cannot bleed into or affect the styling of this embeddable chat bubble.
            </div>
          </div>

          {/* Right Column: Live Mockup Frame */}
          <div className="glass-panel" style={{ padding: '18px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '12px', fontWeight: 600 }}>
              Live Host Preview
            </div>

            <div style={{
              flex: 1,
              background: '#0B0F17',
              borderRadius: '8px',
              position: 'relative',
              overflow: 'hidden',
              minHeight: '380px',
              display: 'flex',
              flexDirection: 'column',
              border: '1px solid var(--border-hairline)'
            }}>
              {/* Browser chrome header */}
              <div style={{ background: '#131926', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#EF4444' }}></span>
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#F59E0B' }}></span>
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#10B981' }}></span>
                <span style={{ background: '#1E293B', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', color: '#94A3B8', marginLeft: '6px', flex: 1, fontFamily: 'var(--font-mono)' }}>
                  https://acme-cloud.io/dashboard
                </span>
              </div>

              {/* Wireframe mock layout */}
              <div style={{ padding: '20px' }}>
                <div style={{ height: '12px', width: '40%', background: '#1E293B', borderRadius: '3px', marginBottom: '10px' }}></div>
                <div style={{ height: '7px', width: '85%', background: '#141E33', borderRadius: '2px', marginBottom: '6px' }}></div>
                <div style={{ height: '7px', width: '65%', background: '#141E33', borderRadius: '2px', marginBottom: '16px' }}></div>
                <div style={{ height: '70px', width: '100%', background: '#141E33', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)' }}></div>
              </div>

              {/* Floating Widget Mockup */}
              <div style={{
                position: 'absolute',
                bottom: '16px',
                [position === 'left' ? 'left' : 'right']: '16px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}>
                <div style={{
                  background: primaryColor,
                  width: '44px',
                  height: '44px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#FFFFFF',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                  position: 'relative',
                  cursor: 'pointer'
                }}>
                  <MessageSquare size={19} />
                  <span style={{
                    position: 'absolute',
                    top: '0px',
                    right: '0px',
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    background: '#10B981',
                    border: '2px solid #0B0F17'
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
