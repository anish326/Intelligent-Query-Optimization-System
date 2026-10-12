import React, { useState } from 'react';

interface PlanDetailsProps {
  plan: Record<string, unknown> | null;
  onCopySuccess: () => void;
  onNavigateToAnalyzer?: () => void;
}

interface FlattenedPlanNode {
  id: string;
  depth: number;
  nodeType: string;
  relationName?: string;
  alias?: string;
  startupCost: number;
  totalCost: number;
  planRows: number;
  actualRows?: number;
  actualLoops?: number;
  actualTime?: number;
  sharedHitBlocks?: number;
  sharedReadBlocks?: number;
  hasChildren: boolean;
}

export const PlanDetails: React.FC<PlanDetailsProps> = ({
  plan,
  onCopySuccess,
  onNavigateToAnalyzer,
}) => {
  const [activeTab, setActiveTab] = useState<'tree' | 'raw'>('tree');
  const [copying, setCopying] = useState(false);

  if (!plan || Object.keys(plan).length === 0) {
    return (
      <div className="card plan-details-card empty-plan-box">
        <h2 className="card-title">
          Execution Plan Details
        </h2>
        <div className="tab-empty-prompt">
          <h3>No Execution Plan Available Yet</h3>
          <p>
            Analyze a query in the Query Analyzer tab to capture the actual PostgreSQL <code>EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)</code> hierarchy.
          </p>
          {onNavigateToAnalyzer && (
            <button type="button" className="btn btn-primary" onClick={onNavigateToAnalyzer}>
              Go to Query Analyzer
            </button>
          )}
        </div>
      </div>
    );
  }

  // Flatten the recursive plan tree
  const flattenedNodes: FlattenedPlanNode[] = [];
  const rootNode = (plan as any).Plan;

  const traverse = (node: any, depth = 0, prefix = 'node') => {
    if (!node) return;
    const nodeId = `${prefix}-${flattenedNodes.length}`;
    flattenedNodes.push({
      id: nodeId,
      depth,
      nodeType: node['Node Type'] || 'Unknown Node',
      relationName: node['Relation Name'],
      alias: node['Alias'],
      startupCost: Number(node['Startup Cost'] ?? 0),
      totalCost: Number(node['Total Cost'] ?? 0),
      planRows: Number(node['Plan Rows'] ?? 0),
      actualRows: node['Actual Rows'] != null ? Number(node['Actual Rows']) : undefined,
      actualLoops: node['Actual Loops'] != null ? Number(node['Actual Loops']) : undefined,
      actualTime: node['Actual Total Time'] != null ? Number(node['Actual Total Time']) : undefined,
      sharedHitBlocks: node['Shared Hit Blocks'] != null ? Number(node['Shared Hit Blocks']) : undefined,
      sharedReadBlocks: node['Shared Read Blocks'] != null ? Number(node['Shared Read Blocks']) : undefined,
      hasChildren: Array.isArray(node.Plans) && node.Plans.length > 0,
    });

    if (Array.isArray(node.Plans)) {
      node.Plans.forEach((child: any, cIdx: number) => {
        traverse(child, depth + 1, `${nodeId}-${cIdx}`);
      });
    }
  };

  if (rootNode) {
    traverse(rootNode, 0);
  }

  const handleCopyJson = async () => {
    try {
      setCopying(true);
      await navigator.clipboard.writeText(JSON.stringify(plan, null, 2));
      onCopySuccess();
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = JSON.stringify(plan, null, 2);
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      onCopySuccess();
    } finally {
      setTimeout(() => setCopying(false), 1200);
    }
  };

  return (
    <div className="card plan-details-card">
      <div className="plan-details-header">
        <div>
          <h2 className="card-title">
            Execution Plan Hierarchy &amp; JSON
          </h2>
          <p className="card-subtitle">
            Inspect the PostgreSQL optimizer cost model vs. actual buffer hits and row counts measured by <code>EXPLAIN (ANALYZE, BUFFERS)</code>.
          </p>
        </div>

        <div className="plan-header-actions">
          <div className="plan-view-tabs">
            <button
              type="button"
              className={`plan-tab-btn ${activeTab === 'tree' ? 'active' : ''}`}
              onClick={() => setActiveTab('tree')}
            >
              Visual Plan Nodes ({flattenedNodes.length})
            </button>
            <button
              type="button"
              className={`plan-tab-btn ${activeTab === 'raw' ? 'active' : ''}`}
              onClick={() => setActiveTab('raw')}
            >
              Raw Plan JSON
            </button>
          </div>

          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={handleCopyJson}
            title="Copy plan JSON to clipboard"
          >
            {copying ? 'Copied!' : 'Copy JSON'}
          </button>
        </div>
      </div>

      {activeTab === 'tree' ? (
        <div className="plan-tree-container">
          <div className="tree-legend-bar">
            <span className="legend-chip chip-cost">EST: Cost (Startup..Total)</span>
            <span className="legend-chip chip-est-rows">EST: Plan Rows</span>
            <span className="legend-chip chip-act-rows">ACTUAL: Measured Rows</span>
            <span className="legend-chip chip-act-time">ACTUAL: Execution Time (ms)</span>
          </div>

          <div className="plan-nodes-list">
            {flattenedNodes.map((node) => (
              <div
                key={node.id}
                className="plan-node-card"
                style={{ marginLeft: `${node.depth * 24}px` }}
              >
                <div className="node-indicator-line" style={{ left: `-${node.depth * 16}px` }}></div>
                <div className="node-header-row">
                  <span className="node-type-badge">
                    {node.nodeType}
                    {node.relationName && (
                      <span className="node-rel-name"> on <code>{node.relationName}</code></span>
                    )}
                    {node.alias && node.alias !== node.relationName && (
                      <span className="node-alias"> as {node.alias}</span>
                    )}
                  </span>

                  <div className="node-badges-group">
                    <span className="badge-pill badge-cost" title="Estimated Optimizer Cost">
                      Cost: {node.startupCost.toFixed(1)}..{node.totalCost.toFixed(1)}
                    </span>
                    <span className="badge-pill badge-est-rows" title="Estimated Rows from Statistics">
                      Est: {node.planRows.toLocaleString()} rows
                    </span>
                    {node.actualRows != null && (
                      <span className="badge-pill badge-act-rows" title="Actual Measured Rows">
                        Act: {node.actualRows.toLocaleString()} rows
                        {node.actualLoops && node.actualLoops > 1 ? ` (×${node.actualLoops})` : ''}
                      </span>
                    )}
                    {node.actualTime != null && (
                      <span className="badge-pill badge-act-time" title="Actual Execution Time">
                        Time: {node.actualTime.toFixed(3)} ms
                      </span>
                    )}
                    {node.sharedHitBlocks != null && (
                      <span className="badge-pill badge-io" title="Shared RAM Buffer Hits">
                        Hit: {node.sharedHitBlocks} blks
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="raw-json-viewer-container">
          <pre className="raw-json-block">{JSON.stringify(plan, null, 2)}</pre>
        </div>
      )}
    </div>
  );
};
