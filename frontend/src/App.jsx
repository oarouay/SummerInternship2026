import React, { useState, useEffect } from 'react';
import SidebarNav from './components/SidebarNav';
import ChatStudio from './components/ChatStudio';
import SourceManager from './components/SourceManager';
import GraphExplorer from './components/GraphExplorer';
import Assistant from './components/Assistant';
import Integrations from './components/Integrations';
import AuthModal from './components/AuthModal';
import { authApi, getStoredToken } from './api/client';
import { ShieldCheck, Database, RefreshCw } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState('ask');
  const [tenant, setTenant] = useState(null);
  const [user, setUser] = useState(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [initializing, setInitializing] = useState(true);

  // Cross-page navigation context (e.g. asking about a specific source)
  const [sourceScope, setSourceScope] = useState(null);

  // Theme Management: 'system' | 'light' | 'dark'
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('omnigraph_theme') || 'system';
  });

  useEffect(() => {
    const applyTheme = () => {
      let resolvedTheme = theme;
      if (theme === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        resolvedTheme = prefersDark ? 'dark' : 'light';
      }
      document.documentElement.setAttribute('data-theme', resolvedTheme);
      localStorage.setItem('omnigraph_theme', theme);
    };

    applyTheme();

    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = () => applyTheme();
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, [theme]);

  useEffect(() => {
    const initAuth = async () => {
      const token = getStoredToken();
      if (token) {
        try {
          const meData = await authApi.getMe();
          setUser(meData.user);
          setTenant(meData.tenant);
        } catch (err) {
          console.warn('Stored token expired or invalid:', err);
          authApi.logout();
        }
      } else {
        setAuthModalOpen(true);
      }
      setInitializing(false);
    };

    initAuth();
  }, []);

  const handleAuthSuccess = (meData) => {
    setUser(meData.user);
    setTenant(meData.tenant);
    setAuthModalOpen(false);
  };

  const handleLogout = () => {
    authApi.logout();
    setUser(null);
    setTenant(null);
    setAuthModalOpen(true);
  };

  const handleNavigateToAsk = (scope) => {
    setSourceScope(scope);
    setActiveTab('ask');
  };

  return (
    <div className="app-shell">
      {/* Persistent Left Navigation Shell */}
      <SidebarNav
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        tenant={tenant}
        user={user}
        theme={theme}
        setTheme={setTheme}
        onLogout={handleLogout}
      />

      {/* Main Workspace Canvas */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {initializing ? (
          <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-muted)' }}>
            <RefreshCw size={24} className="spin" style={{ margin: '0 auto 12px auto', color: 'var(--accent-primary)' }} />
            <div style={{ fontSize: '13px' }}>Connecting to GraphRAG Cluster...</div>
          </div>
        ) : !tenant ? (
          <div style={{ margin: 'auto', textAlign: 'center', maxWidth: '420px', padding: '40px 20px' }}>
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '12px',
                background: 'var(--bg-surface-2)',
                border: '1px solid var(--border-subtle)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--accent-primary)',
                marginBottom: '16px'
              }}
            >
              <ShieldCheck size={24} />
            </div>
            <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px' }}>
              Organization Authentication Required
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.6, marginBottom: '24px' }}>
              Sign in to your organization or register a new tenant workspace to access dedicated vector embeddings, Neo4j graphs, and RAG pipelines.
            </p>
            <button 
              onClick={() => setAuthModalOpen(true)}
              className="btn btn-primary"
              style={{ padding: '9px 20px', fontSize: '13px' }}
            >
              Sign In or Register Workspace
            </button>
          </div>
        ) : (
          <>
            {activeTab === 'ask' && (
              <ChatStudio initialSourceScope={sourceScope} />
            )}
            {activeTab === 'knowledge' && (
              <SourceManager onNavigateToAsk={handleNavigateToAsk} />
            )}
            {activeTab === 'explore' && (
              <GraphExplorer onNavigateToSources={() => setActiveTab('knowledge')} />
            )}
            {activeTab === 'assistant' && (
              <Assistant tenant={tenant} />
            )}
            {activeTab === 'integrations' && (
              <Integrations tenant={tenant} />
            )}
          </>
        )}
      </main>

      {/* Authentication Modal */}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onAuthSuccess={handleAuthSuccess}
      />
    </div>
  );
}
