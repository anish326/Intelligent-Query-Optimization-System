import React, { useState } from 'react';
import { CompareResult } from '../types';
import { QUERY_EXAMPLES, QueryExample } from './QueryWorkspace';

interface ComparisonPanelProps {
  baselineSql: string;
  onBaselineSqlChange?: (sql: string) => void;
  candidateSql: string;
  onCandidateSqlChange: (sql: string) => void;
  repetitions: number;
  onRepetitionsChange: (runs: number) => void;
  onCompare: () => void;
  loading: boolean;
  comparison: CompareResult | null;
}

export const ComparisonPanel: React.FC<ComparisonPanelProps> = ({
  baselineSql,
  onBaselineSqlChange,
  candidateSql,
  onCandidateSqlChange,
  repetitions,
  onRepetitionsChange,
  onCompare,
  loading,
  comparison,
}) => {
  const [activePreset, setActivePreset] = useState<string>('subquery-elimination');

  const before = comparison?.before;
  const after = comparison?.after;
  const delta = comparison?.measured_delta_ms;
  const pct = comparison?.measured_percent_change;
  const verdict = comparison?.verdict;
  const status = comparison?.equivalence_status;
  const diffs = comparison?.semantic_differences || [];
  const resultEquiv = comparison?.result_equivalence;
  const uncertainty = comparison?.uncertainty;

  const handleSelectPreset = (example: QueryExample) => {
    setActivePreset(example.id);
    if (onBaselineSqlChange) {
      onBaselineSqlChange(example.sql);
    }
    if (example.comparisonSql) {
      onCandidateSqlChange(example.comparisonSql);
    }
  };

  const handleSwapQueries = () => {
    if (onBaselineSqlChange) {
      const temp = baselineSql;
      onBaselineSqlChange(candidateSql);
      onCandidateSqlChange(temp);
    }
  };

  return (
    <div className="card comparison-workbench-card">
      {/* Page Header */}
      <div className="comparison-header">
        <div>
          <h2 className="card-title">
            Compare SQL Query Rewrites
          </h2>
          <p className="card-subtitle">
            Controlled interleaved benchmarking measuring latency deltas, result equivalence, and paired bootstrap confidence intervals.
          </p>
        </div>

        <div className="comparison-actions-group">
          <div className="field-group-inline">
            <label htmlFor="comp-repetitions">Runs per query:</label>
            <select
              id="comp-repetitions"
              className="select-input"
              value={repetitions}
              onChange={(e) => onRepetitionsChange(Number(e.target.value))}
              disabled={loading}
            >
              <option value={3}>3 paired runs</option>
              <option value={5}>5 paired runs</option>
              <option value={10}>10 paired runs</option>
              <option value={20}>20 paired runs</option>
              <option value={30}>30 paired runs (Rigorous)</option>
              <option value={50}>50 paired runs</option>
            </select>
          </div>

          <button
            type="button"
            className="btn btn-primary"
            onClick={onCompare}
            disabled={loading || !baselineSql.trim() || !candidateSql.trim()}
          >
            {loading ? (
              <span className="loading-content">
                <span className="spinner"></span> Measuring Interleaved Pairs...
              </span>
            ) : (
              'Run Benchmark Comparison'
            )}
          </button>
        </div>
      </div>

      {/* Comparison Presets Toolbar (Theme Coherence with QueryWorkspace) */}
      <div className="sample-queries-bar">
        <span className="sample-label">Comparison Presets:</span>
        {QUERY_EXAMPLES.map((ex) => (
          <button
            key={ex.id}
            type="button"
            className={`sample-btn ${activePreset === ex.id ? 'active' : ''}`}
            onClick={() => handleSelectPreset(ex)}
            title={ex.description}
          >
            {ex.name.split(' (')[0]}
          </button>
        ))}
      </div>

      {/* Two-Column Side-by-Side SQL Editors */}
      <div className="comparison-editors-grid">
        {/* Left Column: Baseline Editor */}
        <div className="editor-pane">
          <div className="pane-header">
            <div className="pane-title-group">
              <span className="pane-title baseline-title">Baseline Query</span>
              <span className="badge-tag">ORIGINAL SQL</span>
            </div>
            <span className="pane-sub">
              {baselineSql.split('\n').length} lines &bull; {baselineSql.length} chars
            </span>
          </div>

          {onBaselineSqlChange ? (
            <textarea
              className="pane-textarea"
              aria-label="Baseline SQL Query"
              value={baselineSql}
              onChange={(e) => onBaselineSqlChange(e.target.value)}
              placeholder="Enter baseline SQL query..."
              spellCheck={false}
              disabled={loading}
              rows={8}
            />
          ) : (
            <div className="compare-sql-preview">
              <pre className="sql-code-block">{baselineSql || '-- No baseline query entered'}</pre>
            </div>
          )}
        </div>

        {/* Right Column: Candidate Editor */}
        <div className="editor-pane">
          <div className="pane-header">
            <div className="pane-title-group">
              <span className="pane-title candidate-title">Rewrite Candidate</span>
              <span className="badge-tag badge-revised">OPTIMIZED CANDIDATE</span>
            </div>
            <span className="pane-sub">
              {candidateSql.split('\n').length} lines &bull; {candidateSql.length} chars
            </span>
          </div>

          <textarea
            className="pane-textarea"
            aria-label="Revised SQL Query"
            value={candidateSql}
            onChange={(e) => onCandidateSqlChange(e.target.value)}
            placeholder="Enter rewritten or optimized SQL query..."
            spellCheck={false}
            disabled={loading}
            rows={8}
          />
        </div>
      </div>

      {/* Action Sub-Bar */}
      <div className="comparison-editor-actions-bar">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={handleSwapQueries}
          disabled={loading || !baselineSql.trim() || !candidateSql.trim()}
          title="Swap baseline and candidate queries"
        >
          Swap Queries
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => onCandidateSqlChange('')}
          disabled={loading || !candidateSql.trim()}
        >
          Clear Candidate
        </button>
      </div>

      {/* Comparison Benchmark Results */}
      {comparison && before && after && delta != null ? (
        <div className="comparison-results-box">
          <div className="results-header-row">
            <h3 className="results-title">
              Benchmark Comparison Results &bull; {repetitions} Interleaved Pairs
            </h3>
            <span className={`badge-pill badge-verdict-${verdict?.toLowerCase()}`}>
              Verdict: {verdict}
            </span>
          </div>

          {/* Equivalence Status Banner */}
          <div className={`status-banner banner-${status?.toLowerCase()}`}>
            <div className="banner-header-row">
              <span className="banner-title">
                {status === 'VERIFIED_EQUIVALENT' && 'SEMANTIC EQUIVALENCE VERIFIED'}
                {status === 'SEMANTIC_DIFFERENCE_DETECTED' && 'SEMANTIC DIFFERENCES DETECTED'}
                {status === 'DIFFERENT_RESULTS' && 'DIFFERENT QUERY RESULTS'}
                {status === 'EQUIVALENCE_UNVERIFIED' && 'EQUIVALENCE UNVERIFIED'}
              </span>
              <span className="badge-status-code">{status}</span>
            </div>
            <p className="banner-text">
              {resultEquiv?.message || 'Result equivalence analysis complete.'}
            </p>

            {diffs.length > 0 && (
              <div className="diffs-list-box">
                <span className="diffs-list-title">Detected Structural AST Differences:</span>
                <ul>
                  {diffs.map((d, idx) => (
                    <li key={idx}>{d}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* 4-Card Comparative Metrics Grid (Matching MetricsPanel.tsx) */}
          <div className="metrics-grid">
            {/* Tile 1: Baseline Median */}
            <div className="metric-tile">
              <div className="metric-tile-header">
                <span className="metric-label">Baseline Median</span>
                <span className="metric-tag tag-measured">ORIGINAL</span>
              </div>
              <div className="metric-value-row">
                <span className="metric-big-num">{before.measured_runtime_ms.toFixed(3)}</span>
                <span className="metric-unit">ms</span>
              </div>
              <span className="metric-caption">
                IQR: {before.iqr_ms != null ? `${before.iqr_ms.toFixed(2)} ms` : 'N/A'} &bull; P95: {before.p95_runtime_ms.toFixed(2)} ms
              </span>
            </div>

            {/* Tile 2: Rewrite Candidate Median */}
            <div className="metric-tile metric-primary">
              <div className="metric-tile-header">
                <span className="metric-label">Rewritten Median</span>
                <span className="metric-tag tag-measured">CANDIDATE</span>
              </div>
              <div className="metric-value-row">
                <span className="metric-big-num">{after.measured_runtime_ms.toFixed(3)}</span>
                <span className="metric-unit">ms</span>
              </div>
              <span className="metric-caption">
                IQR: {after.iqr_ms != null ? `${after.iqr_ms.toFixed(2)} ms` : 'N/A'} &bull; P95: {after.p95_runtime_ms.toFixed(2)} ms
              </span>
            </div>

            {/* Tile 3: Latency Difference (Delta) */}
            <div className="metric-tile">
              <div className="metric-tile-header">
                <span className="metric-label">Latency Delta</span>
                <span className={`metric-tag ${delta < 0 ? 'tag-faster' : delta > 0 ? 'tag-slower' : ''}`}>
                  {pct != null ? `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%` : 'DELTA'}
                </span>
              </div>
              <div className="metric-value-row">
                <span className={`metric-big-num ${delta < 0 ? 'text-mint' : delta > 0 ? 'text-amber' : ''}`}>
                  {delta > 0 ? `+${delta.toFixed(3)}` : delta.toFixed(3)}
                </span>
                <span className="metric-unit">ms</span>
              </div>
              <span className="metric-caption">
                {delta < 0
                  ? `${Math.abs(delta).toFixed(3)} ms faster execution`
                  : delta > 0
                  ? `${delta.toFixed(3)} ms slower execution`
                  : 'Zero latency difference'}
              </span>
            </div>

            {/* Tile 4: Empirical Verdict */}
            <div className="metric-tile">
              <div className="metric-tile-header">
                <span className="metric-label">Empirical Verdict</span>
                <span className={`verdict-badge verdict-${verdict?.toLowerCase()}`}>
                  {verdict}
                </span>
              </div>
              <div className="metric-value-row">
                <span className="metric-big-num" style={{ fontSize: '1.25rem' }}>
                  {verdict === 'FASTER' && 'FASTER'}
                  {verdict === 'SLOWER' && 'SLOWER'}
                  {verdict === 'INCONCLUSIVE' && 'INCONCLUSIVE'}
                  {verdict === 'SEMANTIC_MISMATCH' && 'MISMATCH'}
                </span>
              </div>
              {uncertainty && (
                <span className="metric-caption" title="Paired bootstrap 95% confidence interval">
                  95% CI: [{uncertainty.ci_lower_ms.toFixed(2)}, {uncertainty.ci_upper_ms.toFixed(2)}] ms
                </span>
              )}
            </div>
          </div>

          {/* Diagnostic Telemetry Table */}
          <div className="baseline-comparison-box">
            <div className="baseline-header-row">
              <div>
                <span className="baseline-title-tag">DETAILED BENCHMARK TELEMETRY</span>
                <h4 className="baseline-subheading">
                  Side-by-Side Execution &amp; Buffer Breakdown
                </h4>
              </div>
            </div>

            <div className="baseline-metrics-table-wrapper">
              <table className="baseline-table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Baseline Query</th>
                    <th>Candidate Query</th>
                    <th>Performance Delta</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <strong>Median Execution Runtime</strong>
                      <span className="table-caption">Primary benchmark latency metric</span>
                    </td>
                    <td className="metric-baseline">{before.measured_runtime_ms.toFixed(3)} ms</td>
                    <td className="metric-model">{after.measured_runtime_ms.toFixed(3)} ms</td>
                    <td className={`metric-diff ${delta < 0 ? 'text-mint' : delta > 0 ? 'text-amber' : ''}`}>
                      {delta > 0 ? `+${delta.toFixed(3)}` : delta.toFixed(3)} ms ({pct != null ? `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%` : 'N/A'})
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <strong>Tail Latency (95th Percentile)</strong>
                      <span className="table-caption">Worst-case outlier execution time</span>
                    </td>
                    <td className="metric-baseline">{before.p95_runtime_ms.toFixed(3)} ms</td>
                    <td className="metric-model">{after.p95_runtime_ms.toFixed(3)} ms</td>
                    <td className="metric-diff">
                      {(after.p95_runtime_ms - before.p95_runtime_ms).toFixed(3)} ms
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <strong>Planning Time</strong>
                      <span className="table-caption">PostgreSQL optimizer cost estimation</span>
                    </td>
                    <td className="metric-baseline">
                      {before.metrics?.planning_ms != null ? `${Number(before.metrics.planning_ms).toFixed(3)} ms` : 'N/A'}
                    </td>
                    <td className="metric-model">
                      {after.metrics?.planning_ms != null ? `${Number(after.metrics.planning_ms).toFixed(3)} ms` : 'N/A'}
                    </td>
                    <td className="metric-diff">
                      {before.metrics?.planning_ms != null && after.metrics?.planning_ms != null
                        ? `${(Number(after.metrics.planning_ms) - Number(before.metrics.planning_ms)).toFixed(3)} ms`
                        : 'N/A'}
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <strong>Shared RAM Buffer Hits</strong>
                      <span className="table-caption">Pages retrieved from PostgreSQL buffer pool</span>
                    </td>
                    <td className="metric-baseline">{before.metrics?.shared_hit_blocks ?? 0} blocks</td>
                    <td className="metric-model">{after.metrics?.shared_hit_blocks ?? 0} blocks</td>
                    <td className="metric-diff">
                      {((after.metrics?.shared_hit_blocks ?? 0) - (before.metrics?.shared_hit_blocks ?? 0))} blocks
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <strong>Shared Disk Buffer Reads</strong>
                      <span className="table-caption">Physical disk reads from storage subsystem</span>
                    </td>
                    <td className="metric-baseline">{before.metrics?.shared_read_blocks ?? 0} blocks</td>
                    <td className="metric-model">{after.metrics?.shared_read_blocks ?? 0} blocks</td>
                    <td className="metric-diff">
                      {((after.metrics?.shared_read_blocks ?? 0) - (before.metrics?.shared_read_blocks ?? 0))} blocks
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <strong>ML Model Forecast</strong>
                      <span className="table-caption">Random Forest runtime regression point estimate</span>
                    </td>
                    <td className="metric-baseline">
                      {before.prediction ? `${before.prediction.runtime_ms.toFixed(2)} ms` : 'N/A'}
                    </td>
                    <td className="metric-model">
                      {after.prediction ? `${after.prediction.runtime_ms.toFixed(2)} ms` : 'N/A'}
                    </td>
                    <td className="metric-diff">
                      {before.prediction && after.prediction
                        ? `${(after.prediction.runtime_ms - before.prediction.runtime_ms).toFixed(2)} ms`
                        : 'N/A'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="recommendations-footer-disclaimer">
            <em>Benchmarking Protocol:</em> {comparison.measurement_note}
          </div>
        </div>
      ) : (
        <div className="metrics-empty-state comparison-empty-state">
          <h3 className="empty-title">Ready to Compare SQL Rewrites</h3>
          <p className="empty-desc">
            Choose a comparison preset or enter two SQL statements above. The engine executes interleaved runs against PostgreSQL, verifies multiset result equivalence, and computes paired bootstrap confidence intervals.
          </p>

          <div className="empty-steps-list">
            <div className="empty-step-item">
              <span className="step-num">1</span>
              <div className="step-content">
                <strong>Pick or Enter Queries</strong>
                <span>Set the original baseline SQL and your candidate optimized query.</span>
              </div>
            </div>
            <div className="empty-step-item">
              <span className="step-num">2</span>
              <div className="step-content">
                <strong>Run Interleaved Benchmarks</strong>
                <span>Executes alternating runs to isolate buffer cache warming and CPU fluctuations.</span>
              </div>
            </div>
            <div className="empty-step-item">
              <span className="step-num">3</span>
              <div className="step-content">
                <strong>Inspect Equivalence &amp; Speedup</strong>
                <span>Review verified multiset equivalence, latency delta, and bootstrap confidence intervals.</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
