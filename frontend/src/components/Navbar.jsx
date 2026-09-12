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
    { id: 'studio', label: 'RAG Studio', icon: Bot },
    { id: 'graph', label: 'Knowledge Graph', icon: Network },
    { id: 'sources', label: 'Document Base', icon: Files },
    { id: 'settings', label: 'Persona & Widget', icon: SettingsIcon },
  ];

  const getTabLabel = () => {
    const active = tabs.find(t => t.id === activeTab);
    return active ? active.label : 'Studio';
  };

  return (
    <header style={{ 
      background: 'var(--bg-surface-1)',
      borderBottom: '1px solid var(--border-hairline)',
      padding: '0 20px',
      height: '52px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'sticky',
      top: 0,
      zIndex: 50
    }}>
      {/* Left: Brand Monogram & Linear Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {/* Monogram */}
        <div style={{ 
          width: '28px', 
          height: '28px', 
          borderRadius: '7px', 
          background: 'var(--bg-surface-3)',
          border: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--accent-primary)',
          fontWeight: 700,
          fontSize: '11px',
          letterSpacing: '-0.02em'
        }}>
          OG
        </div>

        {/* Breadcrumb Trail */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
            OmniGraph
          </span>
          <span style={{ color: 'var(--text-muted)' }}>/</span>
          <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
            {tenant ? tenant.slug : 'workspace'}
          </span>
          <span style={{ color: 'var(--text-muted)' }}>/</span>
          <span style={{ 
            color: 'var(--text-primary)', 
            fontWeight: 600,
            background: 'var(--bg-surface-2)',
            padding: '2px 8px',
            borderRadius: '5px',
            fontSize: '12px',
            border: '1px solid var(--border-hairline)'
          }}>
            {getTabLabel()}
          </span>
        </div>
      </div>

      {/* Center: Minimalist Segmented Tabs */}
      <nav className="segmented-control">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={isActive ? 'active' : ''}
            >
              <Icon size={14} style={{ opacity: isActive ? 1 : 0.7 }} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Right: Telemetry Health Indicators & Profile */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        {/* Real-Time Telemetry Cluster */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11.5px', color: 'var(--text-muted)' }}>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '6px',
            background: 'var(--bg-surface-2)',
            border: '1px solid var(--border-hairline)',
            padding: '3px 9px',
            borderRadius: '16px'
          }}>
            <span className="telemetry-dot online"></span>
            <span style={{ color: 'var(--text-secondary)' }}>pgvector</span>
            <span className="tabular-nums" style={{ color: 'var(--text-muted)', fontSize: '10px' }}>768d</span>
          </div>

          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '6px',
            background: 'var(--bg-surface-2)',
            border: '1px solid var(--border-hairline)',
            padding: '3px 9px',
            borderRadius: '16px'
          }}>
            <span className="telemetry-dot online"></span>
            <span style={{ color: 'var(--text-secondary)' }}>Neo4j</span>
            <span className="tabular-nums" style={{ color: 'var(--text-muted)', fontSize: '10px' }}>5.26</span>
          </div>
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
