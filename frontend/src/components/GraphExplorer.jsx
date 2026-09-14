import React, { useState, useEffect, useRef } from 'react';
import { Network } from 'vis-network';
import { DataSet } from 'vis-data';
import { graphApi } from '../api/client';
import { 
  Network as GraphIcon, 
  RefreshCw, 
  Search, 
  ZoomIn, 
  ZoomOut, 
  Maximize2,
  ChevronRight,
  Sparkles,
  X,
  Layers,
  Database,
  ArrowRight
} from 'lucide-react';

// Calibrated, desaturated entity color palette (Anti-Slop compliant)
const ENTITY_COLOR_MAP = {
  PERSON: { background: '#6366F1', border: '#818CF8' },
  PROJECT: { background: '#4F5BAE', border: '#6E79E2' },
  SYSTEM: { background: '#4F5BAE', border: '#6E79E2' },
  TECHNOLOGY: { background: '#0891B2', border: '#22D3EE' },
  LANGUAGE: { background: '#0891B2', border: '#22D3EE' },
  ORGANIZATION: { background: '#059669', border: '#34D399' },
  COMPANY: { background: '#059669', border: '#34D399' },
  CONCEPT: { background: '#D97706', border: '#FBBF24' },
  DEFAULT: { background: '#475569', border: '#94A3B8' }
};

export default function GraphExplorer({ onNavigateToSources }) {
  const containerRef = useRef(null);
  const networkRef = useRef(null);

  const [stats, setStats] = useState({ node_count: 0, relationship_count: 0 });
  const [loading, setLoading] = useState(false);
  const [seedInput, setSeedInput] = useState('');
  const [maxHops, setMaxHops] = useState(2);
  const [nodeLimit, setNodeLimit] = useState(60);

  const [selectedNode, setSelectedNode] = useState(null);
  const [connectedEdges, setConnectedEdges] = useState([]);
  const [allNodesList, setAllNodesList] = useState([]);
  const [allEdgesList, setAllEdgesList] = useState([]);

  const fetchStats = async () => {
    try {
      const data = await graphApi.getStats();
      setStats({
        node_count: data.node_count || 0,
        relationship_count: data.edge_count ?? data.relationship_count ?? 0,
      });
    } catch (err) {
      console.error('Error loading graph stats:', err);
    }
  };

  const loadGraph = async (seeds = []) => {
    setLoading(true);
    try {
      const data = await graphApi.getNeighborhood(seeds, maxHops, nodeLimit);
      const rawNodes = data.nodes || [];
      const rawEdges = data.edges || data.relationships || [];
      setAllNodesList(rawNodes);
      setAllEdgesList(rawEdges);
      renderNetwork(rawNodes, rawEdges);
    } catch (err) {
      console.error('Error loading graph neighborhood:', err);
    } finally {
      setLoading(false);
    }
  };

  const renderNetwork = (rawNodes, rawEdges) => {
    if (!containerRef.current) return;

    const visNodes = (rawNodes || []).map((n) => {
      const labelType = (n.type || n.label || 'CONCEPT').toUpperCase();
      const colors = ENTITY_COLOR_MAP[labelType] || ENTITY_COLOR_MAP.DEFAULT;
      return {
        id: n.name,
        label: n.name,
        title: `${n.name} (${labelType})`,
        group: labelType,
        color: {
          background: colors.background,
          border: colors.border,
          highlight: {
            background: '#FFFFFF',
            border: '#5E6AD2'
          }
        },
        font: { color: '#F2F3F5', size: 11, face: 'Inter' },
        shape: 'dot',
        size: 15,
        borderWidth: 1.5,
        properties: n.properties || {},
        entityLabel: labelType
      };
    });

    const visEdges = rawEdges.map((e, idx) => ({
      id: `edge-${idx}`,
      from: e.source,
      to: e.target,
      label: e.type,
      arrows: 'to',
      color: {
        color: 'rgba(255, 255, 255, 0.14)',
        highlight: '#5E6AD2'
      },
      font: { color: '#94969D', size: 9, align: 'middle', background: 'rgba(8, 9, 10, 0.85)' },
      smooth: { type: 'continuous' }
    }));

    const data = {
      nodes: new DataSet(visNodes),
      edges: new DataSet(visEdges)
    };

    const options = {
      physics: {
        solver: 'forceAtlas2Based',
        forceAtlas2Based: {
          gravitationalConstant: -36,
          centralGravity: 0.01,
          springLength: 90,
          springConstant: 0.08,
          damping: 0.45
        },
        stabilization: { iterations: 100 }
      },
      interaction: {
        hover: true,
        tooltipDelay: 150,
        zoomView: true,
        dragView: true
      }
    };

    if (networkRef.current) {
      networkRef.current.destroy();
    }

    const network = new Network(containerRef.current, data, options);
    networkRef.current = network;

    network.on('click', (params) => {
      if (params.nodes.length > 0) {
        const clickedId = params.nodes[0];
        const clickedNodeData = visNodes.find((n) => n.id === clickedId);
        const related = rawEdges.filter((e) => e.source === clickedId || e.target === clickedId);
        setSelectedNode(clickedNodeData);
        setConnectedEdges(related);
      } else {
        setSelectedNode(null);
        setConnectedEdges([]);
      }
    });
  };

  useEffect(() => {
    fetchStats();
    loadGraph([]);
  }, [maxHops, nodeLimit]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    const seeds = seedInput.split(',').map((s) => s.trim()).filter(Boolean);
    loadGraph(seeds);
  };

  const handleSelectNeighbor = (neighborName) => {
    const found = allNodesList.find((n) => n.name === neighborName);
    if (found) {
      const labelType = (found.type || found.label || 'CONCEPT').toUpperCase();
      const colors = ENTITY_COLOR_MAP[labelType] || ENTITY_COLOR_MAP.DEFAULT;
      setSelectedNode({
        id: found.name,
        entityLabel: labelType,
        color: colors,
        properties: found.properties || {}
      });
      const related = allEdgesList.filter((e) => e.source === neighborName || e.target === neighborName);
      setConnectedEdges(related);
      if (networkRef.current) {
        networkRef.current.focus(neighborName, { scale: 1.2, animation: true });
      }
    } else {
      setSeedInput(neighborName);
      loadGraph([neighborName]);
    }
  };

  const handleExpandFromSelected = () => {
    if (selectedNode) {
      setSeedInput(selectedNode.id);
      loadGraph([selectedNode.id]);
    }
  };

  return (
    <div style={{ position: 'relative', height: 'calc(100vh - 54px)', width: '100%', overflow: 'hidden', background: 'var(--bg-canvas)' }}>
      {/* Full-Bleed Interactive Vis-Network Canvas */}
      <div 
        ref={containerRef} 
        style={{ width: '100%', height: '100%', outline: 'none' }} 
      />

      {/* Empty State Guided Overlay */}
      {stats.node_count === 0 && !loading && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(8, 9, 10, 0.75)',
          backdropFilter: 'blur(4px)',
          zIndex: 10,
          pointerEvents: 'auto'
        }}>
          <div className="glass-panel" style={{ padding: '36px', maxWidth: '440px', textAlign: 'center' }}>
            <div className="empty-state-icon" style={{ margin: '0 auto 16px' }}>
              <GraphIcon size={24} />
            </div>
            <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '6px' }}>Knowledge Graph Empty</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '12.5px', lineHeight: 1.6, marginBottom: '20px' }}>
              Your graph will automatically populate as you ingest documents and web pages. Entities and relationships are extracted using Gemini.
            </p>
            {onNavigateToSources && (
              <button 
                onClick={onNavigateToSources}
                className="btn btn-primary"
                style={{ padding: '8px 18px', fontSize: '12.5px' }}
              >
                <Database size={14} />
                <span>Ingest First Document</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Floating Top HUD Control Bar */}
      <div style={{
        position: 'absolute',
        top: '16px',
        left: '20px',
        right: '20px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        pointerEvents: 'none',
        zIndex: 20
      }}>
        {/* Left: Seed Search Bar */}
        <form 
          onSubmit={handleSearchSubmit} 
          className="glass-panel"
          style={{
            pointerEvents: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '4px 8px 4px 12px',
            boxShadow: 'var(--shadow-md)',
            borderRadius: '9px',
            width: '360px'
          }}
        >
          <Search size={14} color="var(--text-muted)" />
          <input
            type="text"
            placeholder="Search entity node (e.g. Neo4j, FastAPI)..."
            value={seedInput}
            onChange={(e) => setSeedInput(e.target.value)}
            style={{
              border: 'none',
              background: 'transparent',
              fontSize: '12.5px',
              padding: '5px 0',
              boxShadow: 'none'
            }}
          />
          <button type="submit" disabled={loading} className="btn btn-primary" style={{ padding: '4px 10px', fontSize: '11.5px', borderRadius: '6px' }}>
            <span>Find</span>
          </button>
        </form>

        {/* Right: Controls & Metrics */}
        <div style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="glass-panel" style={{
            padding: '5px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: '14px',
            boxShadow: 'var(--shadow-md)',
            borderRadius: '9px',
            fontSize: '12px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Hops:</span>
              <input
                type="range"
                min={1}
                max={3}
                value={maxHops}
                onChange={(e) => setMaxHops(parseInt(e.target.value))}
                style={{ width: '60px', cursor: 'pointer' }}
              />
              <span className="tabular-nums" style={{ fontWeight: 600, color: 'var(--accent-primary)', fontSize: '11px' }}>{maxHops}</span>
            </div>

            <div style={{ width: '1px', height: '14px', background: 'var(--border-hairline)' }}></div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Nodes:</span>
              <span className="tabular-nums" style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '11.5px' }}>{stats.node_count}</span>
            </div>

            <div style={{ width: '1px', height: '14px', background: 'var(--border-hairline)' }}></div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Edges:</span>
              <span className="tabular-nums" style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '11.5px' }}>{stats.relationship_count}</span>
            </div>
          </div>

          <button 
            onClick={() => { fetchStats(); loadGraph([]); }}
            className="btn btn-secondary"
            style={{ padding: '7px 11px', borderRadius: '8px', fontSize: '12px' }}
            title="Reload graph cluster"
          >
            <RefreshCw size={13} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* Floating Canvas Camera Controls */}
      <div style={{
        position: 'absolute',
        bottom: '20px',
        left: '20px',
        display: 'flex',
        gap: '4px',
        zIndex: 20
      }}>
        <div className="glass-panel" style={{ display: 'flex', padding: '2px', borderRadius: '8px' }}>
          <button 
            onClick={() => networkRef.current && networkRef.current.moveTo({ scale: networkRef.current.getScale() * 1.25 })}
            className="btn-ghost" 
            style={{ padding: '6px 8px', borderRadius: '5px' }}
            title="Zoom In"
          >
            <ZoomIn size={14} />
          </button>
          <button 
            onClick={() => networkRef.current && networkRef.current.moveTo({ scale: networkRef.current.getScale() * 0.8 })}
            className="btn-ghost" 
            style={{ padding: '6px 8px', borderRadius: '5px' }}
            title="Zoom Out"
          >
            <ZoomOut size={14} />
          </button>
          <button 
            onClick={() => networkRef.current && networkRef.current.fit()}
            className="btn-ghost" 
            style={{ padding: '6px 8px', borderRadius: '5px' }}
            title="Fit Center"
          >
            <Maximize2 size={14} />
          </button>
        </div>
      </div>

      {/* Calibrated Entity Legend */}
      <div style={{
        position: 'absolute',
        bottom: '20px',
        right: '20px',
        background: 'var(--bg-surface-1)',
        border: '1px solid var(--border-hairline)',
        borderRadius: '8px',
        padding: '6px 14px',
        display: 'flex',
        gap: '14px',
        fontSize: '11px',
        color: 'var(--text-secondary)',
        zIndex: 20
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#6366F1' }}></span> Person
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#4F5BAE' }}></span> Project / System
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#0891B2' }}></span> Technology
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#059669' }}></span> Organization
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#D97706' }}></span> Concept
        </span>
      </div>

      {/* Right Slide-Over Entity Inspector Drawer */}
      {selectedNode && (
        <aside style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          width: '360px',
          background: 'var(--bg-surface-1)',
          borderLeft: '1px solid var(--border-subtle)',
          padding: '24px 20px',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--shadow-lg)',
          zIndex: 30,
          overflowY: 'auto'
        }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
            <div>
              <span className="eyebrow-tag" style={{ color: selectedNode.color.border, marginBottom: '6px' }}>
                {selectedNode.entityLabel}
              </span>
              <h3 style={{ fontSize: '18px', fontWeight: 600, wordBreak: 'break-word', color: 'var(--text-primary)' }}>
                {selectedNode.id}
              </h3>
            </div>
            <button 
              onClick={() => setSelectedNode(null)}
              className="btn-ghost"
              style={{ padding: '5px', borderRadius: '6px' }}
            >
              <X size={16} />
            </button>
          </div>

          <button 
            onClick={handleExpandFromSelected}
            className="btn btn-primary"
            style={{ width: '100%', marginBottom: '20px', padding: '8px', fontSize: '12px' }}
          >
            <Sparkles size={14} />
            <span>Traverse 1-Hop Neighbors</span>
          </button>

          <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: '10px' }}>
            Connected Neighborhood ({connectedEdges.length})
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, overflowY: 'auto' }}>
            {connectedEdges.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>No direct edges in current cluster view.</div>
            ) : (
              connectedEdges.map((edge, idx) => {
                const isOutgoing = edge.source === selectedNode.id;
                const neighborName = isOutgoing ? edge.target : edge.source;
                return (
                  <div 
                    key={idx} 
                    className="glass-panel" 
                    onClick={() => handleSelectNeighbor(neighborName)}
                    style={{ 
                      padding: '10px 12px', 
                      fontSize: '12px',
                      cursor: 'pointer',
                      transition: 'border-color 0.15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                        {isOutgoing ? 'Points to' : 'Referenced by'}
                      </span>
                      <span style={{ color: 'var(--accent-primary)', fontWeight: 600, fontSize: '11px' }}>
                        {edge.type}
                      </span>
                    </div>
                    <div style={{ fontWeight: 500, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span>{neighborName}</span>
                      <ArrowRight size={12} color="var(--text-muted)" />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
