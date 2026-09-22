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
  X, 
  Table,
  Eye
} from 'lucide-react';

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
  const [searchQuery, setSearchQuery] = useState('');
  const [maxHops, setMaxHops] = useState(2);
  const [nodeLimit, setNodeLimit] = useState(60);

  // View Mode: 'canvas' | 'table'
  const [viewMode, setViewMode] = useState('canvas');
  const [tableTab, setTableTab] = useState('entities'); // 'entities' | 'relationships'

  // Selection & Details
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedEdge, setSelectedEdge] = useState(null);
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
      if (viewMode === 'canvas') {
        renderNetwork(rawNodes, rawEdges);
      }
    } catch (err) {
      console.error('Error loading graph neighborhood:', err);
    } finally {
      setLoading(false);
    }
  };

  const renderNetwork = (rawNodes, rawEdges) => {
    if (!containerRef.current) return;

    const isLight = document.documentElement.getAttribute('data-theme') === 'light';

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
            border: '#4F5BD5'
          }
        },
        font: { color: isLight ? '#17202E' : '#F2F4F8', size: 11, face: 'Inter' },
        shape: 'dot',
        size: 14,
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
        color: isLight ? 'rgba(0, 0, 0, 0.18)' : 'rgba(255, 255, 255, 0.18)',
        highlight: '#4F5BD5'
      },
      font: { 
        color: isLight ? '#4A5668' : '#B4BFD2', 
        size: 9, 
        align: 'middle', 
        background: isLight ? 'rgba(255, 255, 255, 0.85)' : 'rgba(25, 29, 36, 0.85)' 
      },
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
          gravitationalConstant: -32,
          centralGravity: 0.01,
          springLength: 90,
          springConstant: 0.08,
          damping: 0.45
        },
        stabilization: {
          iterations: 80,
          updateInterval: 25
        }
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
        setSelectedEdge(null);
        setConnectedEdges(related);
      } else if (params.edges.length > 0) {
        const edgeId = params.edges[0];
        const edgeIndex = parseInt(edgeId.replace('edge-', ''), 10);
        const clickedEdge = rawEdges[edgeIndex];
        setSelectedEdge(clickedEdge);
        setSelectedNode(null);
        setConnectedEdges([]);
      } else {
        setSelectedNode(null);
        setSelectedEdge(null);
        setConnectedEdges([]);
      }
    });
  };

  useEffect(() => {
    fetchStats();
    loadGraph([]);
  }, [maxHops, nodeLimit]);

  useEffect(() => {
    if (viewMode === 'canvas' && allNodesList.length > 0) {
      renderNetwork(allNodesList, allEdgesList);
    }
  }, [viewMode]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    const seeds = searchQuery.split(',').map((s) => s.trim()).filter(Boolean);
    loadGraph(seeds);
  };

  const handleSelectNeighbor = (neighborName) => {
    const found = allNodesList.find((n) => n.name === neighborName);
    if (found) {
      const labelType = (found.type || found.label || 'CONCEPT').toUpperCase();
      const colors = ENTITY_COLOR_MAP[labelType] || ENTITY_COLOR_MAP.DEFAULT;
      setSelectedNode({
        id: found.name,
        label: found.name,
        entityLabel: labelType,
        properties: found.properties || {},
        color: colors
      });
      const related = allEdgesList.filter((e) => e.source === found.name || e.target === found.name);
      setConnectedEdges(related);
      if (networkRef.current && viewMode === 'canvas') {
        networkRef.current.selectNodes([found.name]);
        networkRef.current.focus(found.name, { scale: 1.2, animation: true });
      }
    }
  };

  return (
    <div className="workspace-page" style={{ padding: '20px 24px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Workspace Header */}
      <div className="workspace-header" style={{ marginBottom: '14px' }}>
        <div>
          <h1 className="workspace-title">
            <GraphIcon size={20} color="var(--accent-primary)" />
            <span>Knowledge Graph Explorer</span>
          </h1>
          <p className="workspace-subtitle">
            Traverse interconnected entities, extract semantic triples, and audit multi-hop relationships.
          </p>
        </div>

        {/* View Mode Switcher */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <div className="calm-panel" style={{ padding: '3px', display: 'flex', gap: '3px' }}>
            <button
              onClick={() => setViewMode('canvas')}
              className="btn-ghost"
              style={{
                padding: '5px 10px',
                fontSize: '12px',
                borderRadius: '6px',
                background: viewMode === 'canvas' ? 'var(--bg-surface-3)' : 'transparent',
                color: viewMode === 'canvas' ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: viewMode === 'canvas' ? 600 : 500
              }}
            >
              <GraphIcon size={13} />
              <span>Spatial Graph</span>
            </button>

            <button
              onClick={() => setViewMode('table')}
              className="btn-ghost"
              style={{
                padding: '5px 10px',
                fontSize: '12px',
                borderRadius: '6px',
                background: viewMode === 'table' ? 'var(--bg-surface-3)' : 'transparent',
                color: viewMode === 'table' ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: viewMode === 'table' ? 600 : 500
              }}
            >
              <Table size={13} />
              <span>Accessible Table</span>
            </button>
          </div>
        </div>
      </div>

      {/* Search & Graph Traversal Toolbar */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
        <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: '8px', flex: 1, minWidth: '320px' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={14} color="var(--text-muted)" style={{ position: 'absolute', left: '10px', top: '10px' }} />
            <input
              type="text"
              placeholder="Find a person, project, organization, or topic..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ paddingLeft: '32px' }}
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ padding: '8px 16px' }}>
            <span>Find Connections</span>
          </button>
        </form>

        {/* Connection Depth Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <label style={{ margin: 0, fontSize: '11.5px', color: 'var(--text-secondary)' }} title="Connection depth: number of relationship hops traversed from the seed entity">
            Depth:
          </label>
          <select
            value={maxHops}
            onChange={(e) => setMaxHops(parseInt(e.target.value, 10))}
            style={{ width: '85px', height: '34px', fontSize: '12px' }}
            aria-label="Connection depth in hops"
          >
            <option value="1">1 Hop</option>
            <option value="2">2 Hops</option>
            <option value="3">3 Hops</option>
          </select>
        </div>

        {/* Node Limit */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <label style={{ margin: 0, fontSize: '11.5px', color: 'var(--text-secondary)' }}>
            Limit:
          </label>
          <select
            value={nodeLimit}
            onChange={(e) => setNodeLimit(parseInt(e.target.value, 10))}
            style={{ width: '90px', height: '34px', fontSize: '12px' }}
            aria-label="Node count limit"
          >
            <option value="30">30 Nodes</option>
            <option value="60">60 Nodes</option>
            <option value="100">100 Nodes</option>
          </select>
        </div>

        <button
          onClick={() => {
            setSearchQuery('');
            loadGraph([]);
          }}
          className="btn btn-secondary"
          style={{ padding: '8px 12px', fontSize: '12px' }}
          title="Reset graph view"
        >
          <RefreshCw size={13} className={loading ? 'spin' : ''} />
          <span>Reset</span>
        </button>
      </div>

      {/* Main View Area */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, gap: '14px', position: 'relative' }}>
        {/* Spatial Canvas View */}
        {viewMode === 'canvas' && (
          <div
            className="calm-panel"
            style={{
              flex: 1,
              position: 'relative',
              overflow: 'hidden',
              minHeight: '400px',
              display: 'flex'
            }}
          >
            <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

            {/* Top Overlay Stats Badge */}
            <div
              style={{
                position: 'absolute',
                top: '12px',
                left: '12px',
                background: 'var(--bg-surface-1)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '8px',
                padding: '6px 12px',
                display: 'flex',
                gap: '12px',
                fontSize: '11.5px',
                boxShadow: 'var(--shadow-sm)',
                zIndex: 10
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Rendered Entities:</span>
                <strong className="tabular-nums" style={{ color: 'var(--accent-primary)' }}>{allNodesList.length}</strong>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Relationships:</span>
                <strong className="tabular-nums" style={{ color: 'var(--accent-cyan-text)' }}>{allEdgesList.length}</strong>
              </div>
            </div>

            {/* Canvas Zoom & Fit Controls */}
            <div
              style={{
                position: 'absolute',
                bottom: '16px',
                left: '16px',
                display: 'flex',
                gap: '4px',
                background: 'var(--bg-surface-1)',
                padding: '4px',
                borderRadius: '8px',
                border: '1px solid var(--border-subtle)',
                boxShadow: 'var(--shadow-md)',
                zIndex: 10
              }}
            >
              <button
                onClick={() => networkRef.current?.zoomIn?.()}
                className="btn-ghost"
                style={{ padding: '6px' }}
                title="Zoom In"
                aria-label="Zoom in graph"
              >
                <ZoomIn size={15} />
              </button>
              <button
                onClick={() => networkRef.current?.zoomOut?.()}
                className="btn-ghost"
                style={{ padding: '6px' }}
                title="Zoom Out"
                aria-label="Zoom out graph"
              >
                <ZoomOut size={15} />
              </button>
              <button
                onClick={() => networkRef.current?.fit?.({ animation: true })}
                className="btn-ghost"
                style={{ padding: '6px' }}
                title="Fit to Screen"
                aria-label="Fit graph to screen"
              >
                <Maximize2 size={15} />
              </button>
            </div>
          </div>
        )}

        {/* Accessible Table View (WCAG 2.2 AA Compliant) */}
        {viewMode === 'table' && (
          <div className="calm-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
            {/* Table Sub-Tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border-hairline)', background: 'var(--bg-surface-2)', padding: '0 16px' }}>
              <button
                onClick={() => setTableTab('entities')}
                className="btn-ghost"
                style={{
                  borderRadius: 0,
                  padding: '10px 14px',
                  fontSize: '12px',
                  fontWeight: tableTab === 'entities' ? 600 : 500,
                  color: tableTab === 'entities' ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  borderBottom: tableTab === 'entities' ? '2px solid var(--accent-primary)' : '2px solid transparent'
                }}
              >
                Entities ({allNodesList.length})
              </button>

              <button
                onClick={() => setTableTab('relationships')}
                className="btn-ghost"
                style={{
                  borderRadius: 0,
                  padding: '10px 14px',
                  fontSize: '12px',
                  fontWeight: tableTab === 'relationships' ? 600 : 500,
                  color: tableTab === 'relationships' ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  borderBottom: tableTab === 'relationships' ? '2px solid var(--accent-primary)' : '2px solid transparent'
                }}
              >
                Relationships ({allEdgesList.length})
              </button>
            </div>

            {/* Table Body */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {tableTab === 'entities' && (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Entity Name</th>
                      <th>Classification</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allNodesList.map((n, idx) => (
                      <tr key={idx}>
                        <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{n.name}</td>
                        <td>
                          <span className="eyebrow-tag" style={{ fontSize: '10px' }}>
                            {n.type || n.label || 'CONCEPT'}
                          </span>
                        </td>
                        <td>
                          <button
                            onClick={() => handleSelectNeighbor(n.name)}
                            className="btn btn-secondary"
                            style={{ padding: '3px 8px', fontSize: '11px' }}
                          >
                            <Eye size={11} />
                            <span>Inspect</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {tableTab === 'relationships' && (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Source Entity</th>
                      <th>Relationship</th>
                      <th>Target Entity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allEdgesList.map((e, idx) => (
                      <tr key={idx}>
                        <td style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>{e.source}</td>
                        <td>
                          <span style={{ fontSize: '11px', background: 'var(--bg-surface-3)', padding: '2px 8px', borderRadius: '4px' }}>
                            {e.type}
                          </span>
                        </td>
                        <td style={{ fontWeight: 600, color: 'var(--accent-cyan-text)' }}>{e.target}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* Selected Entity / Edge Inspector Panel */}
        {(selectedNode || selectedEdge) && (
          <div
            className="calm-panel"
            style={{
              width: '320px',
              minWidth: '320px',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: 'var(--shadow-md)',
              overflowY: 'auto'
            }}
          >
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-hairline)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.04em' }}>
                {selectedNode ? 'Entity Details' : 'Relationship Triples'}
              </div>
              <button
                onClick={() => {
                  setSelectedNode(null);
                  setSelectedEdge(null);
                  setConnectedEdges([]);
                }}
                className="btn-ghost"
                style={{ padding: '4px' }}
                aria-label="Close inspector"
              >
                <X size={15} />
              </button>
            </div>

            <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {selectedNode && (
                <>
                  <div>
                    <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {selectedNode.label || selectedNode.id}
                    </h3>
                    <div style={{ marginTop: '4px' }}>
                      <span className="eyebrow-tag" style={{ fontSize: '10px' }}>
                        {selectedNode.entityLabel || 'ENTITY'}
                      </span>
                    </div>
                  </div>

                  {/* Connected Relationships */}
                  <div>
                    <div style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                      Connected Triples ({connectedEdges.length}):
                    </div>
                    {connectedEdges.length === 0 ? (
                      <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>No direct connections rendered.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {connectedEdges.map((edge, eIdx) => {
                          const isSource = edge.source === selectedNode.id;
                          const other = isSource ? edge.target : edge.source;
                          return (
                            <button
                              key={eIdx}
                              onClick={() => handleSelectNeighbor(other)}
                              className="btn btn-secondary"
                              style={{
                                width: '100%',
                                justifyContent: 'space-between',
                                padding: '6px 10px',
                                fontSize: '11.5px',
                                textAlign: 'left'
                              }}
                            >
                              <span>{isSource ? `→ ${edge.type}` : `← ${edge.type}`}</span>
                              <strong style={{ color: 'var(--accent-primary)' }}>{other}</strong>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}

              {selectedEdge && (
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                    {selectedEdge.source} &rarr; {selectedEdge.target}
                  </div>
                  <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                    Relationship Type: <strong style={{ color: 'var(--accent-primary)' }}>{selectedEdge.type}</strong>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
