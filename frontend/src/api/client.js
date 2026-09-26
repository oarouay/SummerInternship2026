/**
 * Unified API Client for GraphRAG Multi-Tenant Platform
 * Handles authentication tokens, tenant headers, multipart uploads,
 * and JSON request / response serialization.
 */

const API_BASE = '/api/v1';

// Token Management
export const getStoredToken = () => localStorage.getItem('graphrag_token');
export const setStoredToken = (token) => localStorage.setItem('graphrag_token', token);
export const removeStoredToken = () => {
  localStorage.removeItem('graphrag_token');
  localStorage.removeItem('graphrag_tenant_slug');
};

export const getStoredTenantSlug = () => localStorage.getItem('graphrag_tenant_slug');
export const setStoredTenantSlug = (slug) => localStorage.setItem('graphrag_tenant_slug', slug);

/**
 * Core fetch wrapper with auth header injection and standardized error extraction.
 */
async function request(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const token = getStoredToken();

  const headers = { ...options.headers };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Only set Content-Type to JSON if body is not FormData
  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get('content-type');
  const isJson = contentType && contentType.includes('application/json');
  const data = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const errorMsg = data?.detail || data?.message || (typeof data === 'string' ? data : 'API Request Failed');
    const error = new Error(errorMsg);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

// 1. Auth & Onboarding API
export const authApi = {
  async registerTenant(payload) {
    const data = await request('/auth/register-tenant', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (data.access_token) {
      setStoredToken(data.access_token);
      setStoredTenantSlug(data.tenant.slug);
    }
    return data;
  },

  async login(email, password, tenantSlug = '') {
    const data = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        tenant_slug: tenantSlug || undefined,
      }),
    });
    if (data.access_token) {
      setStoredToken(data.access_token);
      setStoredTenantSlug(data.tenant_slug);
    }
    return data;
  },

  async getMe() {
    return request('/auth/me');
  },

  logout() {
    removeStoredToken();
  },
};

// 2. Data Sources & Document Ingestion API
export const sourcesApi = {
  async list() {
    return request('/sources/');
  },

  async uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);
    return request('/sources/upload', {
      method: 'POST',
      body: formData,
    });
  },

  async createRawText(name, content) {
    return request('/sources/raw-text', {
      method: 'POST',
      body: JSON.stringify({ name, content }),
    });
  },

  async crawlUrl(url, name = '') {
    return request('/sources/crawl', {
      method: 'POST',
      body: JSON.stringify({ url, name: name || undefined }),
    });
  },

  async getSource(id) {
    return request(`/sources/${id}`);
  },

  async getChunks(id) {
    return request(`/sources/${id}/chunks`);
  },

  async reprocess(id) {
    return request(`/sources/${id}/reprocess`, {
      method: 'POST',
    });
  },

  async delete(id) {
    return request(`/sources/${id}`, {
      method: 'DELETE',
    });
  },

  async search(query, topK = 4, sourceId = null) {
    return request('/sources/search', {
      method: 'POST',
      body: JSON.stringify({
        query,
        top_k: topK,
        source_id: sourceId || undefined,
      }),
    });
  },
};

// 3. Knowledge Graph API (Neo4j)
export const graphApi = {
  async getStats() {
    return request('/graph/stats');
  },

  async getNeighborhood(entityNames = [], maxHops = 2, limit = 50) {
    return request('/graph/neighborhood', {
      method: 'POST',
      body: JSON.stringify({
        entity_names: entityNames,
        max_hops: maxHops,
        limit,
      }),
    });
  },
};

// 4. Multi-Turn Chat & Conversation Sessions API
export const chatApi = {
  async listConversations() {
    return request('/chat/conversations');
  },

  async createConversation(title = 'New Conversation') {
    return request('/chat/conversations', {
      method: 'POST',
      body: JSON.stringify({ title }),
    });
  },

  async getConversation(id) {
    return request(`/chat/conversations/${id}`);
  },

  async sendMessage(conversationId, message, topK = null, maxHops = null, personaId = null) {
    return request(`/chat/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        message,
        top_k_chunks: topK,
        max_graph_hops: maxHops,
        persona_id: personaId || undefined,
      }),
    });
  },

  async streamMessage(
    conversationId,
    message,
    topK = null,
    maxHops = null,
    personaIdOrOptions = null,
    optionsMaybe = {}
  ) {
    let personaId = null;
    let options = {};
    if (personaIdOrOptions && typeof personaIdOrOptions === 'object' && !('substring' in personaIdOrOptions)) {
      options = personaIdOrOptions;
    } else {
      personaId = personaIdOrOptions;
      options = optionsMaybe || {};
    }
    const { onToken, onMetadata, onDone, onError, signal } = options;

    const token = getStoredToken();
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(`${API_BASE}/chat/conversations/${conversationId}/messages/stream`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message,
          top_k_chunks: topK,
          max_graph_hops: maxHops,
          persona_id: personaId || undefined,
        }),
        signal,
      });

      if (!response.ok) {
        let errorMsg = 'Streaming request failed';
        try {
          const errData = await response.json();
          errorMsg = errData.detail || errData.message || errorMsg;
        } catch {
          // ignore
        }
        const err = new Error(errorMsg);
        err.status = response.status;
        throw err;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep partial line in buffer

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

            let parsedData;
            try {
              parsedData = JSON.parse(rawData);
            } catch {
              parsedData = rawData;
            }

            if (currentEvent === 'token') {
              onToken?.(parsedData.text ?? parsedData);
            } else if (currentEvent === 'metadata') {
              onMetadata?.(parsedData);
            } else if (currentEvent === 'error') {
              onError?.(new Error(parsedData.detail || 'Stream error'));
            } else if (currentEvent === 'done') {
              onDone?.();
            }
          }
        }
      }

      onDone?.();
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log('[SSE] Stream aborted');
      } else {
        onError?.(err);
        throw err;
      }
    }
  },


  async renameConversation(id, title) {
    return request(`/chat/conversations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    });
  },

  async deleteConversation(id) {
    return request(`/chat/conversations/${id}`, {
      method: 'DELETE',
    });
  },
};

// 5. Standalone GraphRAG Synthesis API
export const ragApi = {
  async query(query, topK = 4, maxHops = 2, temperature = 0.2) {
    return request('/rag/query', {
      method: 'POST',
      body: JSON.stringify({
        query,
        top_k_chunks: topK,
        max_graph_hops: maxHops,
        temperature,
      }),
    });
  },
};

// 6. Chatbot Configuration & Personalization API
export const chatbotApi = {
  async getSettings() {
    return request('/chatbot/settings');
  },

  async updateSettings(payload) {
    return request('/chatbot/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async validateGeminiKey(apiKey = null) {
    return request('/chatbot/validate-gemini-key', {
      method: 'POST',
      body: JSON.stringify({ api_key: apiKey || undefined }),
    });
  },

  async validateOpenAIKey(apiKey = null) {
    return request('/chatbot/validate-openai-key', {
      method: 'POST',
      body: JSON.stringify({ api_key: apiKey || undefined }),
    });
  },
};

// 7. Organization AI Profiles & Versioning API
export const aiProfilesApi = {
  async getActive() {
    return request('/ai-profiles/active');
  },

  async submitOnboarding(payload) {
    return request('/ai-profiles/onboarding', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async updateActive(payload) {
    return request('/ai-profiles/active', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async createVersion(changeReason) {
    return request(`/ai-profiles/versions?change_reason=${encodeURIComponent(changeReason)}`, {
      method: 'POST',
    });
  },

  async listVersions() {
    return request('/ai-profiles/versions');
  },

  async restoreVersion(versionNumber) {
    return request(`/ai-profiles/versions/${versionNumber}/restore`, {
      method: 'POST',
    });
  },

  async validate(payload) {
    return request('/ai-profiles/validate', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async test(payload) {
    return request('/ai-profiles/test', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};

// 8. Personas API
export const personasApi = {
  async list() {
    return request('/personas');
  },

  async create(payload) {
    return request('/personas', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async update(id, payload) {
    return request(`/personas/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async delete(id) {
    return request(`/personas/${id}`, {
      method: 'DELETE',
    });
  },

  async setDefault(id) {
    return request(`/personas/${id}/set-default`, {
      method: 'POST',
    });
  },
};


// 7. Public Chatbot Widget API (Unauthenticated / Public Website Visitor)
export const publicWidgetApi = {
  async getConfig(tenantSlug, customBaseUrl = '') {
    const base = customBaseUrl || API_BASE;
    const res = await fetch(`${base}/chat/public/${encodeURIComponent(tenantSlug)}/config`);
    if (!res.ok) throw new Error('Failed to load bot configuration');
    return res.json();
  },

  async sendMessage(tenantSlug, message, history = [], customBaseUrl = '') {
    const base = customBaseUrl || API_BASE;
    const res = await fetch(`${base}/chat/public/${encodeURIComponent(tenantSlug)}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to send message');
    }
    return res.json();
  },

  async streamMessage(
    tenantSlug,
    message,
    history = [],
    { onToken, onMetadata, onDone, onError, signal } = {},
    customBaseUrl = ''
  ) {
    const base = customBaseUrl || API_BASE;
    try {
      const response = await fetch(`${base}/chat/public/${encodeURIComponent(tenantSlug)}/message/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({ message, history }),
        signal,
      });

      if (!response.ok) {
        let errorMsg = 'Widget stream request failed';
        try {
          const errData = await response.json();
          errorMsg = errData.detail || errData.message || errorMsg;
        } catch {
          // ignore
        }
        const err = new Error(errorMsg);
        err.status = response.status;
        throw err;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

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

            let parsedData;
            try {
              parsedData = JSON.parse(rawData);
            } catch {
              parsedData = rawData;
            }

            if (currentEvent === 'token') {
              onToken?.(parsedData.text ?? parsedData);
            } else if (currentEvent === 'metadata') {
              onMetadata?.(parsedData);
            } else if (currentEvent === 'error') {
              onError?.(new Error(parsedData.detail || 'Stream error'));
            } else if (currentEvent === 'done') {
              onDone?.();
            }
          }
        }
      }

      onDone?.();
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log('[Widget SSE] Stream aborted');
      } else {
        onError?.(err);
        throw err;
      }
    }
  },
};

