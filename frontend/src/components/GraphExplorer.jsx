import React, { useState, useEffect, useRef } from 'react';
import { Network } from 'vis-network';
import { DataSet } from 'vis-data';
import { graphApi } from '../api/client';
import { 
  Network as GraphIcon, 
  RefreshCw, 
  Search, 
  Sliders, 
  ZoomIn, 
  ZoomOut, 
  Maximize2,
  ChevronRight,
  Sparkles,
  X,
  Layers,
  Share2
} from 'lucide-react';

const ENTITY_COLOR_MAP = {
  PERSON: { background: '#8B5CF6', border: '#A78BFA' },
  PROJECT: { background: '#5E6AD2', border: '#818CF8' },
  SYSTEM: { background: '#5E6AD2', border: '#818CF8' },
  TECHNOLOGY: { background: '#06B6D4', border: '#67E8F9' },
  LANGUAGE: { background: '#06B6D4', border: '#67E8F9' },
  ORGANIZATION: { background: '#10B981', border: '#34D399' },
  COMPANY: { background: '#10B981', border: '#34D399' },
  DEFAULT: { background: '#F59E0B', border: '#FBBF24' }
};

export default function GraphExplorer() {
  const containerRef = useRef(null);
  const networkRef = useRef(null);

  const [stats, setStats] = useState({ node_count: 0, relationship_count: 0 });
  const [loading, setLoading] = useState(false);
  const [seedInput, setSeedInput] = useState('');
  const [maxHops, setMaxHops] = useState(2);
  const [nodeLimit, setNodeLimit] = useState(60);

  const [selectedNode, setSelectedNode] = useState(null);
  const [connectedEdges, setConnectedEdges] = useState([]);

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
      renderNetwork(data.nodes || [], data.edges || data.relationships || []);
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
        size: 16,
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
        color: 'rgba(255, 255, 255, 0.16)',
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
          gravitationalConstant: -38,
          centralGravity: 0.01,
          springLength: 95,
          springConstant: 0.08,
          damping: 0.4
        },
        stabilization: { iterations: 120 }
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

  const handleExpandFromSelected = () => {
    if (selectedNode) {
      setSeedInput(selectedNode.id);
      loadGraph([selectedNode.id]);
    }
  };

  return (
    <div style={{ position: 'relative', height: 'calc(100vh - 52px)', width: '100%', overflow: 'hidden', background: 'var(--bg-canvas)' }}>
      {/* Full-Bleed Interactive Canvas */}
      <div 
        ref={containerRef} 
        style={{ width: '100%', height: '100%', outline: 'none' }} 
      />

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
          className="hairline-card"
          style={{
            pointerEvents: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '4px 8px 4px 12px',
            background: 'var(--bg-surface-1)',
            boxShadow: 'var(--shadow-md)',
            borderRadius: '9px',
            width: '380px'
          }}
        >
          <Search size={14} color="var(--text-muted)" />
          <input
            type="text"
            placeholder="Search seed entities (e.g. Neo4j, Python)..."
            value={seedInput}
            onChange={(e) => setSeedInput(e.target.value)}
            style={{
              border: 'none',
              background: 'transparent',
              fontSize: '12.5px',
              padding: '4px 0',
              boxShadow: 'none'
            }}
          />
          <button type="submit" disabled={loading} className="btn btn-primary" style={{ padding: '4px 10px', fontSize: '11px', borderRadius: '5px' }}>
            <span>Traverse</span>
          </button>
        </form>

        {/* Right: Sliders & Telemetry Pill */}
        <div style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="hairline-card" style={{
            padding: '4px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: '14px',
            background: 'var(--bg-surface-1)',
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
                style={{ width: '65px', cursor: 'pointer' }}
              />
              <span className="tabular-nums" style={{ fontWeight: 600, color: 'var(--accent-primary)', fontSize: '11px' }}>{maxHops}</span>
            </div>

            <div style={{ width: '1px', height: '14px', background: 'var(--border-hairline)' }}></div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Nodes:</span>
              <span className="tabular-nums" style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '11px' }}>{stats.node_count}</span>
            </div>

            <div style={{ width: '1px', height: '14px', background: 'var(--border-hairline)' }}></div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Edges:</span>
              <span className="tabular-nums" style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '11px' }}>{stats.relationship_count}</span>
            </div>
          </div>

          <button 
            onClick={() => { fetchStats(); loadGraph([]); }}
            className="btn btn-secondary"
            style={{ padding: '6px 10px', borderRadius: '8px', fontSize: '12px' }}
            title="Reload graph"
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
        <div className="hairline-card" style={{ display: 'flex', background: 'var(--bg-surface-1)', padding: '2px', borderRadius: '7px' }}>
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

      {/* Bottom Minimalist Legend */}
      <div style={{
        position: 'absolute',
        bottom: '20px',
        right: '20px',
        background: 'var(--bg-surface-1)',
        border: '1px solid var(--border-hairline)',
        borderRadius: '8px',
        padding: '6px 12px',
        display: 'flex',
        gap: '12px',
        fontSize: '11px',
        zIndex: 20
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#8B5CF6' }}></span> Person
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#5E6AD2' }}></span> System / Project
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#06B6D4' }}></span> Technology
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#10B981' }}></span> Organization
        </span>
      </div>

      {/* Right Slide-Over Property Inspector Drawer */}
      {selectedNode && (
        <aside style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          width: '340px',
          background: 'var(--bg-surface-1)',
          borderLeft: '1px solid var(--border-hairline)',
          padding: '24px 20px',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--shadow-lg)',
          zIndex: 30,
          overflowY: 'auto'
        }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '18px' }}>
            <div>
              <span className="eyebrow-tag" style={{ color: selectedNode.color.background, marginBottom: '6px' }}>
                {selectedNode.entityLabel}
              </span>
              <h3 style={{ fontSize: '18px', fontWeight: 600, wordBreak: 'break-word' }}>
                {selectedNode.id}
              </h3>
            </div>
            <button 
              onClick={() => setSelectedNode(null)}
              className="btn-ghost"
              style={{ padding: '4px', borderRadius: '5px' }}
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
            <span>Traverse Connected Hops</span>
          </button>

          <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: '10px' }}>
            Connected Relationships ({connectedEdges.length})
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, overflowY: 'auto' }}>
            {connectedEdges.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>No direct edges in current cluster view.</div>
            ) : (
              connectedEdges.map((edge, idx) => {
                const isOutgoing = edge.source === selectedNode.id;
                return (
                  <div key={idx} className="hairline-card" style={{ padding: '8px 10px', fontSize: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--text-muted)', fontSize: '10.5px', marginBottom: '2px' }}>
                      <span>{isOutgoing ? 'OUTGOING' : 'INCOMING'}</span>
                      <ChevronRight size={10} />
                      <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{edge.type}</span>
                    </div>
                    <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                      {isOutgoing ? edge.target : edge.source}
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
