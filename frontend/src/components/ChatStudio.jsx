import React, { useState, useEffect, useRef } from 'react';
import { chatApi, chatbotApi } from '../api/client';
import { 
  Bot, 
  Send, 
  Plus, 
  Trash2, 
  Sparkles, 
  FileText, 
  Network, 
  Clock, 
  ChevronDown, 
  ChevronUp,
  Sliders,
  Database,
  Layers,
  Search,
  Check,
  Copy,
  ExternalLink,
  CornerDownLeft,
  HelpCircle,
  Compass,
  ArrowRight
} from 'lucide-react';

export default function ChatStudio() {
  const [conversations, setConversations] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeConvId, setActiveConvId] = useState(null);
  const [activeConv, setActiveConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [botConfig, setBotConfig] = useState(null);

  // Tuner popover
  const [showTuner, setShowTuner] = useState(false);
  const [topK, setTopK] = useState(4);
  const [maxHops, setMaxHops] = useState(2);

  // Citations Inspection HUD state: { [messageId]: { isOpen: boolean, activeTab: 'sources' | 'graph' } }
  const [citationStates, setCitationStates] = useState({});

  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const loadConversations = async () => {
    try {
      const list = await chatApi.listConversations();
      setConversations(list);
      if (list.length > 0 && !activeConvId) {
        selectConversation(list[0].id);
      }
    } catch (err) {
      console.error('Error loading conversations:', err);
    }
  };

  const loadBotConfig = async () => {
    try {
      const cfg = await chatbotApi.getSettings();
      setBotConfig(cfg);
      if (cfg.default_top_k) setTopK(cfg.default_top_k);
      if (cfg.default_max_hops) setMaxHops(cfg.default_max_hops);
    } catch (err) {
      console.error('Error loading chatbot settings:', err);
    }
  };

  useEffect(() => {
    loadConversations();
    loadBotConfig();
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, sending]);

  const selectConversation = async (id) => {
    setActiveConvId(id);
    try {
      const data = await chatApi.getConversation(id);
      setActiveConv(data);
      setMessages(data.messages || []);
    } catch (err) {
      console.error('Failed to load conversation details:', err);
    }
  };

  const handleNewConversation = async () => {
    try {
      const created = await chatApi.createConversation('New Session');
      await loadConversations();
      selectConversation(created.id);
    } catch (err) {
      alert('Failed to initialize session: ' + err.message);
    }
  };

  const handleDeleteConversation = async (e, id) => {
    e.stopPropagation();
    try {
      await chatApi.deleteConversation(id);
      const remaining = conversations.filter((c) => c.id !== id);
      setConversations(remaining);
      if (activeConvId === id) {
        if (remaining.length > 0) {
          selectConversation(remaining[0].id);
        } else {
          setActiveConvId(null);
          setActiveConv(null);
          setMessages([]);
        }
      }
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
  };

  const handleSendMessage = async (e, directText = null) => {
    e?.preventDefault();
    const userText = (typeof directText === 'string' ? directText : inputMessage).trim();
    if (!userText || sending) return;

    let targetConvId = activeConvId;
    if (!targetConvId) {
      try {
        const titleSnippet = userText.length > 28 ? userText.slice(0, 25) + '...' : userText;
        const created = await chatApi.createConversation(titleSnippet || 'New Session');
        targetConvId = created.id;
        setActiveConvId(created.id);
        await loadConversations();
      } catch (err) {
        alert('Failed to initialize session: ' + err.message);
        return;
      }
    }

    if (!directText) {
      setInputMessage('');
    }
    setSending(true);

    const tempUserMsg = {
      id: Date.now(),
      role: 'user',
      content: userText,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    try {
      const assistantMsg = await chatApi.sendMessage(targetConvId, userText, topK, maxHops);
      setMessages((prev) => [...prev, assistantMsg]);
      loadConversations();
    } catch (err) {
      alert('GraphRAG synthesis error: ' + err.message);
    } finally {
      setSending(false);
    }
  };

  const toggleCitationDrawer = (msgId) => {
    setCitationStates((prev) => {
      const current = prev[msgId] || { isOpen: false, activeTab: 'sources' };
      return {
        ...prev,
        [msgId]: { ...current, isOpen: !current.isOpen }
      };
    });
  };

  const setCitationTab = (msgId, tab) => {
    setCitationStates((prev) => ({
      ...prev,
      [msgId]: { ...prev[msgId], activeTab: tab }
    }));
  };

  const filteredConversations = conversations.filter((c) =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 52px)', overflow: 'hidden', background: 'var(--bg-canvas)' }}>
      {/* 1. Left Sidebar: Linear Session Drawer */}
      <aside style={{
        width: '260px',
        borderRight: '1px solid var(--border-hairline)',
        background: 'var(--bg-surface-1)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0
      }}>
        {/* Session Actions & Search */}
        <div style={{ padding: '14px 14px 10px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <button
            onClick={handleNewConversation}
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'space-between', padding: '8px 12px', fontSize: '12px' }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Plus size={14} />
              <span>New Session</span>
            </span>
            <span className="tabular-nums" style={{ fontSize: '10px', opacity: 0.75, background: 'rgba(255,255,255,0.15)', padding: '1px 5px', borderRadius: '4px' }}>
              ⌘N
            </span>
          </button>

          {/* Minimal Search Input */}
          <div style={{ position: 'relative' }}>
            <Search size={13} color="var(--text-muted)" style={{ position: 'absolute', left: '10px', top: '9px' }} />
            <input
              type="text"
              placeholder="Search sessions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                padding: '6px 10px 6px 28px',
                fontSize: '12px',
                background: 'var(--bg-surface-2)',
                borderRadius: '6px'
              }}
            />
          </div>
        </div>

        {/* Sessions List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <div style={{ fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', padding: '6px 8px' }}>
            Recent Sessions ({filteredConversations.length})
          </div>

          {filteredConversations.length === 0 ? (
            <div style={{ padding: '20px 10px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
              No sessions found
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const isCurrent = conv.id === activeConvId;
              return (
                <div
                  key={conv.id}
                  onClick={() => selectConversation(conv.id)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    background: isCurrent ? 'var(--bg-surface-3)' : 'transparent',
                    border: `1px solid ${isCurrent ? 'var(--border-subtle)' : 'transparent'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    transition: 'all 0.15s ease',
                    group: 'session-row'
                  }}
                >
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: '6px' }}>
                    <div style={{ 
                      fontSize: '12.5px', 
                      fontWeight: isCurrent ? 500 : 400, 
                      color: isCurrent ? 'var(--text-primary)' : 'var(--text-secondary)' 
                    }}>
                      {conv.title}
                    </div>
                    <div className="tabular-nums" style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '1px' }}>
                      {conv.message_count} turns · {new Date(conv.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </div>
                  </div>

                  <button
                    onClick={(e) => handleDeleteConversation(e, conv.id)}
                    className="btn-ghost"
                    style={{ padding: '4px', borderRadius: '4px', opacity: isCurrent ? 0.8 : 0.3 }}
                    title="Delete session"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* 2. Main Workspace: Chat Stream & Inspection HUD */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
        {/* Stream Header */}
        <div style={{
          height: '42px',
          borderBottom: '1px solid var(--border-hairline)',
          background: 'var(--bg-surface-1)',
          padding: '0 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '12px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Persona:</span>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{botConfig?.name || 'OmniGraph Assistant'}</span>
            <span className="eyebrow-tag" style={{ fontSize: '9.5px', padding: '1px 6px' }}>
              {botConfig?.tone || 'professional'}
            </span>
          </div>

          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowTuner(!showTuner)}
              className="btn btn-secondary"
              style={{ padding: '3px 9px', fontSize: '11.5px', borderRadius: '6px', gap: '5px' }}
            >
              <Sliders size={12} />
              <span>Tuning</span>
              <span className="tabular-nums" style={{ color: 'var(--accent-primary)', fontSize: '10.5px' }}>
                K={topK} H={maxHops}
              </span>
            </button>

            {/* Tuning Popover HUD */}
            {showTuner && (
              <div 
                className="hairline-card"
                style={{
                  position: 'absolute',
                  right: 0,
                  top: '120%',
                  width: '260px',
                  padding: '14px',
                  boxShadow: 'var(--shadow-lg)',
                  zIndex: 80,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px'
                }}
              >
                <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                  Retrieval Hyperparameters
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', marginBottom: '4px' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Vector Top-K Chunks:</span>
                    <strong className="tabular-nums" style={{ color: 'var(--accent-primary)' }}>{topK}</strong>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={topK}
                    onChange={(e) => setTopK(parseInt(e.target.value))}
                    style={{ width: '100%', cursor: 'pointer' }}
                  />
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', marginBottom: '4px' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Graph Max Hops:</span>
                    <strong className="tabular-nums" style={{ color: 'var(--accent-cyan)' }}>{maxHops}</strong>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={3}
                    value={maxHops}
                    onChange={(e) => setMaxHops(parseInt(e.target.value))}
                    style={{ width: '100%', cursor: 'pointer' }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Message Feed Area */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '28px 20px 100px 20px' }}>
          <div style={{ maxWidth: '820px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {messages.length === 0 ? (
              <div style={{ textAlign: 'center', margin: '80px auto', maxWidth: '460px' }}>
                <div style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '10px',
                  background: 'var(--bg-surface-2)',
                  border: '1px solid var(--border-subtle)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--accent-primary)',
                  marginBottom: '16px'
                }}>
                  <Sparkles size={20} />
                </div>
                <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '6px' }}>
                  {botConfig?.welcome_message || 'Welcome to your GraphRAG Assistant'}
                </h3>
                <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                  Grounded queries combine PostgreSQL vector similarity matching with Neo4j relational graph traversals.
                </p>
              </div>
            ) : (
              messages.map((msg, idx) => {
                const isUser = msg.role === 'user';
                const citations = msg.citations;
                const hasCitations = citations && (citations.sources?.length > 0 || citations.graph?.length > 0);
                const citationState = citationStates[msg.id] || { isOpen: false, activeTab: 'sources' };
                const clarificationOpts = msg.clarification_options?.length
                  ? msg.clarification_options
                  : (citations?.clarification_options || []);
                const followUpOpts = msg.follow_up_suggestions?.length
                  ? msg.follow_up_suggestions
                  : (citations?.follow_up_suggestions || []);

                return (
                  <div
                    key={msg.id || idx}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: isUser ? 'flex-end' : 'flex-start',
                      width: '100%'
                    }}
                  >
                    {/* Message Bubble Container */}
                    <div style={{
                      display: 'flex',
                      gap: '12px',
                      maxWidth: isUser ? '85%' : '100%',
                      alignItems: 'flex-start'
                    }}>
                      {!isUser && (
                        <div style={{
                          width: '26px',
                          height: '26px',
                          borderRadius: '7px',
                          background: 'var(--bg-surface-3)',
                          border: '1px solid var(--border-hairline)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--accent-primary)',
                          flexShrink: 0,
                          marginTop: '2px'
                        }}>
                          <Bot size={15} />
                        </div>
                      )}

                      <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
                        <div
                          style={{
                            padding: isUser ? '10px 14px' : '0 4px',
                            borderRadius: isUser ? '10px' : '0',
                            background: isUser ? 'var(--bg-surface-3)' : 'transparent',
                            border: isUser ? '1px solid var(--border-subtle)' : 'none',
                            color: 'var(--text-primary)',
                            fontSize: '13.5px',
                            lineHeight: 1.65,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}
                        >
                          {msg.content}
                        </div>

                        {/* Clarification Options Chips */}
                        {!isUser && clarificationOpts.length > 0 && (
                          <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <div style={{ fontSize: '11px', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 500 }}>
                              <HelpCircle size={12} />
                              <span>Select an option to clarify:</span>
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                              {clarificationOpts.map((opt, oIdx) => (
                                <button
                                  key={oIdx}
                                  onClick={() => handleSendMessage(null, opt)}
                                  className="btn-ghost"
                                  style={{
                                    fontSize: '11.5px',
                                    padding: '5px 12px',
                                    borderRadius: '16px',
                                    background: 'var(--bg-surface-3)',
                                    border: '1px solid var(--accent-primary)',
                                    color: 'var(--accent-primary)',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '5px'
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.background = 'var(--accent-primary)';
                                    e.currentTarget.style.color = '#FFFFFF';
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.background = 'var(--bg-surface-3)';
                                    e.currentTarget.style.color = 'var(--accent-primary)';
                                  }}
                                >
                                  <span>{opt}</span>
                                  <ArrowRight size={11} />
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Follow-up Exploration Suggestions */}
                        {!isUser && followUpOpts.length > 0 && (
                          <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <Compass size={12} />
                              <span>Explore further:</span>
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                              {followUpOpts.map((sug, sIdx) => (
                                <button
                                  key={sIdx}
                                  onClick={() => handleSendMessage(null, sug)}
                                  className="btn-ghost"
                                  style={{
                                    fontSize: '11.5px',
                                    padding: '5px 11px',
                                    borderRadius: '16px',
                                    background: 'var(--bg-surface-2)',
                                    border: '1px solid var(--border-subtle)',
                                    color: 'var(--text-secondary)',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '5px'
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.borderColor = 'var(--accent-primary)';
                                    e.currentTarget.style.color = 'var(--text-primary)';
                                    e.currentTarget.style.background = 'var(--bg-surface-3)';
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.borderColor = 'var(--border-subtle)';
                                    e.currentTarget.style.color = 'var(--text-secondary)';
                                    e.currentTarget.style.background = 'var(--bg-surface-2)';
                                  }}
                                >
                                  <span>{sug}</span>
                                  <ArrowRight size={10} style={{ opacity: 0.6 }} />
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Assistant Provenance & Dual Citations HUD */}
                        {!isUser && (
                          <div style={{ marginTop: '10px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11px' }}>
                              {citations?.execution_time_ms && (
                                <span className="tabular-nums" style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                  <Clock size={11} />
                                  <span>{citations.execution_time_ms.toFixed(0)}ms</span>
                                </span>
                              )}

                              {hasCitations && (
                                <button
                                  onClick={() => toggleCitationDrawer(msg.id)}
                                  className="btn btn-secondary"
                                  style={{ padding: '2px 8px', fontSize: '11px', borderRadius: '5px', gap: '5px' }}
                                >
                                  <span>Dual Provenance</span>
                                  <span className="tabular-nums" style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>
                                    {citations.sources?.length || 0} chunks · {citations.graph?.length || 0} relations
                                  </span>
                                  {citationState.isOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                                </button>
                              )}
                            </div>

                            {/* Inspection HUD Panel */}
                            {hasCitations && citationState.isOpen && (
                              <div 
                                className="hairline-card" 
                                style={{
                                  marginTop: '10px',
                                  padding: '14px',
                                  borderRadius: '10px',
                                  background: 'var(--bg-surface-2)',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '12px'
                                }}
                              >
                                {/* Segmented Tab Bar inside HUD */}
                                <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-hairline)', paddingBottom: '8px' }}>
                                  <button
                                    onClick={() => setCitationTab(msg.id, 'sources')}
                                    className="btn-ghost"
                                    style={{
                                      fontSize: '11.5px',
                                      padding: '3px 8px',
                                      borderRadius: '4px',
                                      fontWeight: citationState.activeTab === 'sources' ? 600 : 400,
                                      color: citationState.activeTab === 'sources' ? 'var(--text-primary)' : 'var(--text-muted)',
                                      background: citationState.activeTab === 'sources' ? 'var(--bg-surface-3)' : 'transparent',
                                    }}
                                  >
                                    <FileText size={12} />
                                    <span>Document Chunks ({citations.sources?.length || 0})</span>
                                  </button>

                                  <button
                                    onClick={() => setCitationTab(msg.id, 'graph')}
                                    className="btn-ghost"
                                    style={{
                                      fontSize: '11.5px',
                                      padding: '3px 8px',
                                      borderRadius: '4px',
                                      fontWeight: citationState.activeTab === 'graph' ? 600 : 400,
                                      color: citationState.activeTab === 'graph' ? 'var(--text-primary)' : 'var(--text-muted)',
                                      background: citationState.activeTab === 'graph' ? 'var(--bg-surface-3)' : 'transparent',
                                    }}
                                  >
                                    <Network size={12} />
                                    <span>Knowledge Graph ({citations.graph?.length || 0})</span>
                                  </button>
                                </div>

                                {/* Content Tab 1: pgvector Chunks */}
                                {citationState.activeTab === 'sources' && (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {citations.sources.map((src, sIdx) => (
                                      <div key={sIdx} style={{
                                        background: 'var(--bg-surface-1)',
                                        border: '1px solid var(--border-hairline)',
                                        borderRadius: '7px',
                                        padding: '10px 12px'
                                      }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11.5px' }}>
                                            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{src.source_name}</span>
                                            <span className="tabular-nums" style={{ color: 'var(--text-muted)', fontSize: '10.5px' }}>#chunk-{src.chunk_index}</span>
                                          </div>
                                          <div className="tabular-nums" style={{ 
                                            color: 'var(--accent-emerald)', 
                                            fontSize: '11px',
                                            fontWeight: 600,
                                            background: 'var(--accent-emerald-subtle)',
                                            padding: '1px 6px',
                                            borderRadius: '4px'
                                          }}>
                                            {(src.similarity_score * 100).toFixed(1)}% match
                                          </div>
                                        </div>
                                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5, fontFamily: 'var(--font-mono)' }}>
                                          "{src.snippet}"
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {/* Content Tab 2: Neo4j Graph Relational Triples */}
                                {citationState.activeTab === 'graph' && (
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                    {citations.graph.length === 0 ? (
                                      <div style={{ color: 'var(--text-muted)', fontSize: '11.5px' }}>No direct relational triples traversed for this query.</div>
                                    ) : (
                                      citations.graph.map((rel, rIdx) => (
                                        <div key={rIdx} style={{
                                          background: 'var(--bg-surface-1)',
                                          border: '1px solid var(--border-hairline)',
                                          borderRadius: '6px',
                                          padding: '5px 9px',
                                          fontSize: '11.5px',
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: '6px'
                                        }}>
                                          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{rel.source}</span>
                                          <span style={{ color: 'var(--accent-primary)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                            ──[{rel.relationship}]──&gt;
                                          </span>
                                          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{rel.target}</span>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}

            {sending && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '12px' }}>
                <span className="telemetry-dot online"></span>
                <span>Synthesizing hybrid context via pgvector & Neo4j...</span>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* 3. Docked Floating Command Input */}
        <div style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '16px 20px',
          background: 'linear-gradient(180deg, transparent 0%, var(--bg-canvas) 40%)'
        }}>
          <form 
            onSubmit={handleSendMessage}
            className="hairline-card"
            style={{
              maxWidth: '820px',
              margin: '0 auto',
              padding: '6px 8px 6px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              background: 'var(--bg-surface-2)',
              boxShadow: 'var(--shadow-md)'
            }}
          >
            <input
              type="text"
              placeholder="Ask a question grounded in vector embeddings & graph knowledge..."
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              disabled={sending}
              style={{
                flex: 1,
                border: 'none',
                background: 'transparent',
                fontSize: '13px',
                padding: '8px 0',
                boxShadow: 'none'
              }}
            />

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="tabular-nums" style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '2px' }}>
                <CornerDownLeft size={11} /> ↵
              </span>
              <button 
                type="submit" 
                disabled={sending || !inputMessage.trim()}
                className="btn btn-primary"
                style={{ padding: '6px 12px', borderRadius: '6px' }}
              >
                <span>Send</span>
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
