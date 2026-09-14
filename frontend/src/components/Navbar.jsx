import React, { useState } from 'react';
import { 
  Bot, 
  Network, 
  Files, 
  Settings as SettingsIcon, 
  LogOut, 
  User as UserIcon,
  ChevronDown,
  Layers,
  Sparkles,
  Command
} from 'lucide-react';

export default function Navbar({ 
  activeTab, 
  setActiveTab, 
  tenant, 
  user, 
  onAuthClick, 
  onLogout 
}) {
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  const tabs = [
    { id: 'sources', label: 'Knowledge Base', icon: Files },
    { id: 'graph', label: 'Knowledge Graph', icon: Network },
    { id: 'studio', label: 'Chat Studio', icon: Bot },
    { id: 'settings', label: 'Integration & Bot', icon: SettingsIcon },
  ];

  return (
    <header style={{ 
      background: 'var(--bg-surface-1)',
      borderBottom: '1px solid var(--border-hairline)',
      padding: '0 24px',
      height: '54px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'sticky',
      top: 0,
      zIndex: 50
    }}>
      {/* Left: Brand Identity & Tenant Context */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <div style={{ 
          width: '30px', 
          height: '30px', 
          borderRadius: '8px', 
          background: 'linear-gradient(135deg, rgba(94, 106, 210, 0.2) 0%, rgba(94, 106, 210, 0.05) 100%)',
          border: '1px solid rgba(94, 106, 210, 0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--accent-primary)',
          fontWeight: 700,
          fontSize: '12px',
          letterSpacing: '-0.02em',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
        }}>
          OG
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
            OmniGraph
          </span>
          <span style={{ color: 'var(--text-muted)' }}>/</span>
          <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
            {tenant ? tenant.name : 'Workspace'}
          </span>
        </div>
      </div>

      {/* Center: Purpose-Oriented Workflow Navigation */}
      <nav className="segmented-control" style={{ padding: '4px' }}>
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={isActive ? 'active' : ''}
              style={{
                padding: '6px 14px',
                fontSize: '12.5px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '7px'
              }}
            >
              <Icon size={14} style={{ opacity: isActive ? 1 : 0.65 }} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Right: Consolidated System Status & Profile */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '6px',
          background: 'rgba(16, 185, 129, 0.08)',
          border: '1px solid rgba(16, 185, 129, 0.2)',
          padding: '4px 10px',
          borderRadius: '16px',
          fontSize: '11px',
          color: '#34D399',
          fontWeight: 500
        }}>
          <span className="telemetry-dot online" style={{ width: '6px', height: '6px' }}></span>
          <span>Cluster Active</span>
        </div>

        {/* Tenant Profile Dropdown */}
        {tenant && user ? (
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowProfileMenu(!showProfileMenu)}
              className="btn btn-secondary"
              style={{
                padding: '4px 10px',
                fontSize: '12px',
                borderRadius: '7px',
                gap: '8px'
              }}
            >
              <div style={{
                width: '18px',
                height: '18px',
                borderRadius: '4px',
                background: 'var(--accent-primary-subtle)',
                color: 'var(--accent-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '10px',
                fontWeight: 700
              }}>
                {tenant.slug ? tenant.slug.substring(0, 1).toUpperCase() : 'T'}
              </div>
              <span style={{ fontWeight: 500 }}>{tenant.name}</span>
              <ChevronDown size={12} color="var(--text-muted)" />
            </button>

            {showProfileMenu && (
              <div 
                className="hairline-card"
                style={{
                  position: 'absolute',
                  right: 0,
                  top: '115%',
                  width: '230px',
                  padding: '8px',
                  boxShadow: 'var(--shadow-lg)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  zIndex: 100
                }}
              >
                <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-hairline)', fontSize: '11.5px' }}>
                  <div style={{ color: 'var(--text-muted)' }}>Signed in as</div>
                  <div style={{ fontWeight: 500, color: 'var(--text-primary)', wordBreak: 'break-all' }}>{user.email}</div>
                  <div style={{ color: 'var(--accent-primary)', textTransform: 'capitalize', fontSize: '10.5px', marginTop: '3px' }}>Role: {user.role}</div>
                </div>

                <button
                  onClick={() => {
                    setShowProfileMenu(false);
                    onAuthClick();
                  }}
                  className="btn btn-ghost"
                  style={{ width: '100%', justifyContent: 'flex-start', fontSize: '12px', padding: '6px 10px' }}
                >
                  <UserIcon size={14} />
                  <span>Switch Organization</span>
                </button>

                <button
                  onClick={() => {
                    setShowProfileMenu(false);
                    onLogout();
                  }}
                  className="btn btn-danger"
                  style={{ width: '100%', justifyContent: 'flex-start', fontSize: '12px', padding: '6px 10px', marginTop: '2px' }}
                >
                  <LogOut size={14} />
                  <span>Sign Out</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <button 
            onClick={onAuthClick}
            className="btn btn-primary"
            style={{ fontSize: '12px', padding: '5px 12px' }}
          >
            <span>Sign In</span>
          </button>
        )}
      </div>
    </header>
  );
}
