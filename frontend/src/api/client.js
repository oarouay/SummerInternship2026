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

  async sendMessage(conversationId, message, topK = null, maxHops = null) {
    return request(`/chat/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        message,
        top_k_chunks: topK,
        max_graph_hops: maxHops,
      }),
    });
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
};
