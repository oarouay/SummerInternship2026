import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Sliders,
  History,
  Users,
  Play,
  RotateCcw,
  Save,
  CheckCircle2,
  AlertTriangle,
  Building2,
  ShieldCheck,
  Layers,
  ArrowUpRight,
  Info,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Plus
} from 'lucide-react';
import { aiProfilesApi, personasApi } from '../api/client';
import PersonaManager from './PersonaManager';
import AIProfilePlayground from './AIProfilePlayground';
import OnboardingWizard from './OnboardingWizard';
import { useConfirm } from './ConfirmModal';

export default function AIProfileAdmin({ tenant }) {
  const confirm = useConfirm();
  const [subTab, setSubTab] = useState('overview'); // 'overview' | 'personas' | 'playground' | 'wizard'
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Active AI Profile State
  const [profile, setProfile] = useState(null);
  const [advancedMode, setAdvancedMode] = useState(false);

  // Version History Modal
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [versions, setVersions] = useState([]);
  const [snapshotReason, setSnapshotReason] = useState('');
  const [creatingSnapshot, setCreatingSnapshot] = useState(false);

  // Local draft states for editing
  const [orgData, setOrgData] = useState({});
  const [audienceData, setAudienceData] = useState({});
  const [behaviorData, setBehaviorData] = useState({});
  const [retrievalPolicy, setRetrievalPolicy] = useState({});
  const [sourceAuthorityPolicy, setSourceAuthorityPolicy] = useState({});
  const [citationPolicy, setCitationPolicy] = useState({});
  const [evidencePolicy, setEvidencePolicy] = useState({});
  const [conflictPolicy, setConflictPolicy] = useState({});

  // Persona for testing in playground
  const [playgroundPersona, setPlaygroundPersona] = useState(null);

  const loadActiveProfile = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const active = await aiProfilesApi.getActive();
      setProfile(active);
      if (active) {
        setOrgData(active.organization_data || {});
        setAudienceData(active.audience_data || {});
        setBehaviorData(active.behavior_data || {});
        setRetrievalPolicy(active.retrieval_policy || {});
        setSourceAuthorityPolicy(active.source_authority_policy || {});
        setCitationPolicy(active.citation_policy || {});
        setEvidencePolicy(active.evidence_policy || {});
        setConflictPolicy(active.conflict_policy || {});
      }
    } catch (err) {
      setErrorMsg(err.message || 'Failed to load Organization AI Profile');
    } finally {
      setLoading(false);
    }
  };

  const loadVersions = async () => {
    try {
      const list = await aiProfilesApi.listVersions();
      setVersions(list);
    } catch (err) {
      console.error('Failed to load version snapshots:', err);
    }
  };

  useEffect(() => {
    loadActiveProfile();
  }, []);

  const handleSaveProfile = async () => {
    setSaving(true);
    setErrorMsg('');
    setSaveSuccess(false);

    try {
      const payload = {
        organization_data: orgData,
        audience_data: audienceData,
        behavior_data: behaviorData,
        retrieval_policy: retrievalPolicy,
        source_authority_policy: sourceAuthorityPolicy,
        citation_policy: citationPolicy,
        evidence_policy: evidencePolicy,
        conflict_policy: conflictPolicy,
        change_reason: 'Updated via AI Profile Configuration console'
      };

      const updated = await aiProfilesApi.updateActive(payload);
      setProfile(updated);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to save AI Profile policies');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateSnapshot = async (e) => {
    e.preventDefault();
    if (!snapshotReason.trim()) return;

    setCreatingSnapshot(true);
    try {
      await aiProfilesApi.createVersion(snapshotReason.trim());
      setSnapshotReason('');
      await loadVersions();
      await loadActiveProfile();
    } catch (err) {
      alert(err.message || 'Failed to create snapshot');
    } finally {
      setCreatingSnapshot(false);
    }
  };

  const handleRestoreVersion = async (versionNum) => {
    const confirmed = await confirm({
      title: `Restore Profile Version v${versionNum}?`,
      description: `This will roll back all organization grounding, source authority, and citation rules to the exact state saved in version v${versionNum}.`,
      confirmText: 'Restore Version',
      cancelText: 'Cancel'
    });
    if (!confirmed) return;

    try {
      const restored = await aiProfilesApi.restoreVersion(versionNum);
      setProfile(restored);
      setHistoryModalOpen(false);
      await loadActiveProfile();
    } catch (err) {
      alert(err.message || 'Failed to restore version');
    }
  };

  const handleTestPersonaInPlayground = (persona) => {
    setPlaygroundPersona(persona);
    setSubTab('playground');
  };

  const handleWizardCompleted = (newProfile) => {
    setProfile(newProfile);
    setSubTab('overview');
    loadActiveProfile();
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', background: 'var(--bg-canvas)' }}>
      {/* Top Bar Navigation */}
      <header
        style={{
          borderBottom: '1px solid var(--border-hairline)',
          background: 'var(--bg-surface-1)',
          padding: '16px 28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <Sparkles size={16} color="var(--accent-primary)" />
            <h1 style={{ fontSize: '17px', fontWeight: 700, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
              Organization AI Profile & Personas
            </h1>
            {profile && (
              <span style={{ fontSize: '11px', background: 'var(--accent-primary-subtle)', color: 'var(--accent-primary)', padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}>
                Active v{profile.version}
              </span>
            )}
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
            Governs GraphRAG retrieval strategy, source authority hierarchy, and persona behavior across your enterprise.
          </p>
        </div>

        {/* Tab Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ display: 'flex', background: 'var(--bg-surface-2)', padding: '3px', borderRadius: '8px', border: '1px solid var(--border-hairline)' }}>
            {[
              { id: 'overview', label: 'Policy Overview', icon: Sliders },
              { id: 'personas', label: 'Personas', icon: Users },
              { id: 'playground', label: 'Test Playground', icon: Play },
              { id: 'wizard', label: 'Onboarding Wizard', icon: Sparkles }
            ].map((t) => {
              const Icon = t.icon;
              const isActive = subTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setSubTab(t.id)}
                  className="btn-ghost"
                  style={{
                    padding: '6px 14px',
                    fontSize: '12px',
                    fontWeight: isActive ? 600 : 500,
                    borderRadius: '6px',
                    background: isActive ? 'var(--bg-surface-1)' : 'transparent',
                    color: isActive ? 'var(--accent-primary)' : 'var(--text-secondary)',
                    boxShadow: isActive ? 'var(--shadow-sm)' : 'none',
                    gap: '6px'
                  }}
                >
                  <Icon size={13} />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>

          {subTab === 'overview' && (
            <button
              onClick={() => { setHistoryModalOpen(true); loadVersions(); }}
              className="btn btn-secondary"
              style={{ padding: '6px 12px', fontSize: '12px', gap: '6px' }}
              title="Version snapshots & rollbacks"
            >
              <History size={14} />
              <span>Versions</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Content View */}
      <div style={{ flex: 1, padding: '24px 28px', maxWidth: '1100px', width: '100%', margin: '0 auto' }}>
        {errorMsg && (
          <div style={{ padding: '12px 16px', borderRadius: '8px', background: 'var(--accent-rose-subtle)', color: 'var(--accent-rose-text)', fontSize: '13px', marginBottom: '20px' }}>
            {errorMsg}
          </div>
        )}

        {/* 1. OVERVIEW & POLICIES TAB */}
        {subTab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Mode Switcher Banner */}
            <div
              className="calm-panel"
              style={{
                padding: '14px 20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'var(--bg-surface-1)'
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Configuration Mode: {advancedMode ? 'Advanced GraphRAG Tuning' : 'Business Policy Mode'}
                  </span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  {advancedMode
                    ? 'Exposing low-level retrieval weights, vector-graph balance, and citation thresholds.'
                    : 'Simple enterprise controls for grounding, source authority, and tone.'}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button
                  onClick={() => setAdvancedMode(!advancedMode)}
                  className="btn btn-secondary"
                  style={{ fontSize: '12px', padding: '6px 12px' }}
                >
                  Switch to {advancedMode ? 'Simple Mode' : 'Advanced Mode'}
                </button>

                <button
                  onClick={handleSaveProfile}
                  disabled={saving}
                  className="btn btn-primary"
                  style={{ fontSize: '12px', padding: '6px 16px', gap: '6px' }}
                >
                  {saving ? (
                    <span>Validating & Saving...</span>
                  ) : saveSuccess ? (
                    <>
                      <CheckCircle2 size={13} color="var(--accent-emerald)" />
                      <span>Policies Saved!</span>
                    </>
                  ) : (
                    <>
                      <Save size={13} />
                      <span>Save Policies</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Profile Content Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              {/* Organization & Industry Context */}
              <div className="calm-panel" style={{ padding: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                  <Building2 size={16} color="var(--accent-primary)" />
                  <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                    Organization Profile
                  </h3>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div>
                    <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-muted)' }}>Company Name</label>
                    <input
                      type="text"
                      value={orgData.companyName || ''}
                      onChange={(e) => setOrgData({ ...orgData, companyName: e.target.value })}
                      style={{ width: '100%', marginTop: '4px' }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-muted)' }}>Industry</label>
                    <input
                      type="text"
                      value={orgData.industry || ''}
                      onChange={(e) => setOrgData({ ...orgData, industry: e.target.value })}
                      style={{ width: '100%', marginTop: '4px' }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-muted)' }}>Products / Services</label>
                    <input
                      type="text"
                      value={(orgData.products || []).join(', ')}
                      onChange={(e) => setOrgData({ ...orgData, products: e.target.value.split(',').map((s) => s.trim()) })}
                      style={{ width: '100%', marginTop: '4px' }}
                    />
                  </div>
                </div>
              </div>

              {/* Grounding & Evidence Policy */}
              <div className="calm-panel" style={{ padding: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                  <ShieldCheck size={16} color="var(--accent-emerald)" />
                  <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                    Grounding & Evidence Policy
                  </h3>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div>
                    <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-muted)' }}>Grounding Mode</label>
                    <select
                      value={evidencePolicy.mode || 'strict'}
                      onChange={(e) => setEvidencePolicy({ ...evidencePolicy, mode: e.target.value })}
                      style={{ width: '100%', marginTop: '4px', height: '34px' }}
                    >
                      <option value="strict">Strict (Never fabricate; abstain if missing)</option>
                      <option value="balanced">Balanced (Answer supported; state uncertainty)</option>
                      <option value="exploratory">Exploratory (Allow labeled interpretations)</option>
                    </select>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '6px' }}>
                    <div>
                      <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-primary)' }}>Mandatory Citations</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Require factual claims to cite evidence [EV_#]</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={citationPolicy.citationsRequired ?? true}
                      onChange={(e) => setCitationPolicy({ ...citationPolicy, citationsRequired: e.target.checked })}
                    />
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border-hairline)', paddingTop: '10px' }}>
                    <div>
                      <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-primary)' }}>Disclose Uncertainty</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Explicit statements for partial knowledge</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={evidencePolicy.uncertaintyDisclosure ?? true}
                      onChange={(e) => setEvidencePolicy({ ...evidencePolicy, uncertaintyDisclosure: e.target.checked })}
                    />
                  </div>
                </div>
              </div>

              {/* Source Authority & Conflict Resolution */}
              <div className="calm-panel" style={{ padding: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                  <Layers size={16} color="var(--accent-amber)" />
                  <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                    Source Authority & Conflict Rules
                  </h3>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div>
                    <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-muted)' }}>Conflict Strategy</label>
                    <select
                      value={conflictPolicy.strategy || 'prefer_highest_authority'}
                      onChange={(e) => setConflictPolicy({ ...conflictPolicy, strategy: e.target.value })}
                      style={{ width: '100%', marginTop: '4px', height: '34px' }}
                    >
                      <option value="prefer_highest_authority">Prefer Highest Authority Source</option>
                      <option value="show_both">Surface Disagreement & Show Both</option>
                      <option value="prefer_latest">Prefer Most Recently Updated</option>
                      <option value="require_human_review">Require Human Review (Abstain)</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-muted)' }}>Current Top Authority</label>
                    <div style={{ fontSize: '12px', color: 'var(--text-primary)', background: 'var(--bg-surface-2)', padding: '8px 12px', borderRadius: '6px', marginTop: '4px' }}>
                      {sourceAuthorityPolicy.hierarchy?.[0]?.sourceType || 'Regulatory Policies'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Target Audience & Communication Tone */}
              <div className="calm-panel" style={{ padding: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                  <Users size={16} color="var(--accent-cyan)" />
                  <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                    Target Audience & Tone
                  </h3>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div>
                    <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-muted)' }}>Organization Baseline Tone</label>
                    <select
                      value={behaviorData.tone || 'professional'}
                      onChange={(e) => setBehaviorData({ ...behaviorData, tone: e.target.value })}
                      style={{ width: '100%', marginTop: '4px', height: '34px' }}
                    >
                      <option value="professional">Professional</option>
                      <option value="technical">Technical</option>
                      <option value="formal">Formal</option>
                      <option value="friendly">Friendly</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-muted)' }}>Default Expertise Level</label>
                    <select
                      value={audienceData.technicalLevel || 'Advanced'}
                      onChange={(e) => setAudienceData({ ...audienceData, technicalLevel: e.target.value })}
                      style={{ width: '100%', marginTop: '4px', height: '34px' }}
                    >
                      <option value="Beginner">Beginner</option>
                      <option value="Intermediate">Intermediate</option>
                      <option value="Advanced">Advanced</option>
                      <option value="Expert">Expert</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {/* ADVANCED MODE PANEL */}
            {advancedMode && (
              <div className="calm-panel" style={{ padding: '20px', border: '1px solid var(--accent-primary-border)', background: 'var(--bg-surface-2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                  <Sliders size={16} color="var(--accent-primary)" />
                  <h3 style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                    Advanced GraphRAG Retrieval & Reranker Weights
                  </h3>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
                  <div>
                    <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                      Top-K Chunks: <strong>{retrievalPolicy.topK || 4}</strong>
                    </label>
                    <input
                      type="range"
                      min={1}
                      max={12}
                      value={retrievalPolicy.topK || 4}
                      onChange={(e) => setRetrievalPolicy({ ...retrievalPolicy, topK: parseInt(e.target.value) })}
                      style={{ width: '100%', marginTop: '8px' }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                      Max Graph Depth: <strong>{retrievalPolicy.maxGraphDepth || 2} hops</strong>
                    </label>
                    <input
                      type="range"
                      min={1}
                      max={3}
                      value={retrievalPolicy.maxGraphDepth || 2}
                      onChange={(e) => setRetrievalPolicy({ ...retrievalPolicy, maxGraphDepth: parseInt(e.target.value) })}
                      style={{ width: '100%', marginTop: '8px' }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                      Vector Weight: <strong>{retrievalPolicy.vectorWeight || 0.6}</strong>
                    </label>
                    <input
                      type="range"
                      min={0.1}
                      max={0.9}
                      step={0.1}
                      value={retrievalPolicy.vectorWeight || 0.6}
                      onChange={(e) => {
                        const vw = parseFloat(e.target.value);
                        setRetrievalPolicy({ ...retrievalPolicy, vectorWeight: vw, graphWeight: Math.round((1 - vw) * 10) / 10 });
                      }}
                      style={{ width: '100%', marginTop: '8px' }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                      Graph Weight: <strong>{retrievalPolicy.graphWeight || 0.4}</strong>
                    </label>
                    <input
                      type="range"
                      min={0.1}
                      max={0.9}
                      step={0.1}
                      value={retrievalPolicy.graphWeight || 0.4}
                      onChange={(e) => {
                        const gw = parseFloat(e.target.value);
                        setRetrievalPolicy({ ...retrievalPolicy, graphWeight: gw, vectorWeight: Math.round((1 - gw) * 10) / 10 });
                      }}
                      style={{ width: '100%', marginTop: '8px' }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 2. PERSONAS TAB */}
        {subTab === 'personas' && (
          <PersonaManager onSelectPersonaForTest={handleTestPersonaInPlayground} />
        )}

        {/* 3. PLAYGROUND TAB */}
        {subTab === 'playground' && (
          <AIProfilePlayground initialPersona={playgroundPersona} />
        )}

        {/* 4. ONBOARDING WIZARD TAB */}
        {subTab === 'wizard' && (
          <OnboardingWizard
            initialTenantName={tenant?.name || ''}
            onComplete={handleWizardCompleted}
            onCancel={() => setSubTab('overview')}
          />
        )}
      </div>

      {/* Version History Modal */}
      {historyModalOpen && (
        <div className="modal-backdrop" style={{ zIndex: 120 }}>
          <div className="calm-panel modal-panel" style={{ width: '640px', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <History size={18} color="var(--accent-primary)" />
                <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  Profile Version Snapshots & Rollback
                </h3>
              </div>
              <button onClick={() => setHistoryModalOpen(false)} className="btn-ghost" style={{ padding: '4px' }}>
                ✕
              </button>
            </div>

            {/* Create Snapshot Form */}
            <form onSubmit={handleCreateSnapshot} style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
              <input
                type="text"
                placeholder="Reason for version snapshot (e.g. Pre-audit baseline)..."
                value={snapshotReason}
                onChange={(e) => setSnapshotReason(e.target.value)}
                style={{ flex: 1 }}
              />
              <button type="submit" disabled={creatingSnapshot || !snapshotReason.trim()} className="btn btn-secondary">
                <Plus size={14} /> Snapshot
              </button>
            </form>

            {/* Versions List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '340px', overflowY: 'auto' }}>
              {versions.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px', fontSize: '13px' }}>
                  No historical snapshots found.
                </div>
              ) : (
                versions.map((v) => (
                  <div
                    key={v.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      background: 'var(--bg-surface-2)',
                      borderRadius: '6px',
                      fontSize: '12.5px'
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <strong style={{ color: 'var(--accent-primary)' }}>Version v{v.version}</strong>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          {new Date(v.created_at).toLocaleDateString()} {new Date(v.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '12px', marginTop: '2px' }}>
                        {v.change_reason || 'Manual snapshot'}
                      </div>
                    </div>

                    <button
                      onClick={() => handleRestoreVersion(v.version)}
                      className="btn btn-secondary"
                      style={{ fontSize: '11.5px', padding: '3px 10px', gap: '4px' }}
                    >
                      <RotateCcw size={11} /> Restore
                    </button>
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
