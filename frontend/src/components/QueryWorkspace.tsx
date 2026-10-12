import React, { useState } from 'react';
import { DatabaseOption } from '../types';

export interface QueryExample {
  id: string;
  name: string;
  description: string;
  sql: string;
  comparisonSql?: string;
}

export const QUERY_EXAMPLES: QueryExample[] = [
  {
    id: 'subquery-elimination',
    name: 'Subquery Elimination Rewrite (Semantically Equivalent)',
    description: 'Eliminates redundant IN (SELECT customer_id ...) subquery by rewriting to direct customer_id equality. Produces verified identical 7 rows.',
    sql: `SELECT o.id, o.customer_id, o.total\nFROM orders o\nWHERE o.customer_id IN (SELECT c.id FROM customers c WHERE c.id = 42);`,
    comparisonSql: `SELECT o.id, o.customer_id, o.total\nFROM orders o\nWHERE o.customer_id = 42;`,
  },
  {
    id: 'cheat-limit-reduction',
    name: 'Non-Equivalent LIMIT Reduction (Fairness Detection Test)',
    description: 'Demonstrates the fair benchmark engine detecting and flagging a query rewrite that truncates rows via LIMIT rather than optimizing execution.',
    sql: `SELECT * FROM orders\nWHERE status = 'pending'\nORDER BY total DESC\nLIMIT 50;`,
    comparisonSql: `SELECT * FROM orders\nWHERE status = 'pending'\nORDER BY total DESC\nLIMIT 10;`,
  },
  {
    id: 'region-agg',
    name: 'Customer Orders by Region (Hash Join + Aggregate)',
    description: 'Aggregates 30k orders with customer geographic regions using an inner join.',
    sql: `SELECT c.region, count(*) AS total_orders, sum(o.total) AS revenue\nFROM customers c\nJOIN orders o ON o.customer_id = c.id\nWHERE o.status = 'paid'\nGROUP BY c.region\nORDER BY revenue DESC;`,
    comparisonSql: `SELECT c.region, count(*) AS total_orders, sum(o.total) AS revenue\nFROM customers c\nJOIN orders o ON o.customer_id = c.id\nWHERE o.status = 'paid'\nGROUP BY c.region\nORDER BY revenue DESC;`,
  },
  {
    id: 'cte-window',
    name: 'CTE Regional Spend Breakdown (WITH ... SELECT)',
    description: 'Uses a Common Table Expression to pre-filter paid customers before aggregation.',
    sql: `WITH regional_paid AS (\n  SELECT c.region, o.total\n  FROM customers c\n  JOIN orders o ON o.customer_id = c.id\n  WHERE o.status = 'paid'\n)\nSELECT region, avg(total) AS avg_ticket, count(*) AS count\nFROM regional_paid\nGROUP BY region;`,
    comparisonSql: `WITH regional_paid AS (\n  SELECT c.region, o.total\n  FROM customers c\n  JOIN orders o ON o.customer_id = c.id\n  WHERE o.status = 'paid'\n)\nSELECT region, avg(total) AS avg_ticket, count(*) AS count\nFROM regional_paid\nGROUP BY region;`,
  },
];

interface QueryWorkspaceProps {
  databases: DatabaseOption[];
  selectedDb: string;
  onSelectDb: (id: string) => void;
  sql: string;
  onSqlChange: (sql: string) => void;
  repetitions: number;
  onRepetitionsChange: (runs: number) => void;
  onAnalyze: () => void;
  loading: boolean;
  loadingStage?: string;
  error: string | null;
  onClearError: () => void;
  onOpenCompare: () => void;
}

export const QueryWorkspace: React.FC<QueryWorkspaceProps> = ({
  databases,
  selectedDb,
  onSelectDb,
  sql,
  onSqlChange,
  repetitions,
  onRepetitionsChange,
  onAnalyze,
  loading,
  loadingStage,
  error,
  onClearError,
  onOpenCompare,
}) => {
  const [selectedExample, setSelectedExample] = useState<string>('region-agg');
  const lineNumbers = sql.split('\n').map((_, i) => i + 1);

  const handleLoadExample = (exampleId: string) => {
    setSelectedExample(exampleId);
    const found = QUERY_EXAMPLES.find((e) => e.id === exampleId);
    if (found) {
      onSqlChange(found.sql);
      onClearError();
    }
  };

  const handleClear = () => {
    onSqlChange('');
    onClearError();
  };

  return (
    <div className="card query-workspace-card">
      <div className="workspace-header">
        <div className="workspace-title-row">
          <h2 className="card-title">
            SQL Query Editor
          </h2>
          <div className="workspace-controls-bar">
            {/* Database Selector */}
            <div className="field-group-inline">
              <label htmlFor="db-select">DB:</label>
              <select
                id="db-select"
                className="select-input"
                value={selectedDb}
                onChange={(e) => onSelectDb(e.target.value)}
                disabled={databases.length <= 1}
              >
                {databases.length > 0 ? (
                  databases.map((db) => (
                    <option key={db.id} value={db.id}>
                      {db.label || db.id}
                    </option>
                  ))
                ) : (
                  <option value="queryopt">queryopt (PostgreSQL 16)</option>
                )}
              </select>
            </div>

            {/* Repetitions Selector */}
            <div className="field-group-inline">
              <label htmlFor="repetitions-select" title="Number of EXPLAIN ANALYZE runs executed after 1 warm-up run">
                Runs:
              </label>
              <select
                id="repetitions-select"
                className="select-input"
                value={repetitions}
                onChange={(e) => onRepetitionsChange(Number(e.target.value))}
                disabled={loading}
              >
                <option value={3}>3 runs</option>
                <option value={5}>5 runs (Recommended)</option>
                <option value={7}>7 runs</option>
                <option value={10}>10 runs</option>
              </select>
            </div>
          </div>
        </div>

        {/* Examples Picker & Quick Actions */}
        <div className="example-selector-row">
          <div className="example-dropdown-group">
            <span className="selector-label">Template:</span>
            <select
              className="select-input example-select"
              value={selectedExample}
              onChange={(e) => handleLoadExample(e.target.value)}
            >
              {QUERY_EXAMPLES.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => handleLoadExample(selectedExample)}
              title="Reset query to this example"
            >
              ↺ Reset
            </button>
          </div>

          <div className="editor-quick-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={handleClear}
              disabled={loading || !sql}
              title="Clear SQL Editor"
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      {/* Baseline SQL Editor with Line Numbers */}
      <div className="sql-editor-container">
        <div className="editor-header">
          <span className="editor-tab active-tab">
            <span className="tab-dot"></span> Read-Only SELECT / CTE Query
          </span>
          <span className="editor-hint">AST validated via sqlglot</span>
        </div>

        <div className="code-editor-wrapper">
          <div className="gutter" aria-hidden="true">
            {lineNumbers.map((num) => (
              <span key={num} className="line-number">
                {num}
              </span>
            ))}
          </div>
          <textarea
            className="sql-textarea"
            aria-label="Baseline SQL Query"
            value={sql}
            onChange={(e) => onSqlChange(e.target.value)}
            placeholder="Enter read-only SELECT or WITH statement..."
            spellCheck={false}
            disabled={loading}
          />
        </div>
      </div>

      {/* Validation / Execution Error Banner */}
      {error && (
        <div className="error-banner" role="alert">
          <div className="error-text">
            <strong>Query Validation / Execution Error:</strong> {error}
          </div>
          <button className="error-dismiss" onClick={onClearError} aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}

      {/* Primary Actions Bar */}
      <div className="workspace-footer">
        <div className="execution-notes">
          <span className="note-badge">1 Warmup + {repetitions} Repetitions</span>
          <span className="note-text">
            Read-only transaction &bull; Timeout 5000ms
          </span>
        </div>

        <div className="primary-actions-group">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onOpenCompare}
            title="Open side-by-side comparison bench"
          >
            Compare Rewrites
          </button>

          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={onAnalyze}
            disabled={loading || !sql.trim()}
          >
            {loading ? (
              <span className="loading-content">
                <span className="spinner"></span> {loadingStage || 'Measuring...'}
              </span>
            ) : (
              <span>Measure &amp; Analyze</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
