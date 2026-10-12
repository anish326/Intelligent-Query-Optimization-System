import React from 'react';
import { CompareResult } from '../types';

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
  const before = comparison?.before;
  const after = comparison?.after;
  const delta = comparison?.measured_delta_ms;
  const pct = comparison?.measured_percent_change;
  const verdict = comparison?.verdict;
  const status = comparison?.equivalence_status;
  const diffs = comparison?.semantic_differences || [];
  const resultEquiv = comparison?.result_equivalence;
  const uncertainty = comparison?.uncertainty;

  return (
    <div className="card comparison-card">
      <div className="comparison-header">
        <div>
          <h2 className="card-title">
            <span className="title-icon">⚖️</span> Fair Query Optimization Benchmarking
          </h2>
          <p className="card-subtitle">
            Controlled interleaved benchmarking measuring median, IQR spread, and P95 latency with automated AST semantic analysis, multiset result equivalence, and paired bootstrap uncertainty.
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
              '⚡ Benchmark Comparison'
            )}
          </button>
        </div>
      </div>

      {/* Two-Column Side-by-Side SQL Editors */}
      <div className="comparison-editors-grid">
        <div className="compare-col">
          <div className="editor-subheading">
            <span className="badge-tag">BASELINE QUERY</span>
            <span className="editor-caption">Current active query</span>
          </div>
          {onBaselineSqlChange ? (
            <textarea
              className="sql-textarea compare-textarea"
              aria-label="Baseline SQL Query"
              value={baselineSql}
              onChange={(e) => onBaselineSqlChange(e.target.value)}
              placeholder="Enter baseline SQL query..."
              spellCheck={false}
              disabled={loading}
            />
          ) : (
            <div className="compare-sql-preview">
              <pre className="sql-code-block">{baselineSql || '-- No baseline query entered'}</pre>
            </div>
          )}
        </div>

        <div className="compare-col">
          <div className="editor-subheading">
            <span className="badge-tag badge-revised">REVISED CANDIDATE QUERY</span>
            <span className="editor-caption">Rewritten or optimized alternative SQL</span>
          </div>
          <textarea
            className="sql-textarea compare-textarea"
            aria-label="Revised SQL Query"
            value={candidateSql}
            onChange={(e) => onCandidateSqlChange(e.target.value)}
            placeholder="Enter revised or optimized SQL query to benchmark..."
            spellCheck={false}
            disabled={loading}
          />
        </div>
      </div>

      {/* Results View */}
      {comparison && before && after && delta != null ? (
        <div className="comparison-results-block">
          {/* Equivalence Status Banner */}
          <div className={`status-banner banner-${status?.toLowerCase()}`}>
            <div className="banner-header-row">
              <span className="banner-title">
                {status === 'VERIFIED_EQUIVALENT' && '✅ SEMANTIC EQUIVALENCE VERIFIED'}
                {status === 'SEMANTIC_DIFFERENCE_DETECTED' && '⚠️ SEMANTIC DIFFERENCES DETECTED'}
                {status === 'DIFFERENT_RESULTS' && '🚫 DIFFERENT QUERY RESULTS'}
                {status === 'EQUIVALENCE_UNVERIFIED' && 'ℹ️ EQUIVALENCE UNVERIFIED'}
              </span>
              <span className="badge-status-code">{status}</span>
            </div>
            <p className="banner-text">
              {resultEquiv?.message || 'Result equivalence analysis complete.'}
            </p>

            {/* List of Detected Structural Differences if any */}
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

          {/* Comparative Metrics Grid */}
          <div className="comparison-metrics-row">
            {/* Baseline Column */}
            <div className="query-side-card baseline-side">
              <div className="side-title-tag">BASELINE MEDIAN</div>
              <div className="side-metric-num">
                {before.measured_runtime_ms.toFixed(3)} <span className="unit">ms</span>
              </div>
              <div className="side-details">
                <span>Spread (IQR): {before.iqr_ms != null ? `${before.iqr_ms.toFixed(3)} ms` : 'N/A'}</span>
                <span>P95 Tail: {before.p95_runtime_ms.toFixed(3)} ms</span>
                <span>
                  RAM Hits: {before.metrics?.shared_hit_blocks ?? 0} | Reads:{' '}
                  {before.metrics?.shared_read_blocks ?? 0}
                </span>
                {before.prediction && (
                  <span>ML Forecast: {before.prediction.runtime_ms.toFixed(2)} ms</span>
                )}
              </div>
            </div>

            {/* Difference & Verdict Center Card */}
            <div className="query-delta-card">
              <div className="delta-verdict-tag-row">
                <span className={`verdict-badge verdict-${verdict?.toLowerCase()}`}>
                  {verdict === 'FASTER' && '⚡ MEASURED FASTER'}
                  {verdict === 'SLOWER' && '🔻 MEASURED SLOWER'}
                  {verdict === 'INCONCLUSIVE' && '⚖️ INCONCLUSIVE'}
                  {verdict === 'SEMANTIC_MISMATCH' && '⚠️ SEMANTIC MISMATCH'}
                </span>
              </div>

              <span className="delta-label">LATENCY DIFFERENCE (Δ)</span>
              <div
                className={`delta-num ${
                  verdict === 'FASTER'
                    ? 'text-faster'
                    : verdict === 'SLOWER'
                    ? 'text-slower'
                    : 'text-inconclusive'
                }`}
              >
                {delta > 0 ? `+${delta.toFixed(3)}` : delta.toFixed(3)} ms
              </div>
              <span className="delta-pct">
                {pct != null ? `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%` : 'N/A'}
              </span>

              {/* Bootstrap Confidence Interval */}
              {uncertainty && (
                <div className="bootstrap-ci-badge" title="Paired bootstrap 95% confidence interval of median difference">
                  95% Bootstrap CI: [{uncertainty.ci_lower_ms.toFixed(3)}, {uncertainty.ci_upper_ms.toFixed(3)}] ms
                  {uncertainty.spans_zero && <span className="ci-spans-zero-tag"> (Spans 0)</span>}
                </div>
              )}

              <p className="verdict-message-subtext">{comparison.verdict_message}</p>
            </div>

            {/* Revised Candidate Column */}
            <div className="query-side-card revised-side">
              <div className="side-title-tag">REVISED MEDIAN</div>
              <div className="side-metric-num">
                {after.measured_runtime_ms.toFixed(3)} <span className="unit">ms</span>
              </div>
              <div className="side-details">
                <span>Spread (IQR): {after.iqr_ms != null ? `${after.iqr_ms.toFixed(3)} ms` : 'N/A'}</span>
                <span>P95 Tail: {after.p95_runtime_ms.toFixed(3)} ms</span>
                <span>
                  RAM Hits: {after.metrics?.shared_hit_blocks ?? 0} | Reads:{' '}
                  {after.metrics?.shared_read_blocks ?? 0}
                </span>
                {after.prediction && (
                  <span>ML Forecast: {after.prediction.runtime_ms.toFixed(2)} ms</span>
                )}
              </div>
            </div>
          </div>

          <p className="explainer-caution">
            🛡️ <em>Benchmarking Protocol:</em> {comparison.measurement_note}
          </p>
        </div>
      ) : (
        <div className="comparison-placeholder-box">
          <span className="placeholder-icon">⚖️</span>
          <p>
            Click &ldquo;Benchmark Comparison&rdquo; to execute interleaved measurements on both queries under identical database conditions.
          </p>
        </div>
      )}
    </div>
  );
};
