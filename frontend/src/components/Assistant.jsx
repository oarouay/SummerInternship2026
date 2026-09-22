import React, { useState, useEffect } from 'react';
import { chatbotApi, ragApi } from '../api/client';
import { 
  Sliders, 
  Save, 
  Sparkles, 
  Key, 
  AlertCircle, 
  Check, 
  RefreshCw, 
  Send, 
  Bot, 
  HelpCircle,
  ShieldCheck,
  CheckCircle2
} from 'lucide-react';

export default function Assistant({ tenant }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState('idle'); // 'idle' | 'saved' | 'error'
  const [saveError, setSaveError] = useState('');

  // Initial fetched state for dirty tracking
  const [initialData, setInitialData] = useState(null);

  // Form states
  const [name, setName] = useState('OmniGraph Assistant');
  const [welcomeMessage, setWelcomeMessage] = useState('Hello! How can I assist your team today?');
  const [tone, setTone] = useState('professional');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [defaultTopK, setDefaultTopK] = useState(4);
  const [defaultMaxHops, setDefaultMaxHops] = useState(2);
  const [temperature, setTemperature] = useState(0.2);

  // Gemini API Key State
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [hasCustomApiKey, setHasCustomApiKey] = useState(false);
  const [apiKeyPreview, setApiKeyPreview] = useState(null);
  const [systemKeyConfigured, setSystemKeyConfigured] = useState(false);
  const [clearKeyRequested, setClearKeyRequested] = useState(false);
  const [validatingKey, setValidatingKey] = useState(false);
  const [validationResult, setValidationResult] = useState(null);

  // Test Panel state
  const [testQuery, setTestQuery] = useState('');
  const [testingQuery, setTestingQuery] = useState(false);
  const [testResponse, setTestResponse] = useState(null);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const data = await chatbotApi.getSettings();
      if (data) {
        setName(data.name || 'OmniGraph Assistant');
        setWelcomeMessage(data.welcome_message || 'Hello! How can I assist your team today?');
        setTone(data.tone || 'professional');
        setSystemPrompt(data.system_prompt || '');
        setDefaultTopK(data.default_top_k || 4);
        setDefaultMaxHops(data.default_max_hops || 2);
        setTemperature(data.temperature ?? 0.2);
        setHasCustomApiKey(data.has_custom_api_key || false);
        setApiKeyPreview(data.gemini_api_key_preview || null);
        setSystemKeyConfigured(data.system_api_key_configured || false);

        setInitialData({
          name: data.name || 'OmniGraph Assistant',
          welcomeMessage: data.welcome_message || 'Hello! How can I assist your team today?',
          tone: data.tone || 'professional',
          systemPrompt: data.system_prompt || '',
          defaultTopK: data.default_top_k || 4,
          defaultMaxHops: data.default_max_hops || 2,
          temperature: data.temperature ?? 0.2,
        });
      }
    } catch (err) {
      console.error('Error fetching chatbot settings:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  // Dirty state detection
  const isDirty = initialData && (
    name !== initialData.name ||
    welcomeMessage !== initialData.welcomeMessage ||
    tone !== initialData.tone ||
    systemPrompt !== initialData.systemPrompt ||
    defaultTopK !== initialData.defaultTopK ||
    defaultMaxHops !== initialData.defaultMaxHops ||
    temperature !== initialData.temperature ||
    Boolean(geminiApiKey.trim()) ||
    clearKeyRequested
  );

  const handleDiscard = () => {
    if (!initialData) return;
    setName(initialData.name);
    setWelcomeMessage(initialData.welcomeMessage);
    setTone(initialData.tone);
    setSystemPrompt(initialData.systemPrompt);
    setDefaultTopK(initialData.defaultTopK);
    setDefaultMaxHops(initialData.defaultMaxHops);
    setTemperature(initialData.temperature);
    setGeminiApiKey('');
    setClearKeyRequested(false);
    setValidationResult(null);
  };

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
    setSaveStatus('idle');
    setSaveError('');
    try {
      const payload = {
        name,
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
        setInitialData({
          name: updated.name,
          welcomeMessage: updated.welcome_message,
          tone: updated.tone,
          systemPrompt: updated.system_prompt || '',
          defaultTopK: updated.default_top_k,
          defaultMaxHops: updated.default_max_hops,
          temperature: updated.temperature,
        });
      }

      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (err) {
      setSaveStatus('error');
      setSaveError(err.message || 'Failed to persist configuration');
    } finally {
      setSaving(false);
    }
  };

  const handleRunTestQuery = async (e) => {
    e.preventDefault();
    if (!testQuery.trim() || testingQuery) return;
    setTestingQuery(true);
    setTestResponse(null);
    try {
      const res = await ragApi.query(testQuery.trim(), defaultTopK, defaultMaxHops, temperature);
      setTestResponse(res);
    } catch (err) {
      setTestResponse({ answer: `Error running test query: ${err.message}` });
    } finally {
      setTestingQuery(false);
    }
  };

  return (
    <div className="workspace-page">
      {/* Workspace Header */}
      <div className="workspace-header">
        <div>
          <h1 className="workspace-title">
            <Sliders size={20} color="var(--accent-primary)" />
            <span>Assistant Configuration & Tuning</span>
          </h1>
          <p className="workspace-subtitle">
            Configure persona identity, system directives, model credentials, and retrieval hyperparameters.
          </p>
        </div>
      </div>

      {/* Main Two-Column Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 380px', gap: '24px', alignItems: 'start' }}>
        {/* Left Column: Settings Sections */}
        <form onSubmit={handleSaveSettings} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Section 1: Identity & Tone */}
          <div className="calm-panel" style={{ padding: '20px' }}>
            <h2 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '14px' }}>
              1. Assistant Identity
            </h2>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '14px' }}>
              <div>
                <label>Assistant Display Name *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. OmniGraph Assistant"
                />
              </div>

              <div>
                <label>Conversational Tone</label>
                <select value={tone} onChange={(e) => setTone(e.target.value)}>
                  <option value="professional">Professional (Enterprise Balanced)</option>
                  <option value="technical">Technical (Engineering & Analytical)</option>
                  <option value="concise">Concise (Direct & Bulleted)</option>
                  <option value="friendly">Friendly (Approachable & Helpful)</option>
                </select>
              </div>
            </div>

            <div>
              <label>Welcome Greeting</label>
              <input
                type="text"
                required
                value={welcomeMessage}
                onChange={(e) => setWelcomeMessage(e.target.value)}
                placeholder="Initial greeting shown to new users"
              />
            </div>
          </div>

          {/* Section 2: Behavioral Directives */}
          <div className="calm-panel" style={{ padding: '20px' }}>
            <h2 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>
              2. System Directives & Instructions
            </h2>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
              Guides answer formatting, domain constraints, and response structure.
            </p>

            <textarea
              rows={4}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="e.g. You are the AI architecture guide for our enterprise stack. Always highlight security implications and cite relevant documentation passages..."
            />

            <div style={{ background: 'var(--bg-surface-2)', padding: '10px 12px', borderRadius: '8px', fontSize: '11.5px', color: 'var(--text-secondary)', marginTop: '10px' }}>
              <strong>Boundary Notice:</strong> System directives influence language and formatting. They do not alter row-level security or tenant data isolation boundaries.
            </div>
          </div>

          {/* Section 3: Model Connection & API Credentials */}
          <div className="calm-panel" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div>
                <h2 style={{ fontSize: '14px', fontWeight: 600 }}>3. Google Gemini Model Connection</h2>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Manage Gemini LLM generation credentials
                </p>
              </div>

              {hasCustomApiKey ? (
                <span className="status-pill ready">Tenant Override Active</span>
              ) : systemKeyConfigured ? (
                <span className="status-pill ready">System Managed Key Active</span>
              ) : (
                <span className="status-pill failed">Missing Key</span>
              )}
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '10px' }}>
              <input
                type="password"
                placeholder={hasCustomApiKey && apiKeyPreview ? `Configured (${apiKeyPreview})` : "Enter Google Gemini API Key (AIzaSy...)"}
                value={geminiApiKey}
                onChange={(e) => setGeminiApiKey(e.target.value)}
                style={{ flex: 1 }}
              />

              <button
                type="button"
                onClick={handleTestKey}
                disabled={validatingKey}
                className="btn btn-secondary"
                style={{ padding: '8px 12px' }}
              >
                {validatingKey ? <RefreshCw size={13} className="spin" /> : <Key size={13} />}
                <span>Validate Key</span>
              </button>

              {hasCustomApiKey && (
                <button
                  type="button"
                  onClick={() => setClearKeyRequested(true)}
                  className="btn btn-danger"
                  style={{ padding: '8px 12px' }}
                  title="Remove tenant custom key and revert to system default"
                >
                  Remove Key
                </button>
              )}
            </div>

            {clearKeyRequested && (
              <div style={{ fontSize: '11.5px', color: 'var(--accent-amber-text)', marginBottom: '8px' }}>
                Key removal pending. Click "Save changes" below to confirm and revert to system managed key.
              </div>
            )}

            {validationResult && (
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  fontSize: '11.5px',
                  background: validationResult.valid ? 'var(--accent-emerald-subtle)' : 'var(--accent-rose-subtle)',
                  color: validationResult.valid ? 'var(--accent-emerald-text)' : 'var(--accent-rose-text)',
                  border: `1px solid ${validationResult.valid ? 'var(--accent-emerald-border)' : 'var(--accent-rose-border)'}`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                {validationResult.valid ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                <span>{validationResult.message}</span>
              </div>
            )}
          </div>

          {/* Section 4: Advanced Retrieval Hyperparameters */}
          <div className="calm-panel" style={{ padding: '20px' }}>
            <h2 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>
              4. Retrieval & Synthesis Hyperparameters
            </h2>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
              Calibrate passage retrieval depth, graph traversal radius, and answer creativity.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Top-K */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                    Passages to Retrieve (Top-K Chunks)
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={defaultTopK}
                      onChange={(e) => setDefaultTopK(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                      style={{ width: '60px', height: '28px', padding: '2px 6px', textAlign: 'center', fontSize: '12px' }}
                    />
                  </div>
                </div>
                <input
                  type="range"
                  min={1}
                  max={15}
                  value={defaultTopK}
                  onChange={(e) => setDefaultTopK(parseInt(e.target.value, 10))}
                  style={{ width: '100%' }}
                />
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Higher values include more context passages but increase token overhead and latency.
                </div>
              </div>

              {/* Max Hops */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                    Connection Depth (Graph Traversal Hops)
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="number"
                      min={1}
                      max={3}
                      value={defaultMaxHops}
                      onChange={(e) => setDefaultMaxHops(Math.max(1, Math.min(3, parseInt(e.target.value) || 1)))}
                      style={{ width: '60px', height: '28px', padding: '2px 6px', textAlign: 'center', fontSize: '12px' }}
                    />
                  </div>
                </div>
                <input
                  type="range"
                  min={1}
                  max={3}
                  value={defaultMaxHops}
                  onChange={(e) => setDefaultMaxHops(parseInt(e.target.value, 10))}
                  style={{ width: '100%' }}
                />
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Number of relationship hops queried in Neo4j from detected seed entities.
                </div>
              </div>

              {/* Temperature */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                    Response Variability (Temperature)
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      value={temperature}
                      onChange={(e) => setTemperature(parseFloat(e.target.value) || 0)}
                      style={{ width: '60px', height: '28px', padding: '2px 6px', textAlign: 'center', fontSize: '12px' }}
                    />
                  </div>
                </div>
                <input
                  type="range"
                  min={0.0}
                  max={1.0}
                  step={0.05}
                  value={temperature}
                  onChange={(e) => setTemperature(parseFloat(e.target.value))}
                  style={{ width: '100%' }}
                />
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Lower temperature (0.1–0.3) produces deterministic, factual answers grounded in evidence.
                </div>
              </div>
            </div>
          </div>

          {/* Sticky Save Action Bar */}
          <div
            className="calm-panel"
            style={{
              padding: '12px 18px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              position: 'sticky',
              bottom: '16px',
              background: 'var(--bg-surface-1)',
              boxShadow: 'var(--shadow-md)',
              zIndex: 30
            }}
          >
            <div>
              {saveStatus === 'saved' ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--accent-emerald-text)', fontSize: '12px', fontWeight: 600 }}>
                  <Check size={14} />
                  <span>Configuration saved successfully</span>
                </div>
              ) : saveStatus === 'error' ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--accent-rose-text)', fontSize: '12px' }}>
                  <AlertCircle size={14} />
                  <span>{saveError || 'Save failed'}</span>
                </div>
              ) : isDirty ? (
                <div style={{ fontSize: '12px', color: 'var(--accent-amber-text)', fontWeight: 500 }}>
                  ● You have unsaved changes
                </div>
              ) : (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  All changes saved
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={handleDiscard}
                disabled={!isDirty || saving}
                className="btn btn-secondary"
              >
                Discard
              </button>
              <button
                type="submit"
                disabled={!isDirty || saving}
                className="btn btn-primary"
              >
                <Save size={13} />
                <span>{saving ? 'Saving...' : 'Save Configuration'}</span>
              </button>
            </div>
          </div>
        </form>

        {/* Right Column: Live Configuration Test Panel */}
        <aside className="calm-panel" style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.04em' }}>
              Live Test Panel
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
              Tests active saved configuration against your knowledge base.
            </div>
          </div>

          <form onSubmit={handleRunTestQuery} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <textarea
              rows={3}
              placeholder="Ask a test question to verify response quality and tone..."
              value={testQuery}
              onChange={(e) => setTestQuery(e.target.value)}
              style={{ fontSize: '12.5px' }}
            />
            <button
              type="submit"
              disabled={!testQuery.trim() || testingQuery}
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center' }}
            >
              {testingQuery ? (
                <>
                  <RefreshCw size={13} className="spin" />
                  <span>Synthesizing...</span>
                </>
              ) : (
                <>
                  <Send size={13} />
                  <span>Test Configuration</span>
                </>
              )}
            </button>
          </form>

          {/* Test Response Output */}
          <div style={{ borderTop: '1px solid var(--border-hairline)', paddingTop: '12px' }}>
            <div style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Synthesized Output:
            </div>

            {testResponse ? (
              <div style={{ background: 'var(--bg-surface-2)', padding: '12px', borderRadius: '8px', fontSize: '12.5px', color: 'var(--text-primary)', lineHeight: 1.6, maxHeight: '300px', overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
                {testResponse.answer}
              </div>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center', padding: '24px 0' }}>
                Submit a test inquiry above to evaluate grounded synthesis.
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
