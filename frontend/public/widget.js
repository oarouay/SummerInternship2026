/**
 * OmniGraph GraphRAG Embeddable Micro-Frontend Widget
 * Features:
 * - Pure Shadow DOM encapsulation (Zero CSS pollution from/to host site)
 * - Auto-detects configuration attributes from <script> tag
 * - Unauthenticated public tenant RAG querying with session memory
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
  const primaryColor = currentScript.getAttribute('data-primary-color') || '#8B5CF6';
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

  // 3. Shadow DOM Stylesheet
  const style = document.createElement('style');
  style.textContent = `
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    }

    .launcher-btn {
      width: 56px;
      height: 56px;
      border-radius: 28px;
      background: ${primaryColor};
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #FFFFFF;
      transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease;
      position: relative;
    }

    .launcher-btn:hover {
      transform: scale(1.08);
      box-shadow: 0 12px 28px rgba(0, 0, 0, 0.45);
    }

    .launcher-btn:active {
      transform: scale(0.95);
    }

    .unread-dot {
      position: absolute;
      top: 2px;
      right: 2px;
      width: 12px;
      height: 12px;
      background: #10B981;
      border: 2px solid #FFFFFF;
      border-radius: 50%;
    }

    .chat-window {
      position: absolute;
      bottom: 70px;
      ${position === 'left' ? 'left: 0;' : 'right: 0;'}
      width: 380px;
      height: 580px;
      max-width: calc(100vw - 32px);
      max-height: calc(100vh - 100px);
      background: #0B0F19;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 18px;
      box-shadow: 0 20px 48px rgba(0, 0, 0, 0.6);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      transform-origin: bottom ${position};
    }

    .chat-window.hidden {
      opacity: 0;
      transform: scale(0.85) translateY(20px);
      pointer-events: none;
    }

    .chat-header {
      background: linear-gradient(135deg, ${primaryColor} 0%, #1E1B4B 100%);
      padding: 16px;
      color: #FFFFFF;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .header-info {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .bot-avatar {
      width: 34px;
      height: 34px;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 14px;
    }

    .bot-title {
      font-weight: 700;
      font-size: 14px;
      line-height: 1.2;
    }

    .bot-subtitle {
      font-size: 11px;
      opacity: 0.85;
    }

    .close-btn {
      background: none;
      border: none;
      color: #FFFFFF;
      cursor: pointer;
      font-size: 20px;
      line-height: 1;
      padding: 4px;
      opacity: 0.8;
    }
    .close-btn:hover {
      opacity: 1;
    }

    .messages-container {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      background: #07090E;
    }

    .msg-row {
      display: flex;
      flex-direction: column;
      max-width: 85%;
    }

    .msg-row.user {
      align-self: flex-end;
      align-items: flex-end;
    }

    .msg-row.assistant {
      align-self: flex-start;
      align-items: flex-start;
    }

    .msg-bubble {
      padding: 10px 14px;
      font-size: 13px;
      line-height: 1.5;
      word-break: break-word;
    }

    .msg-row.user .msg-bubble {
      background: ${primaryColor};
      color: #FFFFFF;
      border-radius: 14px 14px 2px 14px;
    }

    .msg-row.assistant .msg-bubble {
      background: #111827;
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: #F8FAFC;
      border-radius: 14px 14px 14px 2px;
    }

    .typing-indicator {
      display: flex;
      gap: 4px;
      padding: 10px 14px;
      background: #111827;
      border-radius: 14px;
      align-self: flex-start;
    }

    .typing-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #94A3B8;
      animation: bounce 1.4s infinite ease-in-out;
    }
    .typing-dot:nth-child(2) { animation-delay: 0.2s; }
    .typing-dot:nth-child(3) { animation-delay: 0.4s; }

    @keyframes bounce {
      0%, 80%, 100% { transform: translateY(0); }
      40% { transform: translateY(-5px); }
    }

    .input-area {
      padding: 12px;
      background: #0B0F19;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .chat-input {
      flex: 1;
      background: #111827;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 20px;
      padding: 9px 14px;
      color: #FFFFFF;
      font-size: 13px;
      outline: none;
    }
    .chat-input:focus {
      border-color: ${primaryColor};
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
      transition: transform 0.15s;
    }
    .send-btn:hover {
      transform: scale(1.05);
    }
    .send-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .footer-badge {
      font-size: 10px;
      text-align: center;
      padding: 6px;
      color: #64748B;
      background: #07090E;
    }
  `;
  shadow.appendChild(style);

  // 4. HTML Elements for Widget
  const widgetWrapper = document.createElement('div');
  widgetWrapper.innerHTML = `
    <!-- Floating Launcher -->
    <button class="launcher-btn" id="launcher-btn" aria-label="Open Chat">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z"/>
      </svg>
      <span class="unread-dot"></span>
    </button>

    <!-- Chat Modal Window -->
    <div class="chat-window hidden" id="chat-window">
      <div class="chat-header">
        <div class="header-info">
          <div class="bot-avatar" id="header-avatar">AI</div>
          <div>
            <div class="bot-title" id="header-title">Assistant</div>
            <div class="bot-subtitle" id="header-subtitle">GraphRAG Powered</div>
          </div>
        </div>
        <button class="close-btn" id="close-btn">&times;</button>
      </div>

      <div class="messages-container" id="messages-container"></div>

      <form class="input-area" id="input-form">
        <input type="text" class="chat-input" id="chat-input" placeholder="Type a question..." autocomplete="off" />
        <button type="submit" class="send-btn" id="send-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </form>

      <div class="footer-badge">Powered by OmniGraph Multi-Tenant GraphRAG</div>
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
  const headerTitle = shadow.getElementById('header-title');
  const headerSubtitle = shadow.getElementById('header-subtitle');
  const headerAvatar = shadow.getElementById('header-avatar');

  let isOpen = false;
  let conversationHistory = []; // { role: "user" | "assistant", content: "..." }
  let botConfig = null;

  // Toggle Window
  function toggleChat() {
    isOpen = !isOpen;
    if (isOpen) {
      chatWindow.classList.remove('hidden');
      chatInput.focus();
    } else {
      chatWindow.classList.add('hidden');
    }
  }

  launcherBtn.addEventListener('click', toggleChat);
  closeBtn.addEventListener('click', toggleChat);

  // Render a message row
  function appendMessage(role, text) {
    const row = document.createElement('div');
    row.className = `msg-row ${role}`;
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.textContent = text;
    row.appendChild(bubble);
    messagesContainer.appendChild(row);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function showTyping() {
    const typing = document.createElement('div');
    typing.id = 'typing-indicator';
    typing.className = 'typing-indicator';
    typing.innerHTML = `
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    `;
    messagesContainer.appendChild(typing);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function hideTyping() {
    const typing = shadow.getElementById('typing-indicator');
    if (typing) typing.remove();
  }

  // 6. Fetch Public Tenant Configuration on Start
  async function initBotConfig() {
    try {
      const res = await fetch(`${apiBase}/chat/public/${encodeURIComponent(tenantSlug)}/config`);
      if (!res.ok) throw new Error('Bot config request failed');
      botConfig = await res.json();

      headerTitle.textContent = botConfig.name || 'Assistant';
      headerSubtitle.textContent = botConfig.tenant_name || 'GraphRAG Support';
      if (botConfig.name) {
        headerAvatar.textContent = botConfig.name.substring(0, 2).toUpperCase();
      }

      // Display Initial Welcome Greeting
      appendMessage('assistant', botConfig.welcome_message || 'Hello! How can I help you today?');
    } catch (err) {
      console.warn('[OmniGraph] Could not fetch public config for slug:', tenantSlug, err);
      appendMessage('assistant', 'Hello! How can I assist you with our documentation today?');
    }
  }

  // 7. Handle Visitor Input & GraphRAG Answering
  inputForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = chatInput.value.trim();
    if (!message) return;

    chatInput.value = '';
    appendMessage('user', message);
    conversationHistory.push({ role: 'user', content: message });
    showTyping();

    try {
      const res = await fetch(`${apiBase}/chat/public/${encodeURIComponent(tenantSlug)}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          history: conversationHistory.slice(-6), // keep last 6 turns for context
        }),
      });

      hideTyping();

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Service unavailable');
      }

      const data = await res.json();
      const answer = data.answer || 'I could not generate an answer for that query.';
      appendMessage('assistant', answer);
      conversationHistory.push({ role: 'assistant', content: answer });
    } catch (err) {
      hideTyping();
      appendMessage('assistant', 'Sorry, I encountered an issue retrieving that information. Please try again in a moment.');
      console.error('[OmniGraph Widget Error]:', err);
    }
  });

  // Start initialization
  initBotConfig();
})();
