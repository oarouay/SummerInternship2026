import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Send,
  Bot,
  FileText,
  Network,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Clock,
  CheckCircle2,
  HelpCircle,
  Layers,
  ArrowRight
} from 'lucide-react';
import { aiProfilesApi, personasApi } from '../api/client';
import MarkdownMessage from './MarkdownMessage';

export default function AIProfilePlayground({ initialPersona = null }) {
  const [personas, setPersonas] = useState([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState(initialPersona?.id || null);
  const [question, setQuestion] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [whyExpanded, setWhyExpanded] = useState(true);

  // Pre-seeded prompt quick links
  const samplePrompts = [
    'How do I authenticate with the internal API gateway?',
    'What is our customer data retention schedule under GDPR?',
    'Why did SSO fail after the 4.7 deployment release?'
  ];

  useEffect(() => {
    const load = async () => {
      try {
        const pList = await personasApi.list();
        setPersonas(pList);
        if (!selectedPersonaId && pList.length > 0) {
          const def = pList.find((p) => p.is_default) || pList[0];
          setSelectedPersonaId(def.id);
        }
      } catch (err) {
        console.error('Error loading personas for playground:', err);
      }
    };
    load();
  }, []);

  useEffect(() => {
    if (initialPersona?.id) {
      setSelectedPersonaId(initialPersona.id);
    }
  }, [initialPersona]);

  const handleRunTest = async (testQuery = null) => {
    const q = (typeof testQuery === 'string' ? testQuery : question).trim();
    if (!q || testing) return;

    if (testQuery) {
      setQuestion(testQuery);
    }

    setTesting(true);
    setErrorMsg('');
    setTestResult(null);

    try {
      const response = await aiProfilesApi.test({
        question: q,
        persona_id: selectedPersonaId || undefined
      });
      setTestResult(response);
    } catch (err) {
      setErrorMsg(err.message || 'Playground query execution failed');
    } finally {
      setTesting(false);
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'sufficient':
        return { label: 'Fully Grounded Evidence', color: 'var(--accent-emerald)', bg: 'var(--accent-emerald-subtle)', border: 'var(--accent-emerald-border)' };
      case 'partial':
        return { label: 'Partial Evidence', color: 'var(--accent-amber-text)', bg: 'var(--accent-amber-subtle)', border: 'var(--accent-amber-border)' };
      case 'conflicting':
        return { label: 'Conflicting Sources Detected', color: 'var(--accent-rose-text)', bg: 'var(--accent-rose-subtle)', border: 'var(--accent-rose-border)' };
      case 'insufficient':
      default:
        return { label: 'Insufficient Evidence (Abstained)', color: 'var(--accent-cyan-text)', bg: 'var(--accent-cyan-subtle)', border: 'var(--accent-cyan-border)' };
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header */}
      <div>
        <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          AI Profile & Persona Playground
        </h2>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
          Test questions against active enterprise grounding rules, source authority weighting, and specific personas before publishing.
        </p>
      </div>

      {/* Query Bar & Persona Switcher */}
      <div className="calm-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Bot size={16} color="var(--accent-primary)" />
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
              Active Persona:
            </span>
          </div>

          <select
            value={selectedPersonaId || ''}
            onChange={(e) => setSelectedPersonaId(parseInt(e.target.value))}
            style={{ height: '34px', fontSize: '12px', minWidth: '220px' }}
          >
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.is_default ? '(Default)' : ''} — {p.tone}
              </option>
            ))}
          </select>

          <div style={{ flex: 1 }} />

          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>Quick Seeds:</span>
            {samplePrompts.map((s, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleRunTest(s)}
                className="btn-ghost"
                style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '12px', background: 'var(--bg-surface-2)' }}
              >
                {s.length > 28 ? s.slice(0, 26) + '...' : s}
              </button>
            ))}
          </div>
        </div>

        {/* Question Input */}
        <form onSubmit={(e) => { e.preventDefault(); handleRunTest(); }} style={{ display: 'flex', gap: '10px' }}>
          <input
            type="text"
            placeholder="Ask a test question to verify policy adherence and citation grounding..."
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={testing}
            style={{ flex: 1, height: '40px', fontSize: '13.5px' }}
          />
          <button
            type="submit"
            disabled={!question.trim() || testing}
            className="btn btn-primary"
            style={{ padding: '0 20px', gap: '8px' }}
          >
            {testing ? (
              <span>Reasoning...</span>
            ) : (
              <>
                <Send size={14} />
                <span>Test Query</span>
              </>
            )}
          </button>
        </form>
      </div>

      {errorMsg && (
        <div style={{ padding: '12px 16px', borderRadius: '8px', background: 'var(--accent-rose-subtle)', color: 'var(--accent-rose-text)', fontSize: '13px' }}>
          {errorMsg}
        </div>
      )}

      {/* Test Results Display */}
      {testResult && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Status Header */}
          <div
            className="calm-panel"
            style={{
              padding: '12px 18px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'var(--bg-surface-2)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {(() => {
                const b = getStatusBadge(testResult.evidence_status);
                return (
                  <span
                    style={{
                      fontSize: '11.5px',
                      fontWeight: 600,
                      padding: '4px 10px',
                      borderRadius: '12px',
                      background: b.bg,
                      color: b.color,
                      border: `1px solid ${b.border}`
                    }}
                  >
                    {b.label}
                  </span>
                );
              })()}

              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Persona: <strong>{testResult.active_persona_name}</strong> · Profile v{testResult.active_profile_version}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '11.5px', color: 'var(--text-muted)' }}>
              <span>{testResult.retrieved_chunks_count} Vector Passages</span>
              <span>·</span>
              <span>{testResult.graph_entities_count} Graph Entities</span>
              <span>·</span>
              <span className="tabular-nums" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Clock size={12} /> {testResult.execution_time_ms}ms
              </span>
            </div>
          </div>

          {/* Generated Answer */}
          <div className="calm-panel" style={{ padding: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
              <Sparkles size={16} color="var(--accent-primary)" />
              <h3 style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                Synthesized & Validated Response
              </h3>
            </div>

            <div style={{ fontSize: '14px', lineHeight: 1.65, color: 'var(--text-primary)' }}>
              <MarkdownMessage content={testResult.answer} />
            </div>
          </div>

          {/* Diagnostics Section: "Why did OmniGraph answer this way?" */}
          <div className="calm-panel" style={{ padding: '16px' }}>
            <div
              onClick={() => setWhyExpanded(!whyExpanded)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
                userSelect: 'none'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <HelpCircle size={15} color="var(--accent-cyan)" />
                <span style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Why did OmniGraph answer this way?
                </span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  (Admin Execution Trace)
                </span>
              </div>
              {whyExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </div>

            {whyExpanded && testResult.why_answered_this_way && (
              <div style={{ marginTop: '16px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', fontSize: '12px' }}>
                <div style={{ background: 'var(--bg-surface-2)', padding: '12px', borderRadius: '6px' }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                    Grounding Policy
                  </div>
                  <div style={{ color: 'var(--text-secondary)' }}>
                    Mode: <strong>{testResult.why_answered_this_way.groundingMode}</strong>
                  </div>
                  <div style={{ color: 'var(--text-secondary)', marginTop: '2px' }}>
                    Mandatory Citations: <strong>{testResult.why_answered_this_way.citationsMandatory ? 'Yes' : 'No'}</strong>
                  </div>
                </div>

                <div style={{ background: 'var(--bg-surface-2)', padding: '12px', borderRadius: '6px' }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                    Persona Calibration
                  </div>
                  <div style={{ color: 'var(--text-secondary)' }}>
                    Tone: <strong>{testResult.why_answered_this_way.personaAdherence?.tone}</strong>
                  </div>
                  <div style={{ color: 'var(--text-secondary)', marginTop: '2px' }}>
                    Level: <strong>{testResult.why_answered_this_way.personaAdherence?.expertiseLevel}</strong>
                  </div>
                </div>

                <div style={{ background: 'var(--bg-surface-2)', padding: '12px', borderRadius: '6px' }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                    Retrieval Weights
                  </div>
                  <div style={{ color: 'var(--text-secondary)' }}>
                    Top-K: <strong>{testResult.why_answered_this_way.retrievalWeights?.topK}</strong> · Depth: <strong>{testResult.why_answered_this_way.retrievalWeights?.maxGraphDepth} hops</strong>
                  </div>
                  <div style={{ color: 'var(--text-secondary)', marginTop: '2px' }}>
                    Vector: {testResult.why_answered_this_way.retrievalWeights?.vectorWeight} / Graph: {testResult.why_answered_this_way.retrievalWeights?.graphWeight}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Evidence Grid: Vector Sources & Graph Paths */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            {/* Citations / Sources */}
            <div className="calm-panel" style={{ padding: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <FileText size={15} color="var(--accent-primary)" />
                <h4 style={{ fontSize: '13px', fontWeight: 600, margin: 0 }}>
                  Verified Citations ({testResult.citations?.length || 0})
                </h4>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '280px', overflowY: 'auto' }}>
                {testResult.citations?.map((c, i) => (
                  <div key={i} style={{ background: 'var(--bg-surface-2)', padding: '10px 12px', borderRadius: '6px', fontSize: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <span style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>
                        [{c.evidence_id}] {c.document_title}
                      </span>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        Auth Weight: {(c.authority_score * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '11.5px', lineHeight: 1.4 }}>
                      "{c.snippet}"
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Knowledge Graph Multi-Hop Paths */}
            <div className="calm-panel" style={{ padding: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <Network size={15} color="var(--accent-cyan)" />
                <h4 style={{ fontSize: '13px', fontWeight: 600, margin: 0 }}>
                  Traversed Knowledge Graph Paths ({testResult.graph_paths?.length || 0})
                </h4>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '280px', overflowY: 'auto' }}>
                {testResult.graph_paths?.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center', padding: '24px 0' }}>
                    No multi-hop relationships traversed for this query.
                  </div>
                ) : (
                  testResult.graph_paths?.map((path, i) => (
                    <div key={i} style={{ background: 'var(--bg-surface-2)', padding: '8px 12px', borderRadius: '6px', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
                      <span style={{ color: 'var(--accent-cyan-text)' }}>{path}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
