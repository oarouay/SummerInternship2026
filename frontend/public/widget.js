/**
 * OmniGraph GraphRAG Embeddable Micro-Frontend Widget
 * Features:
 * - Pure Shadow DOM encapsulation (Zero CSS pollution from/to host site)
 * - Safe client-side Markdown rendering (bold, italics, code, lists, links, tables)
 * - Token-by-token real-time SSE streaming with typing animation (Claude/ChatGPT style)
 * - Anti-UI-Slop & Emil Kowalski micro-interactions (spring easing, breathing cursor, tactile feedback)
 * - Interactive clarification & follow-up suggestion chips
 * - Graceful stream drop recovery
 * - Mobile responsive floating launcher & window
 */
(function () {
  // Prevent duplicate initialization
  if (window.__OMNIGRAPH_WIDGET_INITIALIZED__) return;
  window.__OMNIGRAPH_WIDGET_INITIALIZED__ = true;

  // 1. Locate current script element and extract configuration
  const currentScript = document.currentScript || document.querySelector('script[data-tenant-slug]');
  if (!currentScript) {
    console.error('[OmniGraph] Could not locate <script data-tenant-slug="..."> element.');
    return;
  }

  const tenantSlug = currentScript.getAttribute('data-tenant-slug');
  const primaryColor = currentScript.getAttribute('data-primary-color') || '#4F5BD5';
  const position = currentScript.getAttribute('data-position') || 'right';
  
  // Extract API Base URL from script origin or custom attribute
  const scriptUrl = new URL(currentScript.src, window.location.href);
  const apiBase = currentScript.getAttribute('data-api-base') || `${scriptUrl.origin}/api/v1`;

  // 2. Create Host Container and attach Open Shadow DOM
  const host = document.createElement('div');
  host.id = 'omnigraph-widget-container';
  host.style.position = 'fixed';
  host.style.zIndex = '2147483647'; // Max z-index
  host.style.bottom = '20px';
  if (position === 'left') {
    host.style.left = '20px';
  } else {
    host.style.right = '20px';
  }
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  // 3. Shadow DOM Stylesheet with Modern Design System & Emil Kowalski Motion
  const style = document.createElement('style');
  style.textContent = `
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
    }

    /* Floating Launcher Button */
    .launcher-btn {
      width: 56px;
      height: 56px;
      border-radius: 28px;
      background: ${primaryColor};
      box-shadow: 0 10px 25px -4px ${primaryColor}77, 0 6px 14px -4px rgba(0, 0, 0, 0.45);
      border: 1px solid rgba(255, 255, 255, 0.15);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #FFFFFF;
      transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.22s ease;
      position: relative;
      outline: none;
    }

    .launcher-btn:hover {
      transform: scale(1.06);
      box-shadow: 0 14px 30px -4px ${primaryColor}99, 0 8px 16px -4px rgba(0, 0, 0, 0.55);
    }

    .launcher-btn:active {
      transform: scale(0.94);
    }

    .launcher-btn:focus-visible {
      box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.4), 0 10px 25px -4px ${primaryColor}77;
    }

    .launcher-icon {
      transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease;
    }

    .launcher-icon.icon-open {
      position: absolute;
    }

    .launcher-btn.is-active .icon-chat {
      opacity: 0;
      transform: rotate(90deg) scale(0.6);
    }

    .launcher-btn.is-active .icon-close {
      opacity: 1;
      transform: rotate(0deg) scale(1);
    }

    .launcher-btn:not(.is-active) .icon-chat {
      opacity: 1;
      transform: rotate(0deg) scale(1);
    }

    .launcher-btn:not(.is-active) .icon-close {
      opacity: 0;
      transform: rotate(-90deg) scale(0.6);
    }

    .unread-dot {
      position: absolute;
      top: 1px;
      right: 1px;
      width: 13px;
      height: 13px;
      background: #10B981;
      border: 2.5px solid #0B0F19;
      border-radius: 50%;
      box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.35);
      animation: unreadPulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
    }

    @keyframes unreadPulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.15); opacity: 0.85; }
    }

    /* Chat Modal Window */
    .chat-window {
      position: absolute;
      bottom: 72px;
      ${position === 'left' ? 'left: 0;' : 'right: 0;'}
      width: 388px;
      height: 590px;
      max-width: calc(100vw - 28px);
      max-height: calc(100vh - 96px);
      background: #0B0E14;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 20px;
      box-shadow: 0 24px 60px -12px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.05);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      transform-origin: bottom ${position};
      transition: transform 0.24s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .chat-window.hidden {
      opacity: 0;
      transform: scale(0.92) translateY(18px);
      pointer-events: none;
    }

    /* Header */
    .chat-header {
      background: linear-gradient(180deg, #161B26 0%, #0F141E 100%);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      padding: 14px 16px;
      color: #FFFFFF;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }

    .header-info {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .bot-avatar {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: linear-gradient(135deg, ${primaryColor} 0%, #1E1B4B 100%);
      border: 1px solid rgba(255, 255, 255, 0.15);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 13px;
      color: #FFFFFF;
      letter-spacing: -0.02em;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    }

    .bot-title {
      font-weight: 600;
      font-size: 14px;
      line-height: 1.25;
      color: #F8FAFC;
    }

    .bot-status-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 2px;
    }

    .status-live-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #10B981;
      box-shadow: 0 0 6px #10B981;
    }

    .bot-subtitle {
      font-size: 11px;
      color: #94A3B8;
      font-weight: 400;
    }

    .close-btn {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: #94A3B8;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s ease, color 0.15s ease, transform 0.12s ease;
      outline: none;
    }

    .close-btn:hover {
      background: rgba(255, 255, 255, 0.12);
      color: #FFFFFF;
    }

    .close-btn:active {
      transform: scale(0.92);
    }

    /* Messages Container */
    .messages-container {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      background: #0B0E14;
      scroll-behavior: smooth;
    }

    .messages-container::-webkit-scrollbar {
      width: 4px;
    }
    .messages-container::-webkit-scrollbar-track {
      background: transparent;
    }
    .messages-container::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.12);
      border-radius: 4px;
    }

    /* Message Rows */
    .msg-row {
      display: flex;
      flex-direction: column;
      max-width: 88%;
      animation: messageEnter 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes messageEnter {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .msg-row.user {
      align-self: flex-end;
      align-items: flex-end;
    }

    .msg-row.assistant {
      align-self: flex-start;
      align-items: flex-start;
      max-width: 92%;
    }

    /* Bubbles */
    .msg-bubble {
      padding: 10px 14px;
      font-size: 13.5px;
      line-height: 1.6;
      word-break: break-word;
    }

    .msg-row.user .msg-bubble {
      background: ${primaryColor};
      color: #FFFFFF;
      border-radius: 16px 16px 3px 16px;
      box-shadow: 0 3px 10px rgba(0, 0, 0, 0.25);
    }

    .msg-row.assistant .msg-bubble {
      background: #141923;
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: #F1F5F9;
      border-radius: 16px 16px 16px 3px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }

    /* Markdown Elements inside Widget */
    .widget-markdown-body {
      color: inherit;
      line-height: 1.62;
    }

    .widget-markdown-body > *:first-child {
      margin-top: 0 !important;
    }
    .widget-markdown-body > *:last-child {
      margin-bottom: 0 !important;
    }

    .widget-p {
      margin: 0.55em 0;
    }

    .widget-strong {
      font-weight: 600;
      color: #FFFFFF;
    }

    .widget-ul, .widget-ol {
      margin: 0.5em 0;
      padding-left: 1.25em;
    }

    .widget-li {
      margin: 0.25em 0;
      line-height: 1.55;
    }

    .widget-ul::marker, .widget-ol::marker {
      color: #64748B;
    }

    .widget-link {
      color: #93C5FD;
      text-decoration: none;
      border-bottom: 1px solid transparent;
      transition: border-color 0.15s ease, color 0.15s ease;
    }

    .widget-link:hover {
      border-bottom-color: #93C5FD;
    }

    .widget-code {
      font-family: SFMono-Regular, Consolas, Menlo, Monaco, monospace;
      font-size: 0.88em;
      background: rgba(255, 255, 255, 0.08);
      color: #C7D2FE;
      padding: 0.15em 0.35em;
      border-radius: 4px;
      border: 1px solid rgba(255, 255, 255, 0.06);
    }

    .widget-pre {
      margin: 0.65em 0;
      padding: 10px 12px;
      background: #0A0D13;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      overflow-x: auto;
      font-family: SFMono-Regular, Consolas, Menlo, Monaco, monospace;
      font-size: 12px;
      line-height: 1.5;
      color: #E2E8F0;
    }

    .widget-quote {
      margin: 0.6em 0;
      padding: 0.3em 0.75em;
      border-left: 3px solid ${primaryColor};
      background: rgba(255, 255, 255, 0.03);
      border-radius: 0 4px 4px 0;
      color: #94A3B8;
      font-size: 13px;
    }

    .widget-h2, .widget-h3, .widget-h4 {
      font-weight: 600;
      color: #FFFFFF;
      margin: 0.75em 0 0.35em 0;
      line-height: 1.35;
    }
    .widget-h2 { font-size: 1.15em; }
    .widget-h3 { font-size: 1.05em; }
    .widget-h4 { font-size: 0.95em; }

    /* Streaming Cursor */
    .widget-streaming-cursor {
      display: inline-block;
      width: 6px;
      height: 14px;
      background: ${primaryColor};
      border-radius: 1.5px;
      margin-left: 4px;
      vertical-align: -1px;
      animation: widgetCursorPulse 0.85s cubic-bezier(0.16, 1, 0.3, 1) infinite;
    }

    @keyframes widgetCursorPulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.15; transform: scale(0.9); }
    }

    /* Soft reveal for in-progress chunk */
    .widget-streaming-active {
      animation: widgetChunkEnter 0.2s ease-out;
    }

    @keyframes widgetChunkEnter {
      from { opacity: 0.9; transform: translateY(2px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* Interactive Chips */
    .widget-chips-wrap {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }

    .widget-chip {
      background: #19202E;
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #E2E8F0;
      border-radius: 14px;
      padding: 4px 10px;
      font-size: 11.5px;
      font-weight: 500;
      cursor: pointer;
      font-family: inherit;
      transition: all 0.16s cubic-bezier(0.16, 1, 0.3, 1);
      display: inline-flex;
      align-items: center;
      gap: 5px;
      outline: none;
    }

    .widget-chip:hover {
      background: #232C3E;
      border-color: rgba(255, 255, 255, 0.2);
      color: #FFFFFF;
      transform: translateY(-1px);
    }

    .widget-chip:active {
      transform: translateY(0);
    }

    .widget-chip.clarification-chip {
      background: rgba(147, 197, 253, 0.08);
      border-color: rgba(147, 197, 253, 0.25);
      color: #93C5FD;
    }

    .widget-chip.clarification-chip:hover {
      background: rgba(147, 197, 253, 0.16);
      border-color: #93C5FD;
      color: #FFFFFF;
    }

    /* Stream Interrupted Badge */
    .widget-interrupted-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      margin-top: 6px;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 11px;
      color: #FBBF24;
      background: rgba(245, 158, 11, 0.12);
      border: 1px solid rgba(245, 158, 11, 0.25);
    }

    /* Input Area */
    .input-area {
      padding: 10px 14px;
      background: #0B0E14;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      gap: 8px;
      align-items: center;
      flex-shrink: 0;
    }

    .chat-input {
      flex: 1;
      background: #141923;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 20px;
      padding: 9px 15px;
      color: #F8FAFC;
      font-size: 13px;
      outline: none;
      transition: border-color 0.18s ease, box-shadow 0.18s ease;
    }

    .chat-input::placeholder {
      color: #64748B;
    }

    .chat-input:focus {
      border-color: ${primaryColor};
      box-shadow: 0 0 0 3px ${primaryColor}26;
    }

    .send-btn {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      background: ${primaryColor};
      border: none;
      color: #FFFFFF;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.16s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.15s ease;
      outline: none;
      flex-shrink: 0;
    }

    .send-btn:hover:not(:disabled) {
      transform: scale(1.06);
    }

    .send-btn:active:not(:disabled) {
      transform: scale(0.93);
    }

    .send-btn:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    /* Footer */
    .footer-badge {
      font-size: 10.5px;
      text-align: center;
      padding: 7px;
      color: #475569;
      background: #080A0F;
      border-top: 1px solid rgba(255, 255, 255, 0.03);
      user-select: none;
      flex-shrink: 0;
    }

    /* Mobile Viewport */
    @media (max-width: 480px) {
      .chat-window {
        width: calc(100vw - 20px);
        height: calc(100vh - 90px);
        bottom: 68px;
        ${position === 'left' ? 'left: -10px;' : 'right: -10px;'}
        border-radius: 16px;
      }
    }
  `;
  shadow.appendChild(style);

  // 4. HTML Elements for Widget
  const widgetWrapper = document.createElement('div');
  widgetWrapper.innerHTML = `
    <!-- Floating Launcher -->
    <button class="launcher-btn" id="launcher-btn" aria-label="Toggle Knowledge Chat">
      <!-- Chat Icon -->
      <svg class="launcher-icon icon-chat" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z"/>
      </svg>
      <!-- Close Icon -->
      <svg class="launcher-icon icon-close" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
      <span class="unread-dot" id="unread-dot"></span>
    </button>

    <!-- Chat Modal Window -->
    <div class="chat-window hidden" id="chat-window" role="dialog" aria-label="Knowledge Assistant Window">
      <div class="chat-header">
        <div class="header-info">
          <div class="bot-avatar" id="header-avatar">AI</div>
          <div>
            <div class="bot-title" id="header-title">Assistant</div>
            <div class="bot-status-row">
              <span class="status-live-dot"></span>
              <span class="bot-subtitle" id="header-subtitle">GraphRAG Verified</span>
            </div>
          </div>
        </div>
        <button class="close-btn" id="close-btn" aria-label="Close Chat Window">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="messages-container" id="messages-container"></div>

      <form class="input-area" id="input-form">
        <input 
          type="text" 
          class="chat-input" 
          id="chat-input" 
          placeholder="Ask a question..." 
          autocomplete="off" 
          aria-label="Ask a question"
        />
        <button type="submit" class="send-btn" id="send-btn" aria-label="Send Message" disabled>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </form>

      <div class="footer-badge">Powered by OmniGraph Multi-Tenant Knowledge RAG</div>
    </div>
  `;
  shadow.appendChild(widgetWrapper);

  // 5. Select UI elements
  const launcherBtn = shadow.getElementById('launcher-btn');
  const chatWindow = shadow.getElementById('chat-window');
  const closeBtn = shadow.getElementById('close-btn');
  const messagesContainer = shadow.getElementById('messages-container');
  const inputForm = shadow.getElementById('input-form');
  const chatInput = shadow.getElementById('chat-input');
  const sendBtn = shadow.getElementById('send-btn');
  const headerTitle = shadow.getElementById('header-title');
  const headerSubtitle = shadow.getElementById('header-subtitle');
  const headerAvatar = shadow.getElementById('header-avatar');
  const unreadDot = shadow.getElementById('unread-dot');

  let isOpen = false;
  let conversationHistory = []; // { role: "user" | "assistant", content: "..." }
  let botConfig = null;
  let isSending = false;

  // 6. Safe Client-Side Markdown Parser for Widget
  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderMarkdown(rawText) {
    if (!rawText) return '';
    let text = escapeHtml(rawText);

    // Code blocks preservation
    const codeBlocks = [];
    text = text.replace(/```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
      const idx = codeBlocks.length;
      codeBlocks.push(`<pre class="widget-pre"><code>${code.trim()}</code></pre>`);
      return `@@CODE_BLOCK_${idx}@@`;
    });

    // Inline code
    text = text.replace(/`([^`\n]+)`/g, '<code class="widget-code">$1</code>');

    // Headings
    text = text.replace(/^### (.*$)/gim, '<h4 class="widget-h4">$1</h4>');
    text = text.replace(/^## (.*$)/gim, '<h3 class="widget-h3">$1</h3>');
    text = text.replace(/^# (.*$)/gim, '<h2 class="widget-h2">$1</h2>');

    // Blockquotes
    text = text.replace(/^\> (.*$)/gim, '<blockquote class="widget-quote">$1</blockquote>');

    // Bold & Italic
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong class="widget-strong">$1</strong>');
    text = text.replace(/__([^_]+)__/g, '<strong class="widget-strong">$1</strong>');
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    text = text.replace(/_([^_]+)_/g, '<em>$1</em>');
    text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    // Safe links (only http, https)
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="widget-link">$1</a>');

    // Unordered lists
    text = text.replace(/(?:^[ \t]*[-*][ \t]+[^\n]+(?:\n|$))+/gm, (match) => {
      const items = match
        .trim()
        .split('\n')
        .map(item => item.replace(/^[ \t]*[-*][ \t]+/, '').trim())
        .filter(Boolean)
        .map(item => `<li class="widget-li">${item}</li>`)
        .join('');
      return `<ul class="widget-ul">${items}</ul>`;
    });

    // Ordered lists
    text = text.replace(/(?:^[ \t]*\d+\.[ \t]+[^\n]+(?:\n|$))+/gm, (match) => {
      const items = match
        .trim()
        .split('\n')
        .map(item => item.replace(/^[ \t]*\d+\.[ \t]+/, '').trim())
        .filter(Boolean)
        .map(item => `<li class="widget-li">${item}</li>`)
        .join('');
      return `<ol class="widget-ol">${items}</ol>`;
    });

    // Paragraphs
    const paragraphs = text.split(/\n{2,}/);
    text = paragraphs
      .map(p => {
        p = p.trim();
        if (!p) return '';
        if (p.startsWith('<h') || p.startsWith('<pre') || p.startsWith('<ul') || p.startsWith('<ol') || p.startsWith('<blockquote') || p.startsWith('@@CODE_BLOCK_')) {
          return p;
        }
        return `<p class="widget-p">${p.replace(/\n/g, '<br>')}</p>`;
      })
      .filter(Boolean)
      .join('');

    // Restore Code Blocks
    text = text.replace(/@@CODE_BLOCK_(\d+)@@/g, (match, idx) => {
      return codeBlocks[parseInt(idx, 10)] || '';
    });

    return text;
  }

  // Toggle Window with Emil Kowalski spring effect
  function toggleChat() {
    isOpen = !isOpen;
    if (isOpen) {
      launcherBtn.classList.add('is-active');
      chatWindow.classList.remove('hidden');
      unreadDot.style.display = 'none';
      setTimeout(() => chatInput.focus(), 100);
    } else {
      launcherBtn.classList.remove('is-active');
      chatWindow.classList.add('hidden');
    }
  }

  launcherBtn.addEventListener('click', toggleChat);
  closeBtn.addEventListener('click', toggleChat);

  // Enable/disable send button based on input
  chatInput.addEventListener('input', () => {
    sendBtn.disabled = !chatInput.value.trim() || isSending;
  });

  // Render a static message row
  function appendStaticMessage(role, text, options = {}) {
    const row = document.createElement('div');
    row.className = `msg-row ${role}`;
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';

    if (role === 'assistant') {
      const markdownWrap = document.createElement('div');
      markdownWrap.className = 'widget-markdown-body';
      markdownWrap.innerHTML = renderMarkdown(text);
      bubble.appendChild(markdownWrap);
    } else {
      bubble.textContent = text;
    }

    row.appendChild(bubble);

    if (role === 'assistant') {
      renderChips(row, options);
    }

    messagesContainer.appendChild(row);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function renderChips(row, options = {}) {
    const { clarification_options, follow_up_suggestions } = options;

    if (clarification_options && clarification_options.length > 0) {
      const wrap = document.createElement('div');
      wrap.className = 'widget-chips-wrap';
      clarification_options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'widget-chip clarification-chip';
        btn.textContent = opt + ' →';
        btn.onclick = () => submitVisitorMessage(opt);
        wrap.appendChild(btn);
      });
      row.appendChild(wrap);
    }

    if (follow_up_suggestions && follow_up_suggestions.length > 0) {
      const wrap = document.createElement('div');
      wrap.className = 'widget-chips-wrap';
      follow_up_suggestions.forEach(sug => {
        const btn = document.createElement('button');
        btn.className = 'widget-chip suggestion-chip';
        btn.textContent = sug + ' →';
        btn.onclick = () => submitVisitorMessage(sug);
        wrap.appendChild(btn);
      });
      row.appendChild(wrap);
    }
  }

  // 7. Fetch Public Tenant Configuration on Start
  async function initBotConfig() {
    try {
      const res = await fetch(`${apiBase}/chat/public/${encodeURIComponent(tenantSlug)}/config`);
      if (!res.ok) throw new Error('Bot config request failed');
      botConfig = await res.json();

      headerTitle.textContent = botConfig.name || 'Assistant';
      headerSubtitle.textContent = botConfig.tenant_name || 'Knowledge Support';
      if (botConfig.name) {
        headerAvatar.textContent = botConfig.name.substring(0, 2).toUpperCase();
      }

      // Display Initial Welcome Greeting in rendered markdown
      appendStaticMessage('assistant', botConfig.welcome_message || 'Hello! How can I help you today?');
    } catch (err) {
      console.warn('[OmniGraph] Could not fetch public config for slug:', tenantSlug, err);
      appendStaticMessage('assistant', 'Hello! How can I assist you with our documentation today?');
    }
  }

  // 8. Handle Visitor Input & Real-Time SSE Streaming
  async function submitVisitorMessage(message) {
    if (!message || !message.trim() || isSending) return;
    const cleanMsg = message.trim();

    isSending = true;
    chatInput.value = '';
    sendBtn.disabled = true;

    // 1. Append user message row
    appendStaticMessage('user', cleanMsg);
    conversationHistory.push({ role: 'user', content: cleanMsg });

    // 2. Create placeholder assistant message row with streaming cursor
    const assistantRow = document.createElement('div');
    assistantRow.className = 'msg-row assistant widget-streaming-active';
    
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';

    const markdownBody = document.createElement('div');
    markdownBody.className = 'widget-markdown-body';

    const cursor = document.createElement('span');
    cursor.className = 'widget-streaming-cursor';
    cursor.setAttribute('aria-hidden', 'true');

    bubble.appendChild(markdownBody);
    bubble.appendChild(cursor);
    assistantRow.appendChild(bubble);
    messagesContainer.appendChild(assistantRow);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    let accumulatedText = '';
    let textBuffer = '';
    let flushTimer = null;
    let terminalMetadata = null;

    const flushStreamBuffer = () => {
      if (!textBuffer) return;
      accumulatedText += textBuffer;
      textBuffer = '';
      markdownBody.innerHTML = renderMarkdown(accumulatedText);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    };

    const scheduleStreamFlush = () => {
      if (!flushTimer) {
        flushTimer = setTimeout(() => {
          flushTimer = null;
          flushStreamBuffer();
        }, 35);
      }
    };

    try {
      const response = await fetch(`${apiBase}/chat/public/${encodeURIComponent(tenantSlug)}/message/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({
          message: cleanMsg,
          history: conversationHistory.slice(-6),
        }),
      });

      if (!response.ok) {
        // Fallback to non-streaming endpoint if streaming endpoint is unavailable
        throw new Error('Streaming failed, fallback to standard');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let streamBuffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        streamBuffer += decoder.decode(value, { stream: true });
        const lines = streamBuffer.split('\n');
        streamBuffer = lines.pop();

        let currentEvent = 'message';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            currentEvent = 'message';
            continue;
          }

          if (trimmed.startsWith('event:')) {
            currentEvent = trimmed.slice(6).trim();
          } else if (trimmed.startsWith('data:')) {
            const rawData = trimmed.slice(5).trim();
            if (!rawData) continue;

            let parsed;
            try {
              parsed = JSON.parse(rawData);
            } catch {
              parsed = rawData;
            }

            if (currentEvent === 'token') {
              const textPiece = parsed.text ?? parsed;
              textBuffer += textPiece;
              scheduleStreamFlush();
            } else if (currentEvent === 'metadata') {
              terminalMetadata = parsed;
            } else if (currentEvent === 'error') {
              throw new Error(parsed.detail || 'Stream error');
            }
          }
        }
      }

      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      flushStreamBuffer();

      // Stream complete: remove cursor and render chips
      cursor.remove();
      assistantRow.classList.remove('widget-streaming-active');
      conversationHistory.push({ role: 'assistant', content: accumulatedText });

      if (terminalMetadata) {
        renderChips(assistantRow, terminalMetadata);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }
    } catch (streamErr) {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      flushStreamBuffer();

      // If we got partial text, show interrupted badge; otherwise try fallback
      if (accumulatedText.length > 0) {
        cursor.remove();
        assistantRow.classList.remove('widget-streaming-active');
        const badge = document.createElement('div');
        badge.className = 'widget-interrupted-badge';
        badge.innerHTML = '<span>Response interrupted</span>';
        assistantRow.appendChild(badge);
        conversationHistory.push({ role: 'assistant', content: accumulatedText });
      } else {
        // Try fallback to non-streaming endpoint
        try {
          const res = await fetch(`${apiBase}/chat/public/${encodeURIComponent(tenantSlug)}/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: cleanMsg,
              history: conversationHistory.slice(-6),
            }),
          });
          const data = await res.json();
          const fallbackAnswer = data.answer || 'I could not generate an answer.';
          cursor.remove();
          assistantRow.classList.remove('widget-streaming-active');
          markdownBody.innerHTML = renderMarkdown(fallbackAnswer);
          renderChips(assistantRow, data);
          conversationHistory.push({ role: 'assistant', content: fallbackAnswer });
        } catch (fallbackErr) {
          cursor.remove();
          assistantRow.classList.remove('widget-streaming-active');
          markdownBody.innerHTML = '<p class="widget-p" style="color: #F87171;">Sorry, I encountered an issue retrieving that information. Please try again.</p>';
        }
      }
    } finally {
      isSending = false;
      sendBtn.disabled = !chatInput.value.trim();
    }
  }

  inputForm.addEventListener('submit', (e) => {
    e.preventDefault();
    submitVisitorMessage(chatInput.value);
  });

  // Start initialization
  initBotConfig();
})();
