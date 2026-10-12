import React, { useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
  LineChart,
  Line,
  Legend,
} from 'recharts';
import { AnalyzeResult, HistoryEntry, CompareResult } from '../types';

interface ChartsSectionProps {
  result: AnalyzeResult | null;
  historyEntries: HistoryEntry[];
  comparison?: CompareResult | null;
  onNavigateToAnalyzer?: () => void;
}

export const ChartsSection: React.FC<ChartsSectionProps> = ({
  result,
  historyEntries,
  comparison,
  onNavigateToAnalyzer,
}) => {
  const [activeTab, setActiveTab] = useState<'benchmark' | 'runs' | 'compare' | 'history'>(
    comparison ? 'compare' : result ? 'benchmark' : 'history'
  );
  const [historyFilter, setHistoryFilter] = useState('');

  const hasData = result || (comparison && comparison.before && comparison.after) || historyEntries.length > 0;

  if (!hasData) {
    return (
      <div className="card performance-charts-card empty-charts-box">
        <h2 className="card-title">Query Performance Comparison Charts</h2>
        <div className="tab-empty-prompt">
          <h3>No Performance Benchmarks Recorded</h3>
          <p>
            Execute a query in the Query Analyzer or compare SQL rewrites in the Compare Rewrites tab to populate latency benchmarks and run stability distributions.
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

  // Benchmark Overview Data
  const benchmarkData = result
    ? [
        {
          category: 'ML Predicted',
          latency: Number((result.prediction?.runtime_ms ?? 0).toFixed(3)),
          fill: '#38bdf8',
        },
        {
          category: 'Measured Median',
          latency: Number((result.measured_runtime_ms ?? 0).toFixed(3)),
          fill: '#2dd4bf',
        },
        {
          category: '95th Pct Tail',
          latency: Number((result.p95_runtime_ms ?? 0).toFixed(3)),
          fill: '#f59e0b',
        },
      ]
    : [];

  // Individual Run Distribution: Run 1 .. Run N
  const runsData =
    result?.runs?.map((r, idx) => ({
      run: `Run ${idx + 1}`,
      runtime_ms: Number((r.runtime_ms ?? 0).toFixed(3)),
      planning_ms: Number((r.metrics?.planning_ms ?? 0).toFixed(3)),
    })) ?? [];

  // Rewrite Comparison Data (Feature 1 & Feature 3 integration)
  const compareData = comparison && comparison.before && comparison.after
    ? [
        {
          category: 'Original Query',
          median_ms: Number((comparison.before.measured_runtime_ms ?? 0).toFixed(3)),
          p95_ms: Number((comparison.before.p95_runtime_ms ?? 0).toFixed(3)),
        },
        {
          category: 'Rewritten Query',
          median_ms: Number((comparison.after.measured_runtime_ms ?? 0).toFixed(3)),
          p95_ms: Number((comparison.after.p95_runtime_ms ?? 0).toFixed(3)),
        },
      ]
    : [];

  // Filtered History Data
  const filteredHistory = historyEntries.filter(h => {
    if (!historyFilter.trim()) return true;
    const q = historyFilter.toLowerCase();
    return (
      h.query_fingerprint.toLowerCase().includes(q) ||
      (h.sql_text && h.sql_text.toLowerCase().includes(q))
    );
  });

  const historyData = filteredHistory
    .slice(0, 20)
    .reverse()
    .map((h, idx) => ({
      index: `#${idx + 1}`,
      fingerprint: h.query_fingerprint.substring(0, 8),
      measured_ms: Number((h.runtime_ms ?? 0).toFixed(3)),
      predicted_ms: h.predicted_ms != null ? Number(h.predicted_ms.toFixed(3)) : null,
      time: new Date(h.created_at).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    }));

  return (
    <div className="card performance-charts-card">
      <div className="charts-card-header">
        <div>
          <h2 className="card-title">
            Query Performance Comparison Charts
          </h2>
          <p className="card-subtitle">
            Empirical latency distributions from PostgreSQL buffers and Random Forest regression estimates (in ms).
          </p>
        </div>

        <div className="chart-tabs">
          {result && (
            <button
              className={`chart-tab-btn ${activeTab === 'benchmark' ? 'active' : ''}`}
              onClick={() => setActiveTab('benchmark')}
            >
              Benchmark Overview
            </button>
          )}
          {result && runsData.length > 0 && (
            <button
              className={`chart-tab-btn ${activeTab === 'runs' ? 'active' : ''}`}
              onClick={() => setActiveTab('runs')}
            >
              Run Stability ({runsData.length} runs)
            </button>
          )}
          {comparison && (
            <button
              className={`chart-tab-btn ${activeTab === 'compare' ? 'active' : ''}`}
              onClick={() => setActiveTab('compare')}
            >
              Rewrite Comparison
            </button>
          )}
          {historyEntries.length > 0 && (
            <button
              className={`chart-tab-btn ${activeTab === 'history' ? 'active' : ''}`}
              onClick={() => setActiveTab('history')}
            >
              History Trend ({filteredHistory.length})
            </button>
          )}
        </div>
      </div>

      <div className="chart-viewport-wrapper">
        {/* TAB 1: Benchmark Overview */}
        {activeTab === 'benchmark' && result && (
          <div className="chart-content">
            <div className="chart-meta-legend">
              <span className="legend-item">
                <span className="legend-dot dot-pred"></span> ML Prediction (Range: {result.prediction?.lower_ms != null ? `[${result.prediction.lower_ms.toFixed(2)} - ${result.prediction.upper_ms?.toFixed(2)}] ms` : 'N/A'})
              </span>
              <span className="legend-item">
                <span className="legend-dot dot-meas"></span> Measured Median Latency
              </span>
              <span className="legend-item">
                <span className="legend-dot dot-p95"></span> 95th Percentile Tail Latency
              </span>
            </div>

            <ResponsiveContainer width="100%" height={290}>
              <BarChart data={benchmarkData} margin={{ top: 20, right: 30, left: 10, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1c2f42" vertical={false} />
                <XAxis dataKey="category" stroke="#8b9eb0" tick={{ fill: '#8b9eb0', fontSize: 13 }} />
                <YAxis
                  stroke="#8b9eb0"
                  tick={{ fill: '#8b9eb0', fontSize: 12 }}
                  unit=" ms"
                  domain={[0, 'auto']}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0c1622',
                    borderColor: '#243b52',
                    borderRadius: '8px',
                    color: '#e2e8f0',
                    fontSize: '13px',
                  }}
                  formatter={(value: any) => [`${value} ms`, 'Latency']}
                />
                <Bar dataKey="latency" name="Latency (ms)" radius={[6, 6, 0, 0]} maxBarSize={90}>
                  {benchmarkData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* TAB 2: Run Stability */}
        {activeTab === 'runs' && result && runsData.length > 0 && (
          <div className="chart-content">
            <p className="chart-explainer-text">
              Variance across {runsData.length} repeated sample runs. Interleaved execution isolates cache warm-up and engine fluctuations.
            </p>
            <ResponsiveContainer width="100%" height={290}>
              <BarChart data={runsData} margin={{ top: 20, right: 30, left: 10, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1c2f42" vertical={false} />
                <XAxis dataKey="run" stroke="#8b9eb0" tick={{ fill: '#8b9eb0', fontSize: 13 }} />
                <YAxis
                  stroke="#8b9eb0"
                  tick={{ fill: '#8b9eb0', fontSize: 12 }}
                  unit=" ms"
                  domain={[0, 'auto']}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0c1622',
                    borderColor: '#243b52',
                    borderRadius: '8px',
                    color: '#e2e8f0',
                  }}
                  formatter={(value: any) => [`${value} ms`]}
                />
                <Legend wrapperStyle={{ color: '#8b9eb0', fontSize: '13px' }} />
                <Bar dataKey="runtime_ms" name="Execution Runtime (ms)" fill="#2dd4bf" radius={[4, 4, 0, 0]} />
                <Bar dataKey="planning_ms" name="Planning Time (ms)" fill="#64748b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* TAB 3: Rewrite Comparison */}
        {activeTab === 'compare' && comparison && (
          <div className="chart-content">
            <div className="compare-chart-summary-bar">
              <div className="summary-stat-box">
                <span className="stat-label">Original Median:</span>
                <span className="stat-val">{comparison.before.measured_runtime_ms.toFixed(2)} ms</span>
              </div>
              <div className="summary-stat-box">
                <span className="stat-label">Rewritten Median:</span>
                <span className="stat-val">{comparison.after.measured_runtime_ms.toFixed(2)} ms</span>
              </div>
              <div className="summary-stat-box">
                <span className="stat-label">Latency Delta:</span>
                <span className={`stat-val ${comparison.measured_delta_ms < 0 ? 'text-mint' : comparison.measured_delta_ms > 0 ? 'text-amber' : ''}`}>
                  {comparison.measured_delta_ms > 0 ? '+' : ''}{comparison.measured_delta_ms.toFixed(2)} ms
                </span>
              </div>
              <div className="summary-stat-box">
                <span className="stat-label">Relative Change:</span>
                <span className={`stat-val ${comparison.measured_percent_change != null && comparison.measured_percent_change < 0 ? 'text-mint' : ''}`}>
                  {comparison.measured_percent_change != null ? `${comparison.measured_percent_change > 0 ? '+' : ''}${comparison.measured_percent_change.toFixed(1)}%` : 'N/A'}
                </span>
              </div>
              <div className="summary-stat-box">
                <span className="stat-label">Verdict:</span>
                <span className="badge-pill badge-verdict">{comparison.verdict}</span>
              </div>
            </div>

            <ResponsiveContainer width="100%" height={270}>
              <BarChart data={compareData} margin={{ top: 20, right: 30, left: 10, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1c2f42" vertical={false} />
                <XAxis dataKey="category" stroke="#8b9eb0" tick={{ fill: '#8b9eb0', fontSize: 13 }} />
                <YAxis
                  stroke="#8b9eb0"
                  tick={{ fill: '#8b9eb0', fontSize: 12 }}
                  unit=" ms"
                  domain={[0, 'auto']}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0c1622',
                    borderColor: '#243b52',
                    borderRadius: '8px',
                    color: '#e2e8f0',
                  }}
                  formatter={(value: any) => [`${value} ms`]}
                />
                <Legend wrapperStyle={{ color: '#8b9eb0', fontSize: '13px' }} />
                <Bar dataKey="median_ms" name="Median Runtime (ms)" fill="#2dd4bf" radius={[4, 4, 0, 0]} maxBarSize={70} />
                <Bar dataKey="p95_ms" name="P95 Tail Latency (ms)" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={70} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* TAB 4: History Trend */}
        {activeTab === 'history' && historyEntries.length > 0 && (
          <div className="chart-content">
            <div className="history-filter-toolbar">
              <input
                type="text"
                className="input-text history-search-input"
                placeholder="Filter by query text or fingerprint..."
                value={historyFilter}
                onChange={(e) => setHistoryFilter(e.target.value)}
              />
              <span className="history-count-badge">
                Showing {filteredHistory.length} of {historyEntries.length} queries
              </span>
            </div>

            <ResponsiveContainer width="100%" height={270}>
              <LineChart data={historyData} margin={{ top: 20, right: 30, left: 10, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1c2f42" vertical={false} />
                <XAxis dataKey="index" stroke="#8b9eb0" tick={{ fill: '#8b9eb0', fontSize: 12 }} />
                <YAxis stroke="#8b9eb0" tick={{ fill: '#8b9eb0', fontSize: 12 }} unit=" ms" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0c1622',
                    borderColor: '#243b52',
                    borderRadius: '8px',
                    color: '#e2e8f0',
                  }}
                  formatter={(value: any) => [`${value} ms`]}
                  labelFormatter={(idx, items) => {
                    const item = items?.[0]?.payload;
                    return item ? `Query ${idx} (${item.fingerprint}) at ${item.time}` : `Query ${idx}`;
                  }}
                />
                <Legend wrapperStyle={{ color: '#8b9eb0', fontSize: '13px' }} />
                <Line
                  type="monotone"
                  dataKey="measured_ms"
                  name="Measured Runtime (ms)"
                  stroke="#2dd4bf"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: '#2dd4bf' }}
                />
                <Line
                  type="monotone"
                  dataKey="predicted_ms"
                  name="Predicted Runtime (ms)"
                  stroke="#38bdf8"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={{ r: 3, fill: '#38bdf8' }}
                  connectNulls={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
};
