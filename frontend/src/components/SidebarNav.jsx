import React, { useState } from 'react';
import { 
  MessageSquare, 
  Database, 
  Network, 
  Sliders, 
  Code2, 
  ChevronLeft, 
  ChevronRight, 
  Sun, 
  Moon, 
  Laptop, 
  LogOut, 
  ShieldCheck,
  Building2,
  ChevronDown,
  Sparkles
} from 'lucide-react';

export default function SidebarNav({
  activeTab,
  setActiveTab,
  tenant,
  user,
  theme,
  setTheme,
  onLogout
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);

  const navItems = [
    { id: 'ask', label: 'Ask', icon: MessageSquare, description: 'Questions & answers' },
    { id: 'knowledge', label: 'Knowledge', icon: Database, description: 'Documents & sources' },
    { id: 'explore', label: 'Explore', icon: Network, description: 'Entities & graph links' },
    { id: 'ai-profile', label: 'AI Profile', icon: Sparkles, description: 'Enterprise policies & personas' },
    { id: 'assistant', label: 'Assistant', icon: Sliders, description: 'Behavior & model tuning' },
    { id: 'integrations', label: 'Integrations', icon: Code2, description: 'Website widget deploy' },
  ];

  const cycleTheme = () => {
    if (theme === 'dark') setTheme('light');
    else if (theme === 'light') setTheme('system');
    else setTheme('dark');
  };

  const getThemeIcon = () => {
    if (theme === 'light') return <Sun size={14} />;
    if (theme === 'dark') return <Moon size={14} />;
    return <Laptop size={14} />;
  };

  const getThemeLabel = () => {
    if (theme === 'light') return 'Light';
    if (theme === 'dark') return 'Dark';
    return 'System';
  };

  const sidebarWidth = collapsed ? 'var(--sidebar-collapsed-width)' : 'var(--sidebar-width)';

  return (
    <aside
      aria-label="Main Navigation"
      style={{
        width: sidebarWidth,
        minWidth: sidebarWidth,
        height: '100vh',
        background: 'var(--bg-surface-1)',
        borderRight: '1px solid var(--border-hairline)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        transition: 'width 0.2s cubic-bezier(0.16, 1, 0.3, 1), min-width 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        zIndex: 50,
        position: 'relative',
        userSelect: 'none'
      }}
    >
      {/* Top: Header & Workspace Identifier */}
      <div>
        <div
          style={{
            padding: collapsed ? '16px 12px' : '16px 14px',
            borderBottom: '1px solid var(--border-hairline)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'space-between',
            gap: '10px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', overflow: 'hidden' }}>
            {/* Logo Mark */}
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: 'var(--accent-primary-subtle)',
                border: '1px solid var(--accent-primary-border)',
                color: 'var(--accent-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: '13px',
                letterSpacing: '-0.02em',
                flexShrink: 0
              }}
              title="OmniGraph RAG"
            >
              OG
            </div>

            {!collapsed && (
              <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)', letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
                  OmniGraph
                </span>
                <span
                  style={{
                    fontSize: '11px',
                    color: 'var(--text-secondary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: '140px'
                  }}
                  title={tenant ? tenant.name : 'Workspace'}
                >
                  {tenant ? tenant.name : 'Workspace'}
                </span>
              </div>
            )}
          </div>

          {/* Collapse Toggle */}
          {!collapsed && (
            <button
              onClick={() => setCollapsed(true)}
              className="btn-ghost"
              style={{ padding: '4px', borderRadius: '6px' }}
              title="Collapse navigation"
              aria-label="Collapse navigation"
            >
              <ChevronLeft size={15} />
            </button>
          )}
        </div>

        {collapsed && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0' }}>
            <button
              onClick={() => setCollapsed(false)}
              className="btn-ghost"
              style={{ padding: '4px', borderRadius: '6px' }}
              title="Expand navigation"
              aria-label="Expand navigation"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        )}

        {/* Navigation Items */}
        <nav style={{ padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className="btn-ghost"
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  padding: collapsed ? '10px' : '9px 12px',
                  borderRadius: '8px',
                  background: isActive ? 'var(--accent-primary-subtle)' : 'transparent',
                  color: isActive ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  border: isActive ? '1px solid var(--accent-primary-border)' : '1px solid transparent',
                  fontWeight: isActive ? 600 : 500,
                  fontSize: '13px',
                  transition: 'all var(--transition-fast)'
                }}
                title={collapsed ? `${item.label} — ${item.description}` : undefined}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon size={17} style={{ flexShrink: 0, opacity: isActive ? 1 : 0.8 }} />
                {!collapsed && (
                  <span style={{ whiteSpace: 'nowrap' }}>{item.label}</span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom Area: Theme Switcher & User Account */}
      <div style={{ borderTop: '1px solid var(--border-hairline)', padding: '10px 8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {/* Theme Mode Toggle Button */}
        <button
          onClick={cycleTheme}
          className="btn-ghost"
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            justifyContent: collapsed ? 'center' : 'space-between',
            padding: collapsed ? '8px' : '7px 12px',
            borderRadius: '7px',
            fontSize: '12px',
            color: 'var(--text-secondary)'
          }}
          title={`Theme: ${getThemeLabel()} (Click to toggle)`}
          aria-label={`Current theme: ${getThemeLabel()}. Click to change.`}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {getThemeIcon()}
            {!collapsed && <span>Theme: {getThemeLabel()}</span>}
          </div>
        </button>

        {/* User Account / Tenant Profile Menu */}
        {tenant && user && (
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowAccountMenu(!showAccountMenu)}
              className="btn-ghost"
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                justifyContent: collapsed ? 'center' : 'space-between',
                padding: collapsed ? '8px' : '6px 10px',
                borderRadius: '8px',
                fontSize: '12px',
                color: 'var(--text-primary)',
                background: showAccountMenu ? 'var(--bg-surface-2)' : 'transparent'
              }}
              title={user.email}
              aria-label="User account menu"
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                <div
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '6px',
                    background: 'var(--bg-surface-3)',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '11px',
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    flexShrink: 0
                  }}
                >
                  {user.email ? user.email.charAt(0).toUpperCase() : 'U'}
                </div>

                {!collapsed && (
                  <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'left', overflow: 'hidden' }}>
                    <span style={{ fontWeight: 500, fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {user.email}
                    </span>
                    <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
                      {user.role || 'Member'}
                    </span>
                  </div>
                )}
              </div>

              {!collapsed && <ChevronDown size={13} color="var(--text-muted)" />}
            </button>

            {/* Account Popover Menu */}
            {showAccountMenu && (
              <div
                className="calm-panel"
                style={{
                  position: 'absolute',
                  bottom: '100%',
                  left: collapsed ? '100%' : '0',
                  marginBottom: '8px',
                  width: '210px',
                  padding: '6px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                  boxShadow: 'var(--shadow-lg)',
                  zIndex: 100
                }}
              >
                <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-hairline)' }}>
                  <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Active Organization
                  </div>
                  <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-primary)', marginTop: '2px' }}>
                    {tenant.name}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                    slug: {tenant.slug}
                  </div>
                </div>

                <button
                  onClick={() => {
                    setShowAccountMenu(false);
                    onLogout();
                  }}
                  className="btn-ghost"
                  style={{
                    width: '100%',
                    justifyContent: 'flex-start',
                    padding: '8px 10px',
                    fontSize: '12px',
                    color: 'var(--accent-rose-text)',
                    gap: '8px',
                    borderRadius: '6px'
                  }}
                >
                  <LogOut size={13} />
                  <span>Sign Out</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
