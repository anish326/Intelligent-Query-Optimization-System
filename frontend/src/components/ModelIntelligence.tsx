import React, { useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  LineChart,
  Line,
} from 'recharts';
import { ModelStatus, Prediction, HistoryEntry } from '../types';

interface ModelIntelligenceProps {
  modelStatus: ModelStatus | null;
  prediction: Prediction | null;
  features?: Record<string, number>;
  actualRuntimeMs?: number;
  historyEntries?: HistoryEntry[];
  onTrain: () => void;
  training: boolean;
}

export const ModelIntelligence: React.FC<ModelIntelligenceProps> = ({
  modelStatus,
  prediction,
  features,
  actualRuntimeMs,
  historyEntries = [],
  onTrain,
  training,
}) => {
  const [showFeatures, setShowFeatures] = useState(false);
  const [activePlotTab, setActivePlotTab] = useState<'paired' | 'errors'>('paired');

  const predError =
    actualRuntimeMs != null && prediction != null
      ? Math.abs(prediction.runtime_ms - actualRuntimeMs)
      : null;

  // Filter history entries that have both measured and predicted runtimes
  const validHistoryPoints = historyEntries
    .filter((h) => h.predicted_ms != null && h.runtime_ms != null)
    .slice(0, 15)
    .map((h, idx) => ({
      name: `Q${idx + 1} (${h.query_fingerprint.slice(0, 6)})`,
      actual_ms: Number(h.runtime_ms.toFixed(3)),
      predicted_ms: Number((h.predicted_ms ?? 0).toFixed(3)),
      abs_error_ms: Number(Math.abs(h.runtime_ms - (h.predicted_ms ?? 0)).toFixed(3)),
    }));

  return (
    <div className="card model-intelligence-card">
      <div className="model-header-row">
        <div>
          <h2 className="card-title">
            Machine Learning Intelligence Dashboard
          </h2>
          <p className="card-subtitle">
            Plan-aware RandomForestRegressor evaluating query execution runtime across 16 AST &amp; EXPLAIN plan features.
          </p>
        </div>

        <div className="model-actions-bar">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onTrain}
            disabled={training}
          >
            {training ? 'Evaluating Model...' : 'Retrain & Evaluate Model'}
          </button>
        </div>
      </div>

      {/* Primary Architecture & Validation Specification Cards */}
      <div className="specs-grid">
        <div className="spec-card">
          <span className="spec-label">Model Architecture</span>
          <span className="spec-value">RandomForestRegressor</span>
          <span className="spec-sub">
            {modelStatus?.version ?? '240 Estimators • max_depth=14'}
          </span>
        </div>

        <div className="spec-card">
          <span className="spec-label">Held-Out Test MAE</span>
          <span className="spec-value text-mint">
            {modelStatus?.mae_ms != null ? `${modelStatus.mae_ms.toFixed(3)} ms` : 'Uncalibrated'}
          </span>
          <span className="spec-sub">
            {modelStatus?.outperforms_baseline
              ? `${modelStatus.mae_improvement_pct}% lower error vs baseline`
              : 'Mean Absolute Error on holdout'}
          </span>
        </div>

        <div className="spec-card">
          <span className="spec-label">Held-Out Test RMSE</span>
          <span className="spec-value">
            {modelStatus?.rmse_ms != null ? `${modelStatus.rmse_ms.toFixed(3)} ms` : 'N/A'}
          </span>
          <span className="spec-sub">Root Mean Squared Error</span>
        </div>

        <div className="spec-card">
          <span className="spec-label">Dataset Partitions</span>
          <span className="spec-value">
            {modelStatus?.samples ? `${modelStatus.samples} Total Samples` : 'No samples'}
          </span>
          <span className="spec-sub">
            {modelStatus?.train_samples != null && modelStatus?.val_samples != null
              ? `${modelStatus.train_samples} Train / ${modelStatus.val_samples} Holdout Test`
              : 'Holdout Partition'}
          </span>
        </div>

        <div className="spec-card">
          <span className="spec-label">Evaluation Strategy</span>
          <span className="spec-value">
            {modelStatus?.evaluation_strategy === 'grouped_family_holdout'
              ? 'Grouped Family Holdout'
              : modelStatus?.evaluation_strategy === 'grouped_fingerprint_holdout'
              ? 'Grouped Fingerprint'
              : 'Grouped Holdout'}
          </span>
          <span className="spec-sub">
            {modelStatus?.held_out_families && modelStatus.held_out_families.length > 0
              ? `Held-out: ${modelStatus.held_out_families.join(', ')} (Zero leakage)`
              : `${modelStatus?.query_families_count ?? 9} query families (Zero leakage)`}
          </span>
        </div>
      </div>

      {/* Model vs Naive Median Baseline Comparison Section */}
      <div className="baseline-comparison-box">
        <div className="baseline-header-row">
          <div>
            <span className="baseline-title-tag">MODEL GENERALIZATION VS NAIVE BASELINE</span>
            <h3 className="baseline-subheading">
              Random Forest Model vs. Training-Set Median Runtime Baseline
            </h3>
          </div>
          {modelStatus?.outperforms_baseline && (
            <div className="baseline-badge-outperform">
              OUTPERFORMS BASELINE ({modelStatus.mae_improvement_pct}% lower MAE)
            </div>
          )}
        </div>

        <div className="baseline-metrics-table-wrapper">
          <table className="baseline-table">
            <thead>
              <tr>
                <th>Evaluation Metric</th>
                <th>Random Forest Model</th>
                <th>Naive Median Baseline</th>
                <th>Performance Delta</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <strong>Holdout MAE (Mean Absolute Error)</strong>
                  <span className="table-caption">Average error on unseen query patterns</span>
                </td>
                <td className="metric-model">
                  {modelStatus?.mae_ms != null ? `${modelStatus.mae_ms.toFixed(3)} ms` : 'N/A'}
                </td>
                <td className="metric-baseline">
                  {modelStatus?.baseline_mae_ms != null
                    ? `${modelStatus.baseline_mae_ms.toFixed(3)} ms`
                    : 'N/A'}
                </td>
                <td className="metric-diff text-mint">
                  {modelStatus?.mae_improvement_pct != null
                    ? `-${modelStatus.mae_improvement_pct.toFixed(1)}% error`
                    : 'N/A'}
                </td>
              </tr>
              <tr>
                <td>
                  <strong>Holdout RMSE (Root Mean Squared Error)</strong>
                  <span className="table-caption">Penalizes large outlier forecast errors</span>
                </td>
                <td className="metric-model">
                  {modelStatus?.rmse_ms != null ? `${modelStatus.rmse_ms.toFixed(3)} ms` : 'N/A'}
                </td>
                <td className="metric-baseline">
                  {modelStatus?.baseline_rmse_ms != null
                    ? `${modelStatus.baseline_rmse_ms.toFixed(3)} ms`
                    : 'N/A'}
                </td>
                <td className="metric-diff text-mint">
                  {modelStatus?.rmse_ms != null && modelStatus?.baseline_rmse_ms != null
                    ? `${(
                        ((modelStatus.baseline_rmse_ms - modelStatus.rmse_ms) /
                          modelStatus.baseline_rmse_ms) *
                        100
                      ).toFixed(1)}% lower RMSE`
                    : 'N/A'}
                </td>
              </tr>
              <tr>
                <td>
                  <strong>MdAPE (Median Absolute % Error)</strong>
                  <span className="table-caption">
                    Relative percentage error with safe 0.05ms floor
                  </span>
                </td>
                <td className="metric-model">
                  {modelStatus?.mdape_pct != null ? `${modelStatus.mdape_pct.toFixed(1)}%` : 'N/A'}
                </td>
                <td className="metric-baseline">Reference Baseline</td>
                <td className="metric-diff text-mint">Robust to sub-ms scale</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Prediction vs Actual Visualization (Feature 5 Requirement) */}
      {validHistoryPoints.length > 0 && (
        <div className="prediction-plot-section">
          <div className="prediction-plot-header">
            <div>
              <span className="baseline-title-tag">EMPIRICAL EVALUATION PLOT</span>
              <h3 className="baseline-subheading">
                Prediction vs. Actual Measured Runtime Across Benchmark Queries
              </h3>
            </div>
            <div className="plan-view-tabs">
              <button
                type="button"
                className={`plan-tab-btn ${activePlotTab === 'paired' ? 'active' : ''}`}
                onClick={() => setActivePlotTab('paired')}
              >
                Predicted vs Actual (ms)
              </button>
              <button
                type="button"
                className={`plan-tab-btn ${activePlotTab === 'errors' ? 'active' : ''}`}
                onClick={() => setActivePlotTab('errors')}
              >
                Absolute Errors (|Delta| ms)
              </button>
            </div>
          </div>

          <div className="prediction-chart-box">
            {activePlotTab === 'paired' ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={validHistoryPoints} margin={{ top: 15, right: 25, left: 10, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1c2f42" vertical={false} />
                  <XAxis dataKey="name" stroke="#8b9eb0" tick={{ fill: '#8b9eb0', fontSize: 11 }} />
                  <YAxis stroke="#8b9eb0" tick={{ fill: '#8b9eb0', fontSize: 12 }} unit=" ms" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0c1622',
                      borderColor: '#243b52',
                      borderRadius: '8px',
                      color: '#e2e8f0',
                    }}
                    formatter={(val: any) => [`${val} ms`]}
                  />
                  <Legend wrapperStyle={{ color: '#8b9eb0', fontSize: '13px' }} />
                  <Bar dataKey="actual_ms" name="Measured Runtime (ms)" fill="#2dd4bf" radius={[4, 4, 0, 0]} maxBarSize={40} />
                  <Bar dataKey="predicted_ms" name="ML Predicted Runtime (ms)" fill="#38bdf8" radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={validHistoryPoints} margin={{ top: 15, right: 25, left: 10, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1c2f42" vertical={false} />
                  <XAxis dataKey="name" stroke="#8b9eb0" tick={{ fill: '#8b9eb0', fontSize: 11 }} />
                  <YAxis stroke="#8b9eb0" tick={{ fill: '#8b9eb0', fontSize: 12 }} unit=" ms" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0c1622',
                      borderColor: '#243b52',
                      borderRadius: '8px',
                      color: '#e2e8f0',
                    }}
                    formatter={(val: any) => [`${val} ms`]}
                  />
                  <Legend wrapperStyle={{ color: '#8b9eb0', fontSize: '13px' }} />
                  <Line
                    type="monotone"
                    dataKey="abs_error_ms"
                    name="Absolute Residual Error (|Actual - Predicted| ms)"
                    stroke="#f59e0b"
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: '#f59e0b' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}

      {/* Active Query Prediction vs Measurement (if analyzed) */}
      {prediction && (
        <div className="prediction-insight-banner">
          <div className="insight-header">
            <span className="insight-tag">ACTIVE QUERY INFERENCE</span>
            <div className="insight-title-group">
              <span className="insight-title">
                Point Estimate: <strong>{prediction.runtime_ms.toFixed(3)} ms</strong>
              </span>
              {actualRuntimeMs != null && (
                <span className="insight-actual">
                  Actual Median: <strong>{actualRuntimeMs.toFixed(3)} ms</strong>
                </span>
              )}
              {predError != null && (
                <span className="insight-error">
                  Abs Error: <strong>{predError.toFixed(3)} ms</strong>
                </span>
              )}
            </div>
          </div>

          <div className="uncertainty-range-bar">
            {prediction.lower_ms != null && prediction.upper_ms != null ? (
              <div className="uncertainty-text">
                Tree Quantile Uncertainty Interval (10th - 90th percentile):{' '}
                <span className="badge-range">
                  {prediction.lower_ms.toFixed(2)} ms &mdash; {prediction.upper_ms.toFixed(2)} ms
                </span>
                <span className="uncertainty-note">
                  (Spread: {(prediction.upper_ms - prediction.lower_ms).toFixed(2)} ms indicates prediction variance)
                </span>
              </div>
            ) : (
              <span className="uncertainty-note">Point estimate computed across 240 ensemble estimators</span>
            )}
          </div>

          <p className="features-note-sub">
            <em>Plan Features Note:</em> {prediction.features_note || 'Plan features derived from estimated PostgreSQL query plan (EXPLAIN without ANALYZE) prior to actual execution.'}
          </p>
        </div>
      )}

      {/* Feature Engineering Explainer */}
      <div className="features-explainer-section">
        <div className="features-toggle-row">
          <span className="features-summary-text">
            <strong>16 Engineered Features:</strong> 8 SQL syntax tokens (length, joins, predicates, aggregates, order by, distinct, subquery, limit) + 8 PostgreSQL plan nodes (estimated cost, rows, tree nodes, seq scans, index scans, join nodes, sorts, aggregates).
          </span>
          {features && Object.keys(features).length > 0 && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setShowFeatures(!showFeatures)}
            >
              {showFeatures ? 'Hide Extracted Vector' : 'Inspect Feature Vector'}
            </button>
          )}
        </div>

        {showFeatures && features && (
          <div className="features-pills-grid">
            {Object.entries(features).map(([name, val]) => (
              <div key={name} className="feature-pill">
                <span className="feat-name">{name}</span>
                <span className="feat-val">
                  {typeof val === 'number'
                    ? Number.isInteger(val)
                      ? val
                      : val.toFixed(2)
                    : String(val)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
