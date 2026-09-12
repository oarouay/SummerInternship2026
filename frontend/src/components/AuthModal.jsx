import React, { useState } from 'react';
import { authApi } from '../api/client';
import { X, Building2, Lock, Mail, User, AlertCircle, Sparkles } from 'lucide-react';

export default function AuthModal({ isOpen, onClose, onAuthSuccess }) {
  const [mode, setMode] = useState('login'); // 'login' or 'register'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Login form state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginSlug, setLoginSlug] = useState('');

  // Register form state
  const [tenantName, setTenantName] = useState('');
  const [tenantSlug, setTenantSlug] = useState('');
  const [tenantDesc, setTenantDesc] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');

  if (!isOpen) return null;

  const handleNameChange = (e) => {
    const val = e.target.value;
    setTenantName(val);
    const generated = val.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    setTenantSlug(generated);
  };

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await authApi.login(loginEmail, loginPassword, loginSlug);
      const meData = await authApi.getMe();
      onAuthSuccess(meData);
      onClose();
    } catch (err) {
      setError(err.message || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await authApi.registerTenant({
        tenant_name: tenantName,
        tenant_slug: tenantSlug,
        tenant_description: tenantDesc,
        admin_name: adminName,
        admin_email: adminEmail,
        admin_password: adminPassword,
      });
      const meData = await authApi.getMe();
      onAuthSuccess(meData);
      onClose();
    } catch (err) {
      setError(err.message || 'Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0, 0, 0, 0.8)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '20px'
    }}>
      <div 
        className="hairline-card"
        style={{
          width: '100%',
          maxWidth: '440px',
          padding: '24px',
          position: 'relative',
          background: 'var(--bg-surface-1)',
          boxShadow: 'var(--shadow-lg)'
        }}
      >
        <button
          onClick={onClose}
          className="btn-ghost"
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            padding: '4px',
            borderRadius: '4px'
          }}
        >
          <X size={16} />
        </button>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '9px',
            background: 'var(--bg-surface-2)',
            border: '1px solid var(--border-subtle)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--accent-primary)',
            marginBottom: '10px'
          }}>
            <Building2 size={18} />
          </div>
          <h2 style={{ fontSize: '17px', fontWeight: 600, color: 'var(--text-primary)' }}>
            {mode === 'login' ? 'Sign In to Workspace' : 'Onboard New Tenant'}
          </h2>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '3px' }}>
            {mode === 'login' 
              ? 'Access organization vector chunks and knowledge graph.' 
              : 'Deploy a tenant-isolated GraphRAG cluster.'}
          </p>
        </div>

        {/* Segmented Control */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '18px' }}>
          <div className="segmented-control" style={{ width: '100%' }}>
            <button
              type="button"
              onClick={() => { setMode('login'); setError(''); }}
              className={mode === 'login' ? 'active' : ''}
              style={{ flex: 1, justifyContent: 'center' }}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => { setMode('register'); setError(''); }}
              className={mode === 'register' ? 'active' : ''}
              style={{ flex: 1, justifyContent: 'center' }}
            >
              Register Tenant
            </button>
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'var(--accent-rose-subtle)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '6px',
            padding: '8px 12px',
            marginBottom: '14px',
            fontSize: '12px',
            color: 'var(--accent-rose)'
          }}>
            <AlertCircle size={14} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        {/* Login Form */}
        {mode === 'login' ? (
          <form onSubmit={handleLoginSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>
                Email Address *
              </label>
              <input
                type="email"
                required
                placeholder="admin@example.com"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
              />
            </div>

            <div>
              <label style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>
                Password *
              </label>
              <input
                type="password"
                required
                placeholder="••••••••"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
              />
            </div>

            <div>
              <label style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>
                Tenant Identifier (Optional Slug)
              </label>
              <input
                type="text"
                placeholder="e.g. acme-corp"
                value={loginSlug}
                onChange={(e) => setLoginSlug(e.target.value)}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary"
              style={{ marginTop: '8px', width: '100%', padding: '9px' }}
            >
              <span>{loading ? 'Authenticating...' : 'Sign In'}</span>
            </button>
          </form>
        ) : (
          /* Register Form */
          <form onSubmit={handleRegisterSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '3px', display: 'block' }}>
                  Organization Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Acme Global"
                  value={tenantName}
                  onChange={handleNameChange}
                />
              </div>

              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '3px', display: 'block' }}>
                  Tenant Slug *
                </label>
                <input
                  type="text"
                  required
                  placeholder="acme-global"
                  value={tenantSlug}
                  onChange={(e) => setTenantSlug(e.target.value.toLowerCase())}
                />
              </div>
            </div>

            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '3px', display: 'block' }}>
                Admin Full Name *
              </label>
              <input
                type="text"
                required
                placeholder="Jane Doe"
                value={adminName}
                onChange={(e) => setAdminName(e.target.value)}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '3px', display: 'block' }}>
                  Admin Email *
                </label>
                <input
                  type="email"
                  required
                  placeholder="jane@acme.com"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                />
              </div>

              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '3px', display: 'block' }}>
                  Password *
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  placeholder="••••••••"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary"
              style={{ marginTop: '8px', width: '100%', padding: '9px' }}
            >
              <Sparkles size={13} />
              <span>{loading ? 'Initializing...' : 'Initialize & Launch'}</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
