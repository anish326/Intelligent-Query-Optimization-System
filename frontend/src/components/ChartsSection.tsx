import React, { useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
  LineChart,
  Line,
  Cell,
} from 'recharts';
import { AnalyzeResult, HistoryEntry } from '../types';

interface ChartsSectionProps {
  result: AnalyzeResult | null;
  historyEntries: HistoryEntry[];
  onNavigateToAnalyzer?: () => void;
}

export const ChartsSection: React.FC<ChartsSectionProps> = ({
  result,
  historyEntries,
  onNavigateToAnalyzer,
}) => {
  const [activeTab, setActiveTab] = useState<'benchmark' | 'runs' | 'history'>('benchmark');

  if (!result && historyEntries.length === 0) {
    return (
      <div className="card performance-charts-card empty-charts-box">
        <h2 className="card-title">
          <span className="title-icon">📈</span> Latency Visualizations
        </h2>
        <div className="tab-empty-prompt">
          <span className="empty-prompt-icon">📊</span>
          <h3>No Query Analyzed Yet</h3>
          <p>
            Execute a query in the Query Analyzer tab to see ML predictions vs. measured median and P95 latency distributions.
          </p>
          {onNavigateToAnalyzer && (
            <button type="button" className="btn btn-primary" onClick={onNavigateToAnalyzer}>
              ⚡ Go to Query Analyzer
            </button>
          )}
        </div>
      </div>
    );
  }

  // Primary Comparison Chart: Predicted vs Median vs P95
  const benchmarkData = result
    ? [
        {
          category: 'ML Prediction',
          latency: Number((result.prediction?.runtime_ms ?? 0).toFixed(3)),
          lower: Number((result.prediction?.lower_ms ?? 0).toFixed(3)),
          upper: Number((result.prediction?.upper_ms ?? 0).toFixed(3)),
          type: 'estimate',
          fill: '#38bdf8',
        },
        {
          category: 'Median Measured',
          latency: Number((result.measured_runtime_ms ?? 0).toFixed(3)),
          type: 'measured',
          fill: '#2dd4bf',
        },
        {
          category: 'P95 Tail Latency',
          latency: Number((result.p95_runtime_ms ?? 0).toFixed(3)),
          type: 'measured',
          fill: '#a7f3d0',
        },
      ]
    : [];

  // Individual Run Distribution: Run 1 .. Run N
  const runsData =
    result?.runs.map((r, idx) => ({
      run: `Run ${idx + 1}`,
      runtime_ms: Number((r.runtime_ms ?? 0).toFixed(3)),
      planning_ms: Number((r.metrics?.planning_ms ?? 0).toFixed(3)),
    })) ?? [];

  // Historical Timeline Chart
  const historyData = historyEntries
    .slice(0, 15)
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
            <span className="title-icon">📈</span> Execution Latency Visualization
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
          {historyData.length > 0 && (
            <button
              className={`chart-tab-btn ${activeTab === 'history' ? 'active' : ''}`}
              onClick={() => setActiveTab('history')}
            >
              History Trend ({historyData.length} queries)
            </button>
          )}
        </div>
      </div>

      <div className="chart-viewport-wrapper">
        {activeTab === 'benchmark' && result && (
          <div className="chart-content">
            <div className="chart-meta-legend">
              <span className="legend-item">
                <span className="legend-dot dot-pred"></span> ML Prediction (Uncertainty Range: {result.prediction?.lower_ms != null ? `[${result.prediction.lower_ms.toFixed(2)} - ${result.prediction.upper_ms?.toFixed(2)}] ms` : 'N/A'})
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

        {activeTab === 'runs' && result && runsData.length > 0 && (
          <div className="chart-content">
            <p className="chart-explainer-text">
              Variance across all executed sample runs. A tight variance indicates stable buffer caching and low OS contention.
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

        {activeTab === 'history' && historyData.length > 0 && (
          <div className="chart-content">
            <p className="chart-explainer-text">
              Measured vs. ML-predicted latency across recent recorded audit queries in PostgreSQL <code>query_history</code>.
            </p>
            <ResponsiveContainer width="100%" height={290}>
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
