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
  filter?: string;
  indexCond?: string;
  hashCond?: string;
  sortKey?: string[];
  sortMethod?: string;
  sortSpaceType?: string;
  sortSpaceUsed?: number;
  isExpensive: boolean;
  expensiveReason?: string;
  explanation: string;
}

function getNodeExplanation(nodeType: string, relationName?: string): string {
  switch (nodeType) {
    case 'Seq Scan':
      return relationName
        ? `Sequentially scans every page of '${relationName}'. Scales O(N); ideal for small tables or when fetching a large fraction of the table.`
        : 'Sequential table scan traversing all physical pages from start to finish.';
    case 'Index Scan':
      return 'Traverses a B-tree index to locate matching row pointers, then fetches corresponding heap data pages.';
    case 'Index Only Scan':
      return 'Answers the query directly from the B-tree index without touching physical table heap pages, minimizing disk I/O.';
    case 'Bitmap Heap Scan':
      return 'Reads table pages using a bitmap constructed from index scans, clustering random reads into sequential block access.';
    case 'Bitmap Index Scan':
      return 'Scans index and constructs a bitmap of physical page locations matching the search predicates.';
    case 'Hash Join':
      return 'Constructs an in-memory hash table on the inner relation, then probes it with each tuple from the outer relation.';
    case 'Merge Join':
      return 'Merges two pre-sorted relation streams in lockstep. Highly efficient when data is already ordered by index.';
    case 'Nested Loop':
      return 'Iterates through the outer relation and executes the inner plan for every outer row. Fast with indexed inner lookups, but can degrade with high row counts.';
    case 'Sort':
      return 'Orders rows in memory or spills to temporary disk storage if dataset exceeds configured work_mem.';
    case 'Aggregate':
    case 'HashAggregate':
      return 'Groups rows together and computes aggregate mathematical functions (COUNT, SUM, AVG, MIN, MAX).';
    case 'Limit':
      return 'Truncates the output stream once the specified row threshold is satisfied, enabling early plan termination.';
    default:
      return 'PostgreSQL relational algebra execution node processing intermediate tuple streams.';
  }
}

export const PlanDetails: React.FC<PlanDetailsProps> = ({
  plan,
  onCopySuccess,
  onNavigateToAnalyzer,
}) => {
  const [activeTab, setActiveTab] = useState<'tree' | 'raw'>('tree');
  const [copying, setCopying] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});

  const toggleExpand = (id: string) => {
    setExpandedNodes(prev => ({ ...prev, [id]: !prev[id] }));
  };

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
  const rootTotalCost = Number(rootNode?.['Total Cost'] ?? 0);
  const rootActualTime = Number(rootNode?.['Actual Total Time'] ?? 0);

  const traverse = (node: any, depth = 0, prefix = 'node') => {
    if (!node) return;
    const nodeId = `${prefix}-${flattenedNodes.length}`;
    const nodeType = node['Node Type'] || 'Unknown Node';
    const totalCost = Number(node['Total Cost'] ?? 0);
    const actualTime = node['Actual Total Time'] != null ? Number(node['Actual Total Time']) : undefined;
    const actualRows = node['Actual Rows'] != null ? Number(node['Actual Rows']) : undefined;
    const planRows = Number(node['Plan Rows'] ?? 0);
    const relationName = node['Relation Name'];

    // Expensive operation heuristics
    let isExpensive = false;
    let expensiveReason: string | undefined;

    if (rootActualTime > 0 && actualTime != null && (actualTime / rootActualTime) >= 0.40) {
      isExpensive = true;
      expensiveReason = `Consumes ${( (actualTime / rootActualTime) * 100 ).toFixed(1)}% of total query execution runtime (${actualTime.toFixed(2)} ms)`;
    } else if (rootTotalCost > 10 && (totalCost / rootTotalCost) >= 0.45) {
      isExpensive = true;
      expensiveReason = `Represents ${( (totalCost / rootTotalCost) * 100 ).toFixed(1)}% of overall optimizer cost estimate`;
    } else if (nodeType === 'Seq Scan' && (actualRows ?? planRows) > 100) {
      isExpensive = true;
      expensiveReason = `Full sequential scan on '${relationName || 'table'}' processing ${(actualRows ?? planRows).toLocaleString()} rows`;
    } else if (node['Sort Space Type'] === 'Disk') {
      isExpensive = true;
      expensiveReason = `Spilled to disk (${node['Sort Space Used'] ?? 0} kB) exceeding work_mem`;
    }

    flattenedNodes.push({
      id: nodeId,
      depth,
      nodeType,
      relationName,
      alias: node['Alias'],
      startupCost: Number(node['Startup Cost'] ?? 0),
      totalCost,
      planRows,
      actualRows,
      actualLoops: node['Actual Loops'] != null ? Number(node['Actual Loops']) : undefined,
      actualTime,
      sharedHitBlocks: node['Shared Hit Blocks'] != null ? Number(node['Shared Hit Blocks']) : undefined,
      sharedReadBlocks: node['Shared Read Blocks'] != null ? Number(node['Shared Read Blocks']) : undefined,
      hasChildren: Array.isArray(node.Plans) && node.Plans.length > 0,
      filter: node['Filter'],
      indexCond: node['Index Cond'],
      hashCond: node['Hash Cond'],
      sortKey: node['Sort Key'],
      sortMethod: node['Sort Method'],
      sortSpaceType: node['Sort Space Type'],
      sortSpaceUsed: node['Sort Space Used'] != null ? Number(node['Sort Space Used']) : undefined,
      isExpensive,
      expensiveReason,
      explanation: getNodeExplanation(nodeType, relationName),
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

  const expensiveCount = flattenedNodes.filter(n => n.isExpensive).length;

  return (
    <div className="card plan-details-card">
      <div className="plan-details-header">
        <div>
          <h2 className="card-title">
            Visual PostgreSQL Execution Plan Hierarchy
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
            {expensiveCount > 0 && (
              <span className="legend-chip chip-expensive-tag">
                {expensiveCount} Bottleneck Node{expensiveCount > 1 ? 's' : ''} Flagged
              </span>
            )}
          </div>

          <div className="plan-nodes-list">
            {flattenedNodes.map((node) => {
              const isExpanded = !!expandedNodes[node.id];

              return (
                <div
                  key={node.id}
                  className={`plan-node-card ${node.isExpensive ? 'node-expensive-highlight' : ''}`}
                  style={{ marginLeft: `${node.depth * 24}px` }}
                >
                  <div className="node-indicator-line" style={{ left: `-${node.depth * 16}px` }}></div>
                  <div className="node-header-row">
                    <div className="node-title-area">
                      <span className="node-type-badge">
                        {node.nodeType}
                        {node.relationName && (
                          <span className="node-rel-name"> on <code>{node.relationName}</code></span>
                        )}
                        {node.alias && node.alias !== node.relationName && (
                          <span className="node-alias"> as {node.alias}</span>
                        )}
                      </span>

                      {node.isExpensive && (
                        <span className="badge-expensive-pill" title={node.expensiveReason}>
                          POTENTIAL BOTTLENECK
                        </span>
                      )}
                    </div>

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
                          {node.actualLoops && node.actualLoops > 1 ? ` (x${node.actualLoops})` : ''}
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

                  {/* Plan Explanation & Bottleneck Alert */}
                  <div className="node-explanation-box">
                    <p className="node-explanation-text">
                      <strong>Operation:</strong> {node.explanation}
                    </p>
                    {node.isExpensive && node.expensiveReason && (
                      <div className="node-bottleneck-alert">
                        <strong>Identified Bottleneck:</strong> {node.expensiveReason}
                      </div>
                    )}

                    {(node.filter || node.indexCond || node.hashCond || (node.sortKey && node.sortKey.length > 0)) && (
                      <div className="node-conditions-list">
                        {node.filter && (
                          <div className="node-cond-item">
                            <span className="cond-tag">Filter:</span> <code>{node.filter}</code>
                          </div>
                        )}
                        {node.indexCond && (
                          <div className="node-cond-item">
                            <span className="cond-tag">Index Cond:</span> <code>{node.indexCond}</code>
                          </div>
                        )}
                        {node.hashCond && (
                          <div className="node-cond-item">
                            <span className="cond-tag">Hash Cond:</span> <code>{node.hashCond}</code>
                          </div>
                        )}
                        {node.sortKey && node.sortKey.length > 0 && (
                          <div className="node-cond-item">
                            <span className="cond-tag">Sort Key:</span> <code>{node.sortKey.join(', ')}</code>
                            {node.sortMethod && <span className="sort-method"> ({node.sortMethod})</span>}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
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
