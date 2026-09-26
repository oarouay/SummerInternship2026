import React, { useState, useEffect, useRef } from 'react';
import { chatApi, chatbotApi, personasApi } from '../api/client';
import { 
  Bot, 
  Send, 
  Plus, 
  Trash2, 
  Sparkles, 
  FileText, 
  ChevronDown, 
  ChevronUp, 
  Search, 
  Check, 
  Edit2, 
  X, 
  Sliders, 
  HelpCircle, 
  ArrowRight, 
  Compass, 
  Copy, 
  CheckCheck,
  PanelLeftClose,
  PanelLeftOpen,
  BookOpen,
  AlertCircle
} from 'lucide-react';
import MarkdownMessage from './MarkdownMessage';
import { useConfirm } from './ConfirmModal';


export default function ChatStudio({ initialSourceScope = null }) {
  const confirm = useConfirm();
  const [conversations, setConversations] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeConvId, setActiveConvId] = useState(null);
  const [activeConv, setActiveConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [botConfig, setBotConfig] = useState(null);

  // Personas
  const [personas, setPersonas] = useState([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState(null);

  // Sidebar collapse
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Inline renaming state
  const [editingConvId, setEditingConvId] = useState(null);
  const [editingTitle, setEditingTitle] = useState('');

  // Diagnostics & Tuner popover
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [topK, setTopK] = useState(4);
  const [maxHops, setMaxHops] = useState(2);

  // Evidence Inspector Panel: { isOpen: boolean, messageId: number | null, activeTab: 'passages' | 'graph' }
  const [inspector, setInspector] = useState({
    isOpen: false,
    messageId: null,
    activeTab: 'passages',
    citations: null
  });

  // Copied message feedback
  const [copiedMsgId, setCopiedMsgId] = useState(null);

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
      if (cfg?.default_top_k) setTopK(cfg.default_top_k);
      if (cfg?.default_max_hops) setMaxHops(cfg.default_max_hops);
    } catch (err) {
      console.error('Error loading chatbot settings:', err);
    }
  };

  const loadPersonas = async () => {
    try {
      const list = await personasApi.list();
      setPersonas(list);
      if (list.length > 0 && !selectedPersonaId) {
        const def = list.find((p) => p.is_default) || list[0];
        setSelectedPersonaId(def.id);
      }
    } catch (err) {
      console.warn('Error loading personas:', err);
    }
  };

  useEffect(() => {
    loadConversations();
    loadBotConfig();
    loadPersonas();
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, sending]);

  const selectConversation = async (id) => {
    setActiveConvId(id);
    setEditingConvId(null);
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
      const created = await chatApi.createConversation('New Conversation');
      await loadConversations();
      selectConversation(created.id);
    } catch (err) {
      alert('Failed to initialize session: ' + err.message);
    }
  };

  const handleStartRename = (e, conv) => {
    e.stopPropagation();
    setEditingConvId(conv.id);
    setEditingTitle(conv.title);
  };

  const handleSaveRename = async (e, convId) => {
    e?.stopPropagation();
    if (!editingTitle.trim()) {
      setEditingConvId(null);
      return;
    }
    try {
      await chatApi.renameConversation(convId, editingTitle.trim());
      setEditingConvId(null);
      await loadConversations();
      if (activeConvId === convId && activeConv) {
        setActiveConv({ ...activeConv, title: editingTitle.trim() });
      }
    } catch (err) {
      alert('Rename failed: ' + err.message);
    }
  };

  const handleDeleteConversation = async (e, id) => {
    e.stopPropagation();
    const target = conversations.find((c) => c.id === id);
    const titleText = target?.title ? `"${target.title}"` : 'this conversation';

    const confirmed = await confirm({
      title: 'Delete Conversation History?',
      description: `Are you sure you want to delete ${titleText}? All messages, retrieved passages, and graph citations within this session will be permanently removed.`,
      confirmText: 'Delete Conversation',
      cancelText: 'Cancel',
      variant: 'danger'
    });
    if (!confirmed) return;

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
        const titleSnippet = userText.length > 30 ? userText.slice(0, 28) + '...' : userText;
        const created = await chatApi.createConversation(titleSnippet || 'New Conversation');
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

    const tempAssistantId = Date.now() + 1;
    const tempAssistantMsg = {
      id: tempAssistantId,
      role: 'assistant',
      content: '',
      isStreaming: true,
      created_at: new Date().toISOString(),
      citations: null,
      follow_up_suggestions: [],
      clarification_options: [],
    };

    setMessages((prev) => [...prev, tempUserMsg, tempAssistantMsg]);

    let textBuffer = '';
    let flushTimer = null;

    const flushBuffer = () => {
      if (!textBuffer) return;
      const chunkToFlush = textBuffer;
      textBuffer = '';
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempAssistantId
            ? { ...m, content: m.content + chunkToFlush }
            : m
        )
      );
    };

    const scheduleFlush = () => {
      if (!flushTimer) {
        flushTimer = setTimeout(() => {
          flushTimer = null;
          flushBuffer();
        }, 35);
      }
    };

    try {
      await chatApi.streamMessage(targetConvId, userText, topK, maxHops, selectedPersonaId, {
        onToken: (chunk) => {
          textBuffer += chunk;
          scheduleFlush();
        },
        onMetadata: (meta) => {
          if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
          }
          flushBuffer();
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempAssistantId
                ? {
                    ...m,
                    citations: {
                      sources: meta.source_citations || [],
                      graph: meta.graph_citations || [],
                      execution_time_ms: meta.execution_time_ms || 0,
                      action: meta.action,
                      entities_detected: meta.entities_detected || [],
                      evidence_status: meta.evidence_status || 'sufficient',
                      persona_name: meta.persona_name,
                      ai_profile_version: meta.ai_profile_version,
                    },
                    follow_up_suggestions: meta.follow_up_suggestions || [],
                    clarification_options: meta.clarification_options || [],
                    execution_time_ms: meta.execution_time_ms,
                  }
                : m
            )
          );
        },
        onDone: () => {
          if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
          }
          flushBuffer();
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempAssistantId ? { ...m, isStreaming: false } : m
            )
          );
          loadConversations();
        },
        onError: (err) => {
          if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
          }
          flushBuffer();
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempAssistantId
                ? { ...m, isStreaming: false, interrupted: true }
                : m
            )
          );
          console.error('[ChatStudio] Stream error:', err);
        },
      });
    } catch (err) {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      flushBuffer();
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempAssistantId
            ? { ...m, isStreaming: false, interrupted: true }
            : m
        )
      );
    } finally {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      flushBuffer();
      setSending(false);
    }
  };


  const handleCopyMessage = (msgId, text) => {
    navigator.clipboard.writeText(text);
    setCopiedMsgId(msgId);
    setTimeout(() => setCopiedMsgId(null), 2000);
  };

  const openInspector = (msgId, citations, initialTab = 'passages') => {
    setInspector({
      isOpen: true,
      messageId: msgId,
      activeTab: initialTab,
      citations
    });
  };

  const filteredConversations = conversations.filter((c) =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden', background: 'var(--bg-canvas)' }}>
      {/* 1. Left Sessions Sidebar (Collapsible) */}
      {sidebarOpen ? (
        <aside
          style={{
            width: '260px',
            minWidth: '260px',
            borderRight: '1px solid var(--border-hairline)',
            background: 'var(--bg-surface-1)',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
            transition: 'width var(--transition-normal)'
          }}
        >
          {/* Top Actions */}
          <div style={{ padding: '14px 12px 10px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <button
                onClick={handleNewConversation}
                className="btn btn-primary"
                style={{ flex: 1, padding: '7px 12px', fontSize: '12px', gap: '6px' }}
              >
                <Plus size={14} />
                <span>New Conversation</span>
              </button>
              <button
                onClick={() => setSidebarOpen(false)}
                className="btn-ghost"
                style={{ padding: '6px', marginLeft: '6px' }}
                title="Hide conversation list"
                aria-label="Hide conversation list"
              >
                <PanelLeftClose size={15} />
              </button>
            </div>

            <div style={{ position: 'relative' }}>
              <Search size={13} color="var(--text-muted)" style={{ position: 'absolute', left: '10px', top: '9px' }} />
              <input
                type="search"
                placeholder="Search sessions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ paddingLeft: '30px', paddingRight: '8px', fontSize: '12px', height: '32px' }}
              />
            </div>
          </div>

          {/* Session List */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', padding: '6px 8px', fontWeight: 600 }}>
              Recent Sessions ({filteredConversations.length})
            </div>

            {filteredConversations.length === 0 ? (
              <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                No conversations found.
              </div>
            ) : (
              filteredConversations.map((c) => {
                const isActive = activeConvId === c.id;
                const isEditing = editingConvId === c.id;

                return (
                  <div
                    key={c.id}
                    onClick={() => selectConversation(c.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 10px',
                      borderRadius: '7px',
                      background: isActive ? 'var(--bg-surface-2)' : 'transparent',
                      border: isActive ? '1px solid var(--border-subtle)' : '1px solid transparent',
                      cursor: 'pointer',
                      gap: '8px',
                      transition: 'background var(--transition-fast)'
                    }}
                  >
                    {isEditing ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1 }} onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          autoFocus
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveRename(e, c.id);
                            if (e.key === 'Escape') setEditingConvId(null);
                          }}
                          style={{ height: '26px', fontSize: '12px', padding: '2px 6px' }}
                        />
                        <button
                          onClick={(e) => handleSaveRename(e, c.id)}
                          className="btn-ghost"
                          style={{ padding: '3px' }}
                          title="Save title"
                        >
                          <Check size={13} color="var(--accent-emerald)" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <div style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', flex: 1 }}>
                          <span
                            style={{
                              fontSize: '12.5px',
                              fontWeight: isActive ? 600 : 400,
                              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            {c.title}
                          </span>
                        </div>

                        {/* Hover Actions */}
                        <div style={{ display: 'flex', gap: '2px', opacity: isActive ? 1 : 0.6 }}>
                          <button
                            onClick={(e) => handleStartRename(e, c)}
                            className="btn-ghost"
                            style={{ padding: '3px' }}
                            title="Rename"
                            aria-label="Rename conversation"
                          >
                            <Edit2 size={12} />
                          </button>
                          <button
                            onClick={(e) => handleDeleteConversation(e, c.id)}
                            className="btn-ghost"
                            style={{ padding: '3px' }}
                            title="Delete"
                            aria-label="Delete conversation"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </aside>
      ) : (
        /* Collapsed Sidebar Restore Button */
        <div style={{ padding: '12px 6px', borderRight: '1px solid var(--border-hairline)', background: 'var(--bg-surface-1)' }}>
          <button
            onClick={() => setSidebarOpen(true)}
            className="btn-ghost"
            style={{ padding: '6px' }}
            title="Open conversation history"
            aria-label="Open conversation history"
          >
            <PanelLeftOpen size={17} />
          </button>
        </div>
      )}

      {/* 2. Center Reading Column (Constrained to 740px) */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, height: '100%', position: 'relative' }}>
        {/* Chat Top Header */}
        <header
          style={{
            height: '48px',
            borderBottom: '1px solid var(--border-hairline)',
            background: 'var(--bg-surface-1)',
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', overflow: 'hidden' }}>
            <h2 style={{ fontSize: '13.5px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activeConv ? activeConv.title : 'Ask Knowledge Workspace'}
            </h2>
            <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>·</span>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: 'var(--text-secondary)' }}>
              <BookOpen size={12} style={{ color: 'var(--accent-primary)' }} />
              <span>
                {initialSourceScope ? `Scope: ${initialSourceScope.sourceName}` : 'Scope: All Knowledge Sources'}
              </span>
            </div>

            {personas.length > 0 && (
              <>
                <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>·</span>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                  <Bot size={13} style={{ color: 'var(--accent-primary)' }} />
                  <select
                    value={selectedPersonaId || ''}
                    onChange={(e) => setSelectedPersonaId(parseInt(e.target.value))}
                    style={{
                      height: '26px',
                      fontSize: '11.5px',
                      padding: '0 6px',
                      background: 'var(--bg-surface-2)',
                      border: '1px solid var(--border-hairline)',
                      borderRadius: '6px',
                      color: 'var(--text-primary)'
                    }}
                    title="Active Persona for this inquiry"
                  >
                    {personas.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} {p.is_default ? '(Default)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
          </div>

          {/* Diagnostics Disclosure Dropdown */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowDiagnostics(!showDiagnostics)}
              className="btn btn-secondary"
              style={{ padding: '4px 10px', fontSize: '11.5px', gap: '6px' }}
            >
              <Sliders size={12} />
              <span>Answer Details</span>
              {showDiagnostics ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>

            {showDiagnostics && (
              <div
                className="calm-panel"
                style={{
                  position: 'absolute',
                  right: 0,
                  top: '100%',
                  marginTop: '6px',
                  width: '260px',
                  padding: '14px',
                  zIndex: 80,
                  boxShadow: 'var(--shadow-lg)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px'
                }}
              >
                <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.04em' }}>
                  Retrieval Diagnostics
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Passages to Retrieve (Top-K):</span>
                    <strong className="tabular-nums" style={{ color: 'var(--accent-primary)' }}>{topK}</strong>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={topK}
                    onChange={(e) => setTopK(parseInt(e.target.value))}
                    style={{ width: '100%' }}
                  />
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Connection Depth (Hops):</span>
                    <strong className="tabular-nums" style={{ color: 'var(--accent-cyan)' }}>{maxHops}</strong>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={3}
                    value={maxHops}
                    onChange={(e) => setMaxHops(parseInt(e.target.value))}
                    style={{ width: '100%' }}
                  />
                </div>

                <div style={{ fontSize: '11px', color: 'var(--text-muted)', borderTop: '1px solid var(--border-hairline)', paddingTop: '8px' }}>
                  Adjusts real-time retrieval parameters for this chat session.
                </div>
              </div>
            )}
          </div>
        </header>

        {/* Message Feed Area (Constrained 740px Reading Column) */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 20px 120px 20px' }}>
          <div style={{ maxWidth: 'var(--chat-reading-width)', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {messages.length === 0 ? (
              <div className="empty-state-box" style={{ margin: '60px auto' }}>
                <div className="empty-state-icon">
                  <Sparkles size={22} />
                </div>
                <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '6px' }}>
                  {botConfig?.welcome_message || 'Welcome to OmniGraph Knowledge Workspace'}
                </h3>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6, maxWidth: '50ch' }}>
                  Ask questions across your organization’s documents. Responses are grounded in semantic vector embeddings and structured Neo4j graph relationships.
                </p>
              </div>
            ) : (
              messages.map((msg, idx) => {
                const isUser = msg.role === 'user';
                const citations = msg.citations;
                const sourceCount = citations?.sources?.length || 0;
                const graphCount = citations?.graph?.length || 0;
                const hasEvidence = citations && (sourceCount > 0 || graphCount > 0);
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
                    <div style={{ display: 'flex', gap: '12px', maxWidth: isUser ? '85%' : '100%', alignItems: 'flex-start' }}>
                      {!isUser && (
                        <div
                          style={{
                            width: '28px',
                            height: '28px',
                            borderRadius: '8px',
                            background: 'var(--bg-surface-2)',
                            border: '1px solid var(--border-subtle)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--accent-primary)',
                            flexShrink: 0,
                            marginTop: '2px'
                          }}
                        >
                          <Bot size={15} />
                        </div>
                      )}

                      <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
                        {/* Text Bubble / Markdown Message */}
                        {isUser ? (
                          <div
                            style={{
                              padding: '10px 16px',
                              borderRadius: '10px',
                              background: 'var(--bg-surface-2)',
                              border: '1px solid var(--border-hairline)',
                              color: 'var(--text-primary)',
                              fontSize: '14px',
                              lineHeight: 1.65,
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word'
                            }}
                          >
                            {msg.content}
                          </div>
                        ) : (
                          <div style={{ padding: '0 2px' }}>
                            <MarkdownMessage
                              content={msg.content}
                              isStreaming={Boolean(msg.isStreaming)}
                            />
                            {msg.interrupted && (
                              <div className="stream-interrupted-badge">
                                <AlertCircle size={12} />
                                <span>Response generation interrupted</span>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Clarification Chips */}
                        {!isUser && clarificationOpts.length > 0 && (
                          <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <div style={{ fontSize: '11px', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: '5px', fontWeight: 600 }}>
                              <HelpCircle size={13} />
                              <span>Clarify Concept (Graph Disambiguation):</span>
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                              {clarificationOpts.map((opt, oIdx) => (
                                <button
                                  key={oIdx}
                                  onClick={() => handleSendMessage(null, opt)}
                                  className="disambiguation-chip"
                                >
                                  <span>{opt}</span>
                                  <ArrowRight size={11} />
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Follow-up Suggestions */}
                        {!isUser && followUpOpts.length > 0 && (
                          <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <Compass size={12} />
                              <span>Related Inquiries:</span>
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                              {followUpOpts.map((sug, sIdx) => (
                                <button
                                  key={sIdx}
                                  onClick={() => handleSendMessage(null, sug)}
                                  className="btn btn-secondary"
                                  style={{ fontSize: '11.5px', padding: '4px 10px', borderRadius: '16px' }}
                                >
                                  <span>{sug}</span>
                                  <ArrowRight size={10} style={{ opacity: 0.6 }} />
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Evidence Bar & Copy Action */}
                        {!isUser && (
                          <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            {hasEvidence && (
                              <button
                                onClick={() => openInspector(msg.id, citations, 'passages')}
                                className="btn btn-secondary"
                                style={{ padding: '3px 10px', fontSize: '11.5px', gap: '6px' }}
                              >
                                <FileText size={12} style={{ color: 'var(--accent-primary)' }} />
                                <span>Supporting Sources ({sourceCount} passages · {graphCount} triples)</span>
                              </button>
                            )}

                            {citations?.persona_name && (
                              <span style={{ fontSize: '10.5px', background: 'var(--bg-surface-3)', color: 'var(--text-secondary)', padding: '2px 7px', borderRadius: '4px', fontWeight: 500 }}>
                                {citations.persona_name}
                              </span>
                            )}

                            {citations?.evidence_status && citations.evidence_status !== 'sufficient' && (
                              <span style={{ fontSize: '10.5px', background: 'var(--accent-amber-subtle)', color: 'var(--accent-amber-text)', padding: '2px 7px', borderRadius: '4px', fontWeight: 500 }}>
                                {citations.evidence_status}
                              </span>
                            )}

                            {citations?.execution_time_ms && (
                              <span className="tabular-nums" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                {citations.execution_time_ms.toFixed(0)}ms
                              </span>
                            )}

                            <button
                              onClick={() => handleCopyMessage(msg.id, msg.content)}
                              className="btn-ghost"
                              style={{ padding: '3px 6px', fontSize: '11px', color: 'var(--text-muted)' }}
                              title="Copy answer"
                              aria-label="Copy answer"
                            >
                              {copiedMsgId === msg.id ? (
                                <>
                                  <CheckCheck size={12} color="var(--accent-emerald)" />
                                  <span style={{ color: 'var(--accent-emerald)' }}>Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy size={12} />
                                  <span>Copy</span>
                                </>
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}

            {sending && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-muted)', fontSize: '13px', paddingLeft: '40px' }}>
                <Sparkles size={15} style={{ color: 'var(--accent-primary)', animation: 'pulse 1.5s infinite' }} />
                <span>Synthesizing answer from vector & graph evidence...</span>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Composer Form (Floating Bottom Bar) */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: '16px 24px 20px 24px',
            background: 'linear-gradient(to top, var(--bg-canvas) 80%, transparent 100%)'
          }}
        >
          <form
            onSubmit={handleSendMessage}
            style={{
              maxWidth: 'var(--chat-reading-width)',
              margin: '0 auto',
              display: 'flex',
              alignItems: 'center',
              background: 'var(--bg-surface-1)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '10px',
              padding: '4px 6px 4px 14px',
              boxShadow: 'var(--shadow-md)'
            }}
          >
            <input
              type="text"
              placeholder="Ask a question about your organization’s knowledge…"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              disabled={sending}
              style={{
                flex: 1,
                border: 'none',
                background: 'transparent',
                boxShadow: 'none',
                padding: '8px 0',
                fontSize: '13.5px'
              }}
            />

            <button
              type="submit"
              disabled={!inputMessage.trim() || sending}
              className="btn btn-primary"
              style={{ padding: '6px 14px', borderRadius: '7px' }}
              aria-label="Send inquiry"
            >
              <Send size={13} />
              <span>Ask</span>
            </button>
          </form>
        </div>
      </div>

      {/* 3. Right Evidence Inspector (Side-by-side Panel, 390px) */}
      {inspector.isOpen && (
        <aside
          style={{
            width: 'var(--inspector-width)',
            minWidth: 'var(--inspector-width)',
            borderLeft: '1px solid var(--border-hairline)',
            background: 'var(--bg-surface-1)',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0
          }}
        >
          {/* Inspector Header */}
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-hairline)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <BookOpen size={16} style={{ color: 'var(--accent-primary)' }} />
              <h3 style={{ fontSize: '13.5px', fontWeight: 600 }}>Supporting Evidence</h3>
            </div>
            <button
              onClick={() => setInspector({ ...inspector, isOpen: false })}
              className="btn-ghost"
              style={{ padding: '4px' }}
              aria-label="Close evidence inspector"
            >
              <X size={15} />
            </button>
          </div>

          {/* Inspector Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border-hairline)', background: 'var(--bg-surface-2)', padding: '0 18px' }}>
            <button
              onClick={() => setInspector({ ...inspector, activeTab: 'passages' })}
              className="btn-ghost"
              style={{
                borderRadius: 0,
                padding: '9px 12px',
                fontSize: '12px',
                fontWeight: inspector.activeTab === 'passages' ? 600 : 500,
                color: inspector.activeTab === 'passages' ? 'var(--accent-primary)' : 'var(--text-secondary)',
                borderBottom: inspector.activeTab === 'passages' ? '2px solid var(--accent-primary)' : '2px solid transparent'
              }}
            >
              Passages ({inspector.citations?.sources?.length || 0})
            </button>

            <button
              onClick={() => setInspector({ ...inspector, activeTab: 'graph' })}
              className="btn-ghost"
              style={{
                borderRadius: 0,
                padding: '9px 12px',
                fontSize: '12px',
                fontWeight: inspector.activeTab === 'graph' ? 600 : 500,
                color: inspector.activeTab === 'graph' ? 'var(--accent-primary)' : 'var(--text-secondary)',
                borderBottom: inspector.activeTab === 'graph' ? '2px solid var(--accent-primary)' : '2px solid transparent'
              }}
            >
              Graph Triples ({inspector.citations?.graph?.length || 0})
            </button>
          </div>

          {/* Inspector Content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
            {inspector.activeTab === 'passages' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {!inspector.citations?.sources?.length ? (
                  <div style={{ color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center', padding: '30px 0' }}>
                    No vector passages cited for this answer.
                  </div>
                ) : (
                  inspector.citations.sources.map((src, sIdx) => (
                    <div key={sIdx} className="calm-panel" style={{ padding: '12px', fontSize: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '240px' }}>
                          {src.source_name || `Source #${src.source_id}`}
                        </span>
                        {src.similarity !== undefined && (
                          <span className="tabular-nums" style={{ fontSize: '11px', color: 'var(--accent-primary)' }}>
                            {(src.similarity * 100).toFixed(1)}% match
                          </span>
                        )}
                      </div>
                      <div style={{ color: 'var(--text-secondary)', lineHeight: 1.55, fontSize: '12px', background: 'var(--bg-surface-2)', padding: '8px 10px', borderRadius: '6px' }}>
                        "{src.content || src.text || 'No text snippet'}"
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {inspector.activeTab === 'graph' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {!inspector.citations?.graph?.length ? (
                  <div style={{ color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center', padding: '30px 0' }}>
                    No knowledge graph relationships traversed for this inquiry.
                  </div>
                ) : (
                  inspector.citations.graph.map((rel, rIdx) => (
                    <div key={rIdx} className="calm-panel" style={{ padding: '10px 12px', fontSize: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>
                          {rel.source || rel.subject}
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', background: 'var(--bg-surface-3)', padding: '1px 6px', borderRadius: '4px' }}>
                          {rel.type || rel.predicate}
                        </span>
                        <span style={{ fontWeight: 600, color: 'var(--accent-cyan-text)' }}>
                          {rel.target || rel.object}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
