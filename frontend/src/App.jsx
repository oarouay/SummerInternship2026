import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import ChatStudio from './components/ChatStudio';
import GraphExplorer from './components/GraphExplorer';
import SourceManager from './components/SourceManager';
import ChatbotSettings from './components/ChatbotSettings';
import AuthModal from './components/AuthModal';
import { authApi, getStoredToken } from './api/client';
import { Sparkles, ShieldCheck, Database, Terminal } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState('sources');
  const [tenant, setTenant] = useState(null);
  const [user, setUser] = useState(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [initializing, setInitializing] = useState(true);

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
  };

  const handleLogout = () => {
    authApi.logout();
    setUser(null);
    setTenant(null);
    setAuthModalOpen(true);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-canvas)' }}>
      {/* Integrated Top Navigation */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        tenant={tenant}
        user={user}
        onAuthClick={() => setAuthModalOpen(true)}
        onLogout={handleLogout}
      />

      {/* Main Workspace Canvas */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {initializing ? (
          <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-muted)' }}>
            <div className="telemetry-dot online" style={{ width: '10px', height: '10px', marginBottom: '12px' }}></div>
            <div style={{ fontSize: '12.5px' }}>Connecting to GraphRAG Cluster...</div>
          </div>
        ) : !tenant ? (
          <div style={{ margin: 'auto', textAlign: 'center', maxWidth: '400px', padding: '40px 20px' }}>
            <div style={{
              width: '44px',
              height: '44px',
              borderRadius: '10px',
              background: 'var(--bg-surface-2)',
              border: '1px solid var(--border-subtle)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent-primary)',
              marginBottom: '16px'
            }}>
              <ShieldCheck size={22} />
            </div>
            <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '6px' }}>Organization Required</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '12.5px', lineHeight: 1.6, marginBottom: '20px' }}>
              Sign in to your organization or register a new tenant to access dedicated vector embeddings, Neo4j graphs, and RAG pipelines.
            </p>
            <button 
              onClick={() => setAuthModalOpen(true)}
              className="btn btn-primary"
              style={{ padding: '8px 18px', fontSize: '12.5px' }}
            >
              Sign In or Onboard
            </button>
          </div>
        ) : (
          <>
            {activeTab === 'sources' && <SourceManager />}
            {activeTab === 'graph' && <GraphExplorer onNavigateToSources={() => setActiveTab('sources')} />}
            {activeTab === 'studio' && <ChatStudio />}
            {activeTab === 'settings' && <ChatbotSettings tenant={tenant} />}
          </>
        )}
      </main>

      {/* Bottom Minimalist Telemetry Status Bar */}
      <footer style={{
        height: '24px',
        background: 'var(--bg-surface-1)',
        borderTop: '1px solid var(--border-hairline)',
        padding: '0 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: '11px',
        color: 'var(--text-muted)',
        zIndex: 40
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
            <span className="telemetry-dot online"></span>
            <span>RLS Isolation Active</span>
          </span>
          <span>·</span>
          <span>Model: <strong style={{ color: 'var(--text-secondary)' }}>gemini-flash-lite-latest</strong></span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span>PostgreSQL <span className="tabular-nums">17 + pgvector</span></span>
          <span>·</span>
          <span>Neo4j <span className="tabular-nums">5.26</span></span>
        </div>
      </footer>

      {/* Auth Modal */}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onAuthSuccess={handleAuthSuccess}
      />
    </div>
  );
}
