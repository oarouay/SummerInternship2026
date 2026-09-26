import React, { useState } from 'react';
import {
  Building2,
  HelpCircle,
  Users,
  MessageSquare,
  ShieldAlert,
  Layers,
  Sparkles,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Info,
  Sliders,
  Check,
  Compass,
  FileText
} from 'lucide-react';
import { aiProfilesApi } from '../api/client';

const INDUSTRIES = [
  'FinTech & Financial Services',
  'Healthcare & Life Sciences',
  'Cybersecurity & Infrastructure',
  'Enterprise SaaS & Cloud',
  'Legal & Compliance',
  'Engineering & Manufacturing',
  'E-Commerce & Retail',
  'Telecommunications',
  'Other / Custom'
];

const PURPOSE_OPTIONS = [
  { id: 'internal_search', label: 'Internal Knowledge Search', desc: 'Find internal policies, specs, and SOPs rapidly' },
  { id: 'troubleshooting', label: 'Technical Troubleshooting', desc: 'Debug systems, root cause incidents, and review logs' },
  { id: 'customer_support', label: 'Customer Support Assist', desc: 'Assist tier 1-3 agents with product solutions' },
  { id: 'employee_onboarding', label: 'Employee Onboarding', desc: 'Guide new hires through company tools and policies' },
  { id: 'legal_compliance', label: 'Legal & Compliance Research', desc: 'Query regulatory contracts, compliance rules, and NDAs' },
  { id: 'product_docs', label: 'Product Documentation', desc: 'Explain product capabilities, architecture, and APIs' },
  { id: 'engineering_research', label: 'Engineering Deep Dive', desc: 'Multi-hop code architecture and service dependency reasoning' },
  { id: 'executive_briefs', label: 'Executive Knowledge Access', desc: 'High-level summaries, strategy memos, and business metrics' }
];

const AUDIENCE_OPTIONS = [
  'Software Engineers',
  'DevOps & SREs',
  'Product Managers',
  'Customer Support Agents',
  'Legal & Compliance Officers',
  'Executive Leadership',
  'All Employees (Enterprise-wide)',
  'External Customers'
];

const DEFAULT_SOURCES = [
  { type: 'regulatory', label: 'Regulatory & Legal Policies', desc: 'Highest legal precedence' },
  { type: 'approved_policy', label: 'Approved Corporate Policies & SOPs', desc: 'Company-wide standard guidelines' },
  { type: 'product_docs', label: 'Official Product Architecture & API Docs', desc: 'Source of truth for tech specs' },
  { type: 'engineering_runbooks', label: 'Engineering Specs & Runbooks', desc: 'Operational troubleshooting guides' },
  { type: 'support_articles', label: 'Customer Support Knowledge Base', desc: 'Known issues and verified workarounds' },
  { type: 'meeting_notes', label: 'Meeting Notes & Discussion Summaries', desc: 'Informal, working-level discussions' },
  { type: 'archive', label: 'Historical Archives & Legacy Specs', desc: 'Older documentation subject to deprecation' }
];

export default function OnboardingWizard({ initialTenantName = '', onComplete, onCancel }) {
  const [currentStep, setCurrentStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Step 1: Company Profile
  const [companyName, setCompanyName] = useState(initialTenantName || '');
  const [industry, setIndustry] = useState('Enterprise SaaS & Cloud');
  const [companyDescription, setCompanyDescription] = useState('');
  const [productInput, setProductInput] = useState('');
  const [products, setProducts] = useState([]);
  const [terminologyList, setTerminologyList] = useState([
    { term: 'SOP', definition: 'Standard Operating Procedure' }
  ]);
  const [newTerm, setNewTerm] = useState('');
  const [newDef, setNewDef] = useState('');

  // Step 2: Purpose & Seed Questions
  const [selectedPurposes, setSelectedPurposes] = useState(['internal_search', 'troubleshooting']);
  const [customPurpose, setCustomPurpose] = useState('');
  const [exampleQuestions, setExampleQuestions] = useState([
    'How do I authenticate with the internal API gateway?',
    'What is our policy for customer data retention under GDPR?'
  ]);
  const [newQuestion, setNewQuestion] = useState('');

  // Step 3: Audience
  const [selectedAudiences, setSelectedAudiences] = useState(['Software Engineers', 'DevOps & SREs']);
  const [technicalLevel, setTechnicalLevel] = useState('Advanced');
  const [audienceNotes, setAudienceNotes] = useState('');

  // Step 4: Response Style
  const [verbosity, setVerbosity] = useState('balanced'); // concise | balanced | detailed
  const [tone, setTone] = useState('professional'); // professional | friendly | formal | technical
  const [stepByStep, setStepByStep] = useState(true);
  const [defineSpecializedTerms, setDefineSpecializedTerms] = useState(true);
  const [includeExamples, setIncludeExamples] = useState(true);
  const [highlightWarnings, setHighlightWarnings] = useState(true);

  // Step 5: Evidence & Grounding Policy
  const [groundingMode, setGroundingMode] = useState('strict'); // strict | balanced | exploratory
  const [allowPriorKnowledge, setAllowPriorKnowledge] = useState(false);
  const [uncertaintyDisclosure, setUncertaintyDisclosure] = useState(true);

  // Step 6: Source Authority & Conflict
  const [sourceRanking, setSourceRanking] = useState(DEFAULT_SOURCES);
  const [conflictStrategy, setConflictStrategy] = useState('prefer_highest_authority'); // prefer_highest_authority | show_both | prefer_latest | require_human_review

  // Step 7: Citations & Knowledge Graph
  const [citationsRequired, setCitationsRequired] = useState(true);
  const [citationGranularity, setCitationGranularity] = useState('sentence'); // sentence | claim | paragraph
  const [graphReasoningEnabled, setGraphReasoningEnabled] = useState(true);
  const [maxGraphDepth, setMaxGraphDepth] = useState(2);

  // Terminology helpers
  const handleAddTerm = () => {
    if (newTerm.trim() && newDef.trim()) {
      setTerminologyList([...terminologyList, { term: newTerm.trim(), definition: newDef.trim() }]);
      setNewTerm('');
      setNewDef('');
    }
  };

  const handleRemoveTerm = (index) => {
    setTerminologyList(terminologyList.filter((_, i) => i !== index));
  };

  // Product helpers
  const handleAddProduct = () => {
    if (productInput.trim() && !products.includes(productInput.trim())) {
      setProducts([...products, productInput.trim()]);
      setProductInput('');
    }
  };

  const handleRemoveProduct = (p) => {
    setProducts(products.filter((item) => item !== p));
  };

  // Question helpers
  const handleAddQuestion = () => {
    if (newQuestion.trim()) {
      setExampleQuestions([...exampleQuestions, newQuestion.trim()]);
      setNewQuestion('');
    }
  };

  const handleRemoveQuestion = (idx) => {
    setExampleQuestions(exampleQuestions.filter((_, i) => i !== idx));
  };

  // Source reordering
  const moveSource = (idx, direction) => {
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= sourceRanking.length) return;
    const updated = [...sourceRanking];
    const [moved] = updated.splice(idx, 1);
    updated.splice(newIdx, 0, moved);
    setSourceRanking(updated);
  };

  // Final submission
  const handleSubmitOnboarding = async () => {
    setSubmitting(true);
    setErrorMsg('');

    try {
      const payload = {
        company_name: companyName.trim() || initialTenantName || 'Enterprise Workspace',
        industry,
        company_description: companyDescription.trim() || `Enterprise organization operating in ${industry}`,
        products: products.length > 0 ? products : ['Core Platform'],
        services: [],
        terminology: terminologyList,
        primary_purposes: selectedPurposes,
        custom_purpose: customPurpose.trim() || null,
        example_questions: exampleQuestions,
        target_audiences: selectedAudiences.length > 0 ? selectedAudiences : ['All Employees'],
        technical_level: technicalLevel,
        audience_notes: audienceNotes.trim() || null,
        verbosity,
        tone,
        step_by_step: stepByStep,
        define_specialized_terms: defineSpecializedTerms,
        include_examples: includeExamples,
        highlight_warnings: highlightWarnings,
        grounding_mode: groundingMode,
        allow_prior_knowledge: allowPriorKnowledge,
        uncertainty_disclosure: uncertaintyDisclosure,
        source_hierarchy: sourceRanking.map((s, idx) => ({
          source_type: s.type,
          rank: idx + 1,
          weight: Math.round((1.0 - idx * 0.1) * 10) / 10
        })),
        conflict_strategy: conflictStrategy,
        citations_required: citationsRequired,
        citation_granularity: citationGranularity,
        graph_reasoning_enabled: graphReasoningEnabled,
        max_graph_depth: maxGraphDepth
      };

      const result = await aiProfilesApi.submitOnboarding(payload);
      if (onComplete) {
        onComplete(result);
      }
    } catch (err) {
      setErrorMsg(err.message || 'Failed to generate Organization AI Profile.');
    } finally {
      setSubmitting(false);
    }
  };

  const stepsMeta = [
    { num: 1, label: 'Company', icon: Building2 },
    { num: 2, label: 'Purpose', icon: HelpCircle },
    { num: 3, label: 'Audience', icon: Users },
    { num: 4, label: 'Response Style', icon: MessageSquare },
    { num: 5, label: 'Evidence Policy', icon: ShieldAlert },
    { num: 6, label: 'Source Authority', icon: Layers },
    { num: 7, label: 'Citations & Graph', icon: Sparkles },
    { num: 8, label: 'Review & Activate', icon: CheckCircle2 }
  ];

  return (
    <div style={{ maxWidth: '920px', margin: '0 auto', padding: '24px 20px', width: '100%' }}>
      {/* Top Header */}
      <div style={{ marginBottom: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-primary)', fontSize: '12px', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: '6px' }}>
          <Sparkles size={14} />
          <span>Organization AI Profile Onboarding</span>
        </div>
        <h1 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em', margin: 0 }}>
          Configure Enterprise Intelligence Policies
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '13.5px', marginTop: '6px', lineHeight: 1.5 }}>
          Answer a few business-level questions to configure your organization-specific AI Profile, multi-persona governance, source authority ranking, and GraphRAG grounding policies.
        </p>
      </div>

      {/* Progress Step Indicator */}
      <div
        className="calm-panel"
        style={{
          padding: '12px 16px',
          marginBottom: '24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          overflowX: 'auto',
          gap: '8px'
        }}
      >
        {stepsMeta.map((s) => {
          const Icon = s.icon;
          const isActive = currentStep === s.num;
          const isDone = currentStep > s.num;

          return (
            <div
              key={s.num}
              onClick={() => s.num < currentStep && setCurrentStep(s.num)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                cursor: s.num < currentStep ? 'pointer' : 'default',
                opacity: isActive ? 1 : isDone ? 0.85 : 0.45,
                transition: 'opacity var(--transition-fast)'
              }}
            >
              <div
                style={{
                  width: '26px',
                  height: '26px',
                  borderRadius: '50%',
                  background: isActive
                    ? 'var(--accent-primary)'
                    : isDone
                    ? 'var(--accent-emerald)'
                    : 'var(--bg-surface-3)',
                  color: isActive || isDone ? '#FFFFFF' : 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '11px',
                  fontWeight: 700,
                  flexShrink: 0
                }}
              >
                {isDone ? <Check size={13} /> : s.num}
              </div>
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                  whiteSpace: 'nowrap'
                }}
              >
                {s.label}
              </span>
              {s.num < stepsMeta.length && (
                <div style={{ width: '14px', height: '1px', background: 'var(--border-hairline)', margin: '0 4px' }} />
              )}
            </div>
          );
        })}
      </div>

      {/* Step Content Card */}
      <div className="calm-panel" style={{ padding: '28px', minHeight: '440px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        {errorMsg && (
          <div
            style={{
              padding: '12px 14px',
              borderRadius: '8px',
              background: 'var(--accent-rose-subtle)',
              border: '1px solid var(--accent-rose-border)',
              color: 'var(--accent-rose-text)',
              fontSize: '13px',
              marginBottom: '20px'
            }}
          >
            {errorMsg}
          </div>
        )}

        {/* STEP 1: COMPANY */}
        {currentStep === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                Step 1: Your Organization
              </h2>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                Provide foundational context about what your company does and internal terminology.
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
                  Company Name *
                </label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="e.g. ACME Cloud Security"
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
                  Industry / Sector
                </label>
                <select
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  style={{ width: '100%', height: '36px' }}
                >
                  {INDUSTRIES.map((ind) => (
                    <option key={ind} value={ind}>{ind}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
                Company Description & Mission
              </label>
              <textarea
                rows={3}
                value={companyDescription}
                onChange={(e) => setCompanyDescription(e.target.value)}
                placeholder="Briefly describe what your organization provides, core workflows, and compliance environment..."
                style={{ width: '100%' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
                Core Products & Platforms
              </label>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                <input
                  type="text"
                  value={productInput}
                  onChange={(e) => setProductInput(e.target.value)}
                  placeholder="Add product or service name..."
                  style={{ flex: 1 }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddProduct())}
                />
                <button type="button" onClick={handleAddProduct} className="btn btn-secondary">
                  <Plus size={14} /> Add
                </button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {products.map((p) => (
                  <span
                    key={p}
                    style={{
                      background: 'var(--bg-surface-2)',
                      border: '1px solid var(--border-subtle)',
                      padding: '4px 10px',
                      borderRadius: '16px',
                      fontSize: '12px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    {p}
                    <Trash2 size={11} style={{ cursor: 'pointer', opacity: 0.7 }} onClick={() => handleRemoveProduct(p)} />
                  </span>
                ))}
              </div>
            </div>

            {/* Organization Acronyms & Terminology */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  Organization Acronyms & Terminology Dictionary
                </label>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Injected during entity extraction & prompt compilation
                </span>
              </div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                <input
                  type="text"
                  placeholder="Term (e.g. CIP)"
                  value={newTerm}
                  onChange={(e) => setNewTerm(e.target.value)}
                  style={{ width: '120px' }}
                />
                <input
                  type="text"
                  placeholder="Definition (e.g. Customer Integration Platform)"
                  value={newDef}
                  onChange={(e) => setNewDef(e.target.value)}
                  style={{ flex: 1 }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddTerm())}
                />
                <button type="button" onClick={handleAddTerm} className="btn btn-secondary">
                  <Plus size={14} /> Add Term
                </button>
              </div>

              <div style={{ maxHeight: '140px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {terminologyList.map((t, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 12px',
                      background: 'var(--bg-surface-2)',
                      borderRadius: '6px',
                      fontSize: '12px'
                    }}
                  >
                    <div>
                      <strong style={{ color: 'var(--accent-primary)', marginRight: '8px' }}>{t.term}</strong>
                      <span style={{ color: 'var(--text-secondary)' }}>{t.definition}</span>
                    </div>
                    <button type="button" onClick={() => handleRemoveTerm(idx)} className="btn-ghost" style={{ padding: '2px' }}>
                      <Trash2 size={12} color="var(--accent-rose)" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: PURPOSE */}
        {currentStep === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                Step 2: Assistant Purpose & Example Questions
              </h2>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                Select what this assistant should assist with and provide sample questions for automated evaluation.
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '10px' }}>
              {PURPOSE_OPTIONS.map((p) => {
                const isSelected = selectedPurposes.includes(p.id);
                return (
                  <div
                    key={p.id}
                    onClick={() => {
                      if (isSelected) {
                        setSelectedPurposes(selectedPurposes.filter((id) => id !== p.id));
                      } else {
                        setSelectedPurposes([...selectedPurposes, p.id]);
                      }
                    }}
                    style={{
                      padding: '12px 14px',
                      borderRadius: '8px',
                      background: isSelected ? 'var(--accent-primary-subtle)' : 'var(--bg-surface-2)',
                      border: isSelected ? '1px solid var(--accent-primary)' : '1px solid var(--border-hairline)',
                      cursor: 'pointer',
                      transition: 'all var(--transition-fast)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: isSelected ? 'var(--accent-primary)' : 'var(--text-primary)' }}>
                        {p.label}
                      </span>
                      {isSelected && <Check size={14} color="var(--accent-primary)" />}
                    </div>
                    <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                      {p.desc}
                    </div>
                  </div>
                );
              })}
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
                What kinds of questions should this assistant answer? (Seed Evaluation Cases)
              </label>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                <input
                  type="text"
                  placeholder="e.g. Why did SSO authentication fail after the May deployment?"
                  value={newQuestion}
                  onChange={(e) => setNewQuestion(e.target.value)}
                  style={{ flex: 1 }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddQuestion())}
                />
                <button type="button" onClick={handleAddQuestion} className="btn btn-secondary">
                  <Plus size={14} /> Add Question
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {exampleQuestions.map((q, qIdx) => (
                  <div
                    key={qIdx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      background: 'var(--bg-surface-2)',
                      borderRadius: '6px',
                      fontSize: '12.5px'
                    }}
                  >
                    <span style={{ color: 'var(--text-primary)' }}>"{q}"</span>
                    <button type="button" onClick={() => handleRemoveQuestion(qIdx)} className="btn-ghost" style={{ padding: '2px' }}>
                      <Trash2 size={12} color="var(--accent-rose)" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: AUDIENCE */}
        {currentStep === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                Step 3: Target Audience & Expertise
              </h2>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                Define who will interact with the assistant to calibrate tone and technical vocabulary.
              </p>
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '8px' }}>
                Primary User Groups
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {AUDIENCE_OPTIONS.map((aud) => {
                  const isSelected = selectedAudiences.includes(aud);
                  return (
                    <button
                      key={aud}
                      type="button"
                      onClick={() => {
                        if (isSelected) {
                          setSelectedAudiences(selectedAudiences.filter((a) => a !== aud));
                        } else {
                          setSelectedAudiences([...selectedAudiences, aud]);
                        }
                      }}
                      className="btn"
                      style={{
                        background: isSelected ? 'var(--accent-primary)' : 'var(--bg-surface-2)',
                        color: isSelected ? '#FFFFFF' : 'var(--text-secondary)',
                        borderColor: isSelected ? 'var(--accent-primary)' : 'var(--border-hairline)',
                        fontSize: '12px',
                        padding: '6px 12px'
                      }}
                    >
                      {aud}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '8px' }}>
                Expected Technical Level
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px' }}>
                {['Beginner', 'Intermediate', 'Advanced', 'Expert', 'Adaptive'].map((lvl) => {
                  const isSelected = technicalLevel.toLowerCase() === lvl.toLowerCase();
                  return (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => setTechnicalLevel(lvl)}
                      style={{
                        padding: '12px 8px',
                        borderRadius: '8px',
                        textAlign: 'center',
                        background: isSelected ? 'var(--accent-primary-subtle)' : 'var(--bg-surface-2)',
                        border: isSelected ? '1px solid var(--accent-primary)' : '1px solid var(--border-hairline)',
                        color: isSelected ? 'var(--accent-primary)' : 'var(--text-secondary)',
                        fontWeight: 600,
                        fontSize: '12px',
                        cursor: 'pointer'
                      }}
                    >
                      {lvl}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
                Audience-Specific Guidance
              </label>
              <textarea
                rows={3}
                value={audienceNotes}
                onChange={(e) => setAudienceNotes(e.target.value)}
                placeholder="e.g. Treat external partners with NDA awareness; Assume internal engineers know Kubernetes fundamentals."
                style={{ width: '100%' }}
              />
            </div>
          </div>
        )}

        {/* STEP 4: RESPONSE STYLE */}
        {currentStep === 4 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                Step 4: Response Style & Formatting
              </h2>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                Configure verbosity, communication tone, and structured presentation guidelines.
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '8px' }}>
                  Response Verbosity
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {[
                    { id: 'concise', label: 'Concise' },
                    { id: 'balanced', label: 'Balanced' },
                    { id: 'detailed', label: 'Detailed' }
                  ].map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setVerbosity(v.id)}
                      className="btn"
                      style={{
                        flex: 1,
                        background: verbosity === v.id ? 'var(--accent-primary)' : 'var(--bg-surface-2)',
                        color: verbosity === v.id ? '#FFFFFF' : 'var(--text-secondary)',
                        fontSize: '12px'
                      }}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '8px' }}>
                  Tone of Voice
                </label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {[
                    { id: 'professional', label: 'Professional' },
                    { id: 'technical', label: 'Technical' },
                    { id: 'formal', label: 'Formal' },
                    { id: 'friendly', label: 'Friendly' }
                  ].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTone(t.id)}
                      className="btn"
                      style={{
                        flex: 1,
                        background: tone === t.id ? 'var(--accent-primary)' : 'var(--bg-surface-2)',
                        color: tone === t.id ? '#FFFFFF' : 'var(--text-secondary)',
                        fontSize: '11.5px',
                        padding: '6px 4px'
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '10px' }}>
                Content Structuring Rules
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                {[
                  { state: stepByStep, setter: setStepByStep, title: 'Step-by-Step Instructions', desc: 'Number actionable steps sequentially' },
                  { state: defineSpecializedTerms, setter: setDefineSpecializedTerms, title: 'Define Specialized Terms', desc: 'Provide inline gloss for internal jargon' },
                  { state: includeExamples, setter: setIncludeExamples, title: 'Include Concrete Examples', desc: 'Provide code or scenario snippets when explaining' },
                  { state: highlightWarnings, setter: setHighlightWarnings, title: 'Highlight Warnings & Risks', desc: 'Emphasize breaking changes or security caveats' }
                ].map((item, idx) => (
                  <div
                    key={idx}
                    onClick={() => item.setter(!item.state)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '10px 14px',
                      background: item.state ? 'var(--accent-primary-subtle)' : 'var(--bg-surface-2)',
                      border: item.state ? '1px solid var(--accent-primary-border)' : '1px solid var(--border-hairline)',
                      borderRadius: '8px',
                      cursor: 'pointer'
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={item.state}
                      onChange={() => {}}
                      style={{ cursor: 'pointer' }}
                    />
                    <div>
                      <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-primary)' }}>{item.title}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* STEP 5: EVIDENCE & GROUNDING */}
        {currentStep === 5 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                Step 5: Evidence Grounding & Insufficient Data Behavior
              </h2>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                Control how the system behaves when retrieved documents provide partial or no answers.
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
              {[
                {
                  id: 'strict',
                  title: 'Strict Grounded',
                  badge: 'Enterprise Default',
                  desc: 'Never extrapolate or speculate. If evidence is missing, state clearly that insufficient documentation was found.'
                },
                {
                  id: 'balanced',
                  title: 'Balanced',
                  badge: 'Guided Insight',
                  desc: 'Answer grounded portions directly, while explicitly labeling any uncertainties or minor logical bridges.'
                },
                {
                  id: 'exploratory',
                  title: 'Exploratory',
                  badge: 'Ideation',
                  desc: 'Allow model interpretations, but strictly delineate verified document facts from speculative reasoning.'
                }
              ].map((m) => {
                const isSelected = groundingMode === m.id;
                return (
                  <div
                    key={m.id}
                    onClick={() => setGroundingMode(m.id)}
                    style={{
                      padding: '16px',
                      borderRadius: '8px',
                      background: isSelected ? 'var(--accent-primary-subtle)' : 'var(--bg-surface-2)',
                      border: isSelected ? '1px solid var(--accent-primary)' : '1px solid var(--border-hairline)',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between'
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <span style={{ fontSize: '13.5px', fontWeight: 600, color: isSelected ? 'var(--accent-primary)' : 'var(--text-primary)' }}>
                          {m.title}
                        </span>
                        <span style={{ fontSize: '10px', background: 'var(--bg-surface-3)', padding: '2px 6px', borderRadius: '4px', color: 'var(--text-muted)' }}>
                          {m.badge}
                        </span>
                      </div>
                      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        {m.desc}
                      </p>
                    </div>
                    {isSelected && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--accent-primary)', fontSize: '11px', marginTop: '12px', fontWeight: 600 }}>
                        <Check size={13} /> Selected Mode
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="calm-panel" style={{ padding: '14px', background: 'var(--bg-surface-2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Disclose Uncertainty
                  </div>
                  <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                    Require explicit statements when questions touch unverified or conflicting areas
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={uncertaintyDisclosure}
                  onChange={(e) => setUncertaintyDisclosure(e.target.checked)}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border-hairline)', paddingTop: '8px' }}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Allow External Prior Knowledge
                  </div>
                  <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                    Permit general LLM knowledge when enterprise documents do not cover the subject
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={allowPriorKnowledge}
                  onChange={(e) => setAllowPriorKnowledge(e.target.checked)}
                />
              </div>
            </div>
          </div>
        )}

        {/* STEP 6: SOURCE AUTHORITY & CONFLICT */}
        {currentStep === 6 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                Step 6: Source Authority Hierarchy & Conflict Handling
              </h2>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                Rank document categories by legal and operational authority. Higher ranked sources take precedence during conflicts.
              </p>
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '8px' }}>
                Authority Ranking (Highest to Lowest)
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {sourceRanking.map((src, idx) => (
                  <div
                    key={src.type}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      background: 'var(--bg-surface-2)',
                      border: '1px solid var(--border-hairline)',
                      borderRadius: '6px',
                      fontSize: '12px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span
                        style={{
                          width: '20px',
                          height: '20px',
                          borderRadius: '4px',
                          background: 'var(--accent-primary-subtle)',
                          color: 'var(--accent-primary)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 700,
                          fontSize: '11px'
                        }}
                      >
                        {idx + 1}
                      </span>
                      <div>
                        <strong style={{ color: 'var(--text-primary)' }}>{src.label}</strong>
                        <span style={{ color: 'var(--text-muted)', marginLeft: '8px', fontSize: '11px' }}>
                          — {src.desc}
                        </span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button
                        type="button"
                        onClick={() => moveSource(idx, -1)}
                        disabled={idx === 0}
                        className="btn-ghost"
                        style={{ padding: '3px' }}
                        title="Move Up"
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveSource(idx, 1)}
                        disabled={idx === sourceRanking.length - 1}
                        className="btn-ghost"
                        style={{ padding: '3px' }}
                        title="Move Down"
                      >
                        <ArrowDown size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '8px' }}>
                When Sources Conflict on Facts
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                {[
                  { id: 'prefer_highest_authority', label: 'Prefer Highest Authority Source', desc: 'Use policy/doc ranked highest in hierarchy' },
                  { id: 'show_both', label: 'Surface Disagreement & Show Both', desc: 'Highlight the divergence and cite both contradictory sources' },
                  { id: 'prefer_latest', label: 'Prefer Most Recently Updated', desc: 'Favor newest document revision timestamp' },
                  { id: 'require_human_review', label: 'Flag for Human Review', desc: 'Refuse automated reconciliation and alert admin' }
                ].map((c) => {
                  const isSelected = conflictStrategy === c.id;
                  return (
                    <div
                      key={c.id}
                      onClick={() => setConflictStrategy(c.id)}
                      style={{
                        padding: '10px 12px',
                        borderRadius: '8px',
                        background: isSelected ? 'var(--accent-primary-subtle)' : 'var(--bg-surface-2)',
                        border: isSelected ? '1px solid var(--accent-primary)' : '1px solid var(--border-hairline)',
                        cursor: 'pointer'
                      }}
                    >
                      <div style={{ fontSize: '12.5px', fontWeight: 600, color: isSelected ? 'var(--accent-primary)' : 'var(--text-primary)', marginBottom: '3px' }}>
                        {c.label}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{c.desc}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* STEP 7: CITATIONS & GRAPH */}
        {currentStep === 7 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                Step 7: Citations & Knowledge Graph Reasoning
              </h2>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                Configure citation verification standards and Neo4j graph traversal depth.
              </p>
            </div>

            <div className="calm-panel" style={{ padding: '16px', background: 'var(--bg-surface-2)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Mandatory Factual Citations
                  </div>
                  <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                    Require verified [EV_#] bracketed citations for every factual statement
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={citationsRequired}
                  onChange={(e) => setCitationsRequired(e.target.checked)}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border-hairline)', paddingTop: '10px' }}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Citation Granularity
                  </div>
                  <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                    Sentence-level strictly tags claims; Paragraph-level gives broader context
                  </div>
                </div>
                <select
                  value={citationGranularity}
                  onChange={(e) => setCitationGranularity(e.target.value)}
                  style={{ width: '160px', height: '32px', fontSize: '12px' }}
                >
                  <option value="sentence">Sentence-Level</option>
                  <option value="claim">Claim-Level</option>
                  <option value="paragraph">Paragraph-Level</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border-hairline)', paddingTop: '10px' }}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Neo4j Multi-Hop Graph Traversal
                  </div>
                  <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                    Explore entity relationships and multi-hop dependency paths in Neo4j
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={graphReasoningEnabled}
                  onChange={(e) => setGraphReasoningEnabled(e.target.checked)}
                />
              </div>

              {graphReasoningEnabled && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border-hairline)', paddingTop: '10px' }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      Max Graph Traversal Depth
                    </div>
                    <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                      Number of relationship hops (2 is optimal for enterprise GraphRAG)
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--accent-primary)' }}>
                      {maxGraphDepth} hops
                    </span>
                    <input
                      type="range"
                      min={1}
                      max={3}
                      value={maxGraphDepth}
                      onChange={(e) => setMaxGraphDepth(parseInt(e.target.value))}
                      style={{ width: '100px' }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* STEP 8: REVIEW & ACTIVATE */}
        {currentStep === 8 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                Step 8: Review & Activate Organization AI Profile
              </h2>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                Review the normalized policy specifications before generating your active profile and personas.
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div className="calm-panel" style={{ padding: '14px', background: 'var(--bg-surface-2)', fontSize: '12px' }}>
                <div style={{ fontWeight: 600, color: 'var(--accent-primary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Organization Context
                </div>
                <div><strong>Company:</strong> {companyName || initialTenantName}</div>
                <div style={{ marginTop: '4px' }}><strong>Industry:</strong> {industry}</div>
                <div style={{ marginTop: '4px' }}><strong>Products:</strong> {products.join(', ') || 'Core Platform'}</div>
                <div style={{ marginTop: '4px' }}><strong>Terminology:</strong> {terminologyList.length} defined terms</div>
              </div>

              <div className="calm-panel" style={{ padding: '14px', background: 'var(--bg-surface-2)', fontSize: '12px' }}>
                <div style={{ fontWeight: 600, color: 'var(--accent-emerald)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Grounding & Citations
                </div>
                <div><strong>Grounding Mode:</strong> {groundingMode.toUpperCase()}</div>
                <div style={{ marginTop: '4px' }}><strong>Citations:</strong> {citationsRequired ? 'Mandatory [EV_#]' : 'Optional'}</div>
                <div style={{ marginTop: '4px' }}><strong>Graph Reasoning:</strong> {graphReasoningEnabled ? `${maxGraphDepth} hops enabled` : 'Disabled'}</div>
                <div style={{ marginTop: '4px' }}><strong>Prior Knowledge:</strong> {allowPriorKnowledge ? 'Allowed' : 'Strictly Disallowed'}</div>
              </div>

              <div className="calm-panel" style={{ padding: '14px', background: 'var(--bg-surface-2)', fontSize: '12px' }}>
                <div style={{ fontWeight: 600, color: 'var(--accent-cyan)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Personas to Provision
                </div>
                <div><strong>Default:</strong> Enterprise Knowledge Assistant</div>
                <div style={{ marginTop: '4px' }}><strong>Specialized:</strong> Technical & Troubleshooting Specialist</div>
                <div style={{ marginTop: '4px' }}><strong>Tone / Style:</strong> {tone} ({verbosity})</div>
              </div>

              <div className="calm-panel" style={{ padding: '14px', background: 'var(--bg-surface-2)', fontSize: '12px' }}>
                <div style={{ fontWeight: 600, color: 'var(--accent-amber)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Source Priority & Conflicts
                </div>
                <div><strong>Top Authority:</strong> {sourceRanking[0]?.label}</div>
                <div style={{ marginTop: '4px' }}><strong>Conflict Rule:</strong> {conflictStrategy.replace(/_/g, ' ')}</div>
                <div style={{ marginTop: '4px' }}><strong>Eval Questions:</strong> {exampleQuestions.length} cases seeded</div>
              </div>
            </div>
          </div>
        )}

        {/* Navigation Buttons */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderTop: '1px solid var(--border-hairline)',
            paddingTop: '20px',
            marginTop: '24px'
          }}
        >
          <div>
            {currentStep > 1 ? (
              <button
                type="button"
                onClick={() => setCurrentStep(currentStep - 1)}
                className="btn btn-secondary"
                style={{ gap: '6px' }}
              >
                <ChevronLeft size={14} /> Back
              </button>
            ) : (
              onCancel && (
                <button type="button" onClick={onCancel} className="btn-ghost">
                  Cancel
                </button>
              )
            )}
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            {currentStep < 8 ? (
              <button
                type="button"
                onClick={() => setCurrentStep(currentStep + 1)}
                className="btn btn-primary"
                style={{ gap: '6px' }}
              >
                Next Step <ChevronRight size={14} />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmitOnboarding}
                disabled={submitting}
                className="btn btn-primary"
                style={{
                  background: 'var(--accent-emerald)',
                  borderColor: 'var(--accent-emerald)',
                  gap: '8px',
                  padding: '9px 24px'
                }}
              >
                {submitting ? (
                  <span>Generating AI Profile & Personas...</span>
                ) : (
                  <>
                    <CheckCircle2 size={16} />
                    <span>Activate AI Profile</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
