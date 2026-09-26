import React, { useState, useEffect } from 'react';
import {
  Users,
  Plus,
  Trash2,
  Edit2,
  CheckCircle,
  Star,
  Check,
  X,
  Sparkles,
  Bot,
  AlertCircle
} from 'lucide-react';
import { personasApi } from '../api/client';
import { useConfirm } from './ConfirmModal';

const TONES = ['professional', 'technical', 'friendly', 'formal', 'direct'];
const VERBOSITY_LEVELS = ['concise', 'balanced', 'detailed'];
const EXPERTISE_LEVELS = ['beginner', 'intermediate', 'advanced', 'expert'];

export default function PersonaManager({ onSelectPersonaForTest }) {
  const confirm = useConfirm();
  const [personas, setPersonas] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPersona, setEditingPersona] = useState(null);

  // Form Fields
  const [formName, setFormName] = useState('');
  const [formRole, setFormRole] = useState('');
  const [formPurpose, setFormPurpose] = useState('');
  const [formAudienceInput, setFormAudienceInput] = useState('');
  const [formAudience, setFormAudience] = useState([]);
  const [formTone, setFormTone] = useState('technical');
  const [formVerbosity, setFormVerbosity] = useState('detailed');
  const [formExpertise, setFormExpertise] = useState('advanced');
  const [formStepByStep, setFormStepByStep] = useState(true);
  const [formDefineTerms, setFormDefineTerms] = useState(false);
  const [formIncludeExamples, setFormIncludeExamples] = useState(true);
  const [formIsDefault, setFormIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadPersonas = async () => {
    setLoading(true);
    try {
      const list = await personasApi.list();
      setPersonas(list);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to load personas');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPersonas();
  }, []);

  const openCreateModal = () => {
    setEditingPersona(null);
    setFormName('');
    setFormRole('Engineering Knowledge Specialist');
    setFormPurpose('Help authorized engineers navigate, troubleshoot, and debug internal systems');
    setFormAudience(['Engineers', 'DevOps']);
    setFormAudienceInput('');
    setFormTone('technical');
    setFormVerbosity('detailed');
    setFormExpertise('expert');
    setFormStepByStep(true);
    setFormDefineTerms(false);
    setFormIncludeExamples(true);
    setFormIsDefault(false);
    setModalOpen(true);
  };

  const openEditModal = (p) => {
    setEditingPersona(p);
    setFormName(p.name);
    setFormRole(p.role);
    setFormPurpose(p.purpose);
    setFormAudience(p.audience || []);
    setFormAudienceInput('');
    setFormTone(p.tone || 'technical');
    setFormVerbosity(p.verbosity || 'balanced');
    setFormExpertise(p.expertise_level || 'advanced');
    setFormStepByStep(p.step_by_step ?? true);
    setFormDefineTerms(p.define_specialized_terms ?? false);
    setFormIncludeExamples(p.include_examples ?? true);
    setFormIsDefault(p.is_default ?? false);
    setModalOpen(true);
  };

  const handleAddAudienceTag = () => {
    if (formAudienceInput.trim() && !formAudience.includes(formAudienceInput.trim())) {
      setFormAudience([...formAudience, formAudienceInput.trim()]);
      setFormAudienceInput('');
    }
  };

  const handleRemoveAudienceTag = (tag) => {
    setFormAudience(formAudience.filter((t) => t !== tag));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!formName.trim() || !formRole.trim() || !formPurpose.trim()) {
      alert('Please fill out all required persona fields.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: formName.trim(),
        role: formRole.trim(),
        purpose: formPurpose.trim(),
        audience: formAudience.length > 0 ? formAudience : ['Employees'],
        tone: formTone,
        verbosity: formVerbosity,
        expertise_level: formExpertise,
        step_by_step: formStepByStep,
        define_specialized_terms: formDefineTerms,
        include_examples: formIncludeExamples,
        is_default: formIsDefault
      };

      if (editingPersona) {
        await personasApi.update(editingPersona.id, payload);
      } else {
        await personasApi.create(payload);
      }

      setModalOpen(false);
      await loadPersonas();
    } catch (err) {
      alert(err.message || 'Failed to save persona');
    } finally {
      setSaving(false);
    }
  };

  const handleSetDefault = async (p) => {
    try {
      await personasApi.setDefault(p.id);
      await loadPersonas();
    } catch (err) {
      alert(err.message || 'Failed to update default persona');
    }
  };

  const handleDelete = async (p) => {
    if (p.is_default) {
      alert('Cannot delete the organization default persona.');
      return;
    }

    const confirmed = await confirm({
      title: `Delete Persona "${p.name}"?`,
      description: 'This will remove the persona profile. Existing chat conversations will safely fall back to the default profile.',
      confirmText: 'Delete Persona',
      cancelText: 'Cancel',
      variant: 'danger'
    });
    if (!confirmed) return;

    try {
      await personasApi.delete(p.id);
      await loadPersonas();
    } catch (err) {
      alert(err.message || 'Failed to delete persona');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            Organization Personas
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
            Configure distinct assistant roles (e.g. Engineering Specialist, Customer Support, Legal Assistant) sharing your tenant knowledge base.
          </p>
        </div>

        <button
          onClick={openCreateModal}
          className="btn btn-primary"
          style={{ padding: '8px 16px', fontSize: '13px', gap: '6px' }}
        >
          <Plus size={15} />
          <span>New Persona</span>
        </button>
      </div>

      {errorMsg && (
        <div style={{ padding: '10px 14px', borderRadius: '8px', background: 'var(--accent-rose-subtle)', color: 'var(--accent-rose-text)', fontSize: '13px' }}>
          {errorMsg}
        </div>
      )}

      {/* Personas Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '16px' }}>
        {personas.map((p) => {
          return (
            <div
              key={p.id}
              className="calm-panel"
              style={{
                padding: '20px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                border: p.is_default ? '1.5px solid var(--accent-primary-border)' : '1px solid var(--border-hairline)',
                position: 'relative'
              }}
            >
              <div>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '8px',
                        background: p.is_default ? 'var(--accent-primary-subtle)' : 'var(--bg-surface-2)',
                        border: '1px solid var(--border-subtle)',
                        color: p.is_default ? 'var(--accent-primary)' : 'var(--text-secondary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      <Bot size={17} />
                    </div>
                    <div>
                      <h3 style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                        {p.name}
                      </h3>
                      <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                        {p.role}
                      </span>
                    </div>
                  </div>

                  {p.is_default ? (
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        background: 'var(--accent-primary-subtle)',
                        border: '1px solid var(--accent-primary-border)',
                        color: 'var(--accent-primary)',
                        padding: '3px 8px',
                        borderRadius: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      <Star size={11} fill="var(--accent-primary)" /> Default
                    </span>
                  ) : (
                    <button
                      onClick={() => handleSetDefault(p)}
                      className="btn-ghost"
                      style={{ fontSize: '11px', color: 'var(--text-muted)', padding: '2px 6px' }}
                    >
                      Set Default
                    </button>
                  )}
                </div>

                {/* Purpose */}
                <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.5, margin: '8px 0 14px 0' }}>
                  {p.purpose}
                </p>

                {/* Badges / Traits */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
                  <span style={{ fontSize: '11px', background: 'var(--bg-surface-2)', padding: '3px 8px', borderRadius: '4px', color: 'var(--text-muted)' }}>
                    Tone: <strong>{p.tone}</strong>
                  </span>
                  <span style={{ fontSize: '11px', background: 'var(--bg-surface-2)', padding: '3px 8px', borderRadius: '4px', color: 'var(--text-muted)' }}>
                    Verbosity: <strong>{p.verbosity}</strong>
                  </span>
                  <span style={{ fontSize: '11px', background: 'var(--bg-surface-2)', padding: '3px 8px', borderRadius: '4px', color: 'var(--text-muted)' }}>
                    Level: <strong>{p.expertise_level}</strong>
                  </span>
                  {p.step_by_step && (
                    <span style={{ fontSize: '11px', background: 'var(--accent-emerald-subtle)', color: 'var(--accent-emerald-text)', padding: '3px 8px', borderRadius: '4px' }}>
                      Step-by-Step
                    </span>
                  )}
                  {p.include_examples && (
                    <span style={{ fontSize: '11px', background: 'var(--accent-cyan-subtle)', color: 'var(--accent-cyan-text)', padding: '3px 8px', borderRadius: '4px' }}>
                      Examples
                    </span>
                  )}
                </div>

                {/* Audience Tags */}
                {p.audience && p.audience.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '14px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Audience:</span>
                    {p.audience.map((a, i) => (
                      <span key={i} style={{ fontSize: '11px', background: 'var(--bg-surface-3)', padding: '2px 6px', borderRadius: '4px', color: 'var(--text-secondary)' }}>
                        {a}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Bottom Actions */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-hairline)', paddingTop: '12px' }}>
                {onSelectPersonaForTest ? (
                  <button
                    onClick={() => onSelectPersonaForTest(p)}
                    className="btn btn-secondary"
                    style={{ fontSize: '12px', padding: '4px 10px', gap: '5px' }}
                  >
                    <Sparkles size={12} color="var(--accent-primary)" />
                    <span>Test in Playground</span>
                  </button>
                ) : <div />}

                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    onClick={() => openEditModal(p)}
                    className="btn-ghost"
                    style={{ padding: '5px' }}
                    title="Edit Persona"
                  >
                    <Edit2 size={13} />
                  </button>
                  {!p.is_default && (
                    <button
                      onClick={() => handleDelete(p)}
                      className="btn-ghost"
                      style={{ padding: '5px', color: 'var(--accent-rose)' }}
                      title="Delete Persona"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal for Create / Edit Persona */}
      {modalOpen && (
        <div className="modal-backdrop" style={{ zIndex: 120 }}>
          <div className="calm-panel modal-panel" style={{ width: '560px', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Bot size={18} color="var(--accent-primary)" />
                <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  {editingPersona ? `Edit Persona: ${editingPersona.name}` : 'Create Organization Persona'}
                </h3>
              </div>
              <button onClick={() => setModalOpen(false)} className="btn-ghost" style={{ padding: '4px' }}>
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                  Persona Name *
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Legal & Compliance Assistant"
                  style={{ width: '100%' }}
                  required
                />
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                  Role Description *
                </label>
                <input
                  type="text"
                  value={formRole}
                  onChange={(e) => setFormRole(e.target.value)}
                  placeholder="e.g. Contract and regulatory compliance researcher"
                  style={{ width: '100%' }}
                  required
                />
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                  Purpose & Objective *
                </label>
                <textarea
                  rows={2}
                  value={formPurpose}
                  onChange={(e) => setFormPurpose(e.target.value)}
                  placeholder="What tasks should this persona help users accomplish?"
                  style={{ width: '100%' }}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                    Tone
                  </label>
                  <select value={formTone} onChange={(e) => setFormTone(e.target.value)} style={{ width: '100%', height: '34px', fontSize: '12px' }}>
                    {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                    Verbosity
                  </label>
                  <select value={formVerbosity} onChange={(e) => setFormVerbosity(e.target.value)} style={{ width: '100%', height: '34px', fontSize: '12px' }}>
                    {VERBOSITY_LEVELS.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                    Expertise
                  </label>
                  <select value={formExpertise} onChange={(e) => setFormExpertise(e.target.value)} style={{ width: '100%', height: '34px', fontSize: '12px' }}>
                    {EXPERTISE_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                  Target Audience Tags
                </label>
                <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                  <input
                    type="text"
                    value={formAudienceInput}
                    onChange={(e) => setFormAudienceInput(e.target.value)}
                    placeholder="e.g. Legal, Executives"
                    style={{ flex: 1 }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddAudienceTag())}
                  />
                  <button type="button" onClick={handleAddAudienceTag} className="btn btn-secondary">
                    Add
                  </button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {formAudience.map((tag) => (
                    <span key={tag} style={{ background: 'var(--bg-surface-2)', padding: '2px 8px', borderRadius: '12px', fontSize: '11.5px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      {tag}
                      <X size={10} style={{ cursor: 'pointer' }} onClick={() => handleRemoveAudienceTag(tag)} />
                    </span>
                  ))}
                </div>
              </div>

              {/* Behavior Flags */}
              <div style={{ display: 'flex', gap: '16px', background: 'var(--bg-surface-2)', padding: '10px 14px', borderRadius: '6px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={formStepByStep} onChange={(e) => setFormStepByStep(e.target.checked)} />
                  Step-by-step
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={formDefineTerms} onChange={(e) => setFormDefineTerms(e.target.checked)} />
                  Define terms
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={formIncludeExamples} onChange={(e) => setFormIncludeExamples(e.target.checked)} />
                  Examples
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button type="button" onClick={() => setModalOpen(false)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="btn btn-primary">
                  {saving ? 'Saving...' : editingPersona ? 'Save Changes' : 'Create Persona'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
