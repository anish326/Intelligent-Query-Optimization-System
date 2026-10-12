import React, { useState } from 'react';
import { ModelStatus, Prediction } from '../types';

interface ModelIntelligenceProps {
  modelStatus: ModelStatus | null;
  prediction: Prediction | null;
  features?: Record<string, number>;
  actualRuntimeMs?: number;
  onTrain: () => Promise<void>;
  training: boolean;
}

export const ModelIntelligence: React.FC<ModelIntelligenceProps> = ({
  modelStatus,
  prediction,
  features,
  actualRuntimeMs,
  onTrain,
  training,
}) => {
  const [showFeatures, setShowFeatures] = useState(false);
  const isTrained = (modelStatus?.samples ?? 0) > 0 && modelStatus?.version != null;

  const predError =
    actualRuntimeMs != null && prediction?.runtime_ms != null
      ? Math.abs(actualRuntimeMs - prediction.runtime_ms)
      : null;

  return (
    <div className="card model-intelligence-card">
      <div className="model-header-row">
        <div>
          <h2 className="card-title">
            <span className="title-icon">🤖</span> Machine Learning Runtime Intelligence
          </h2>
          <p className="card-subtitle">
            Plan-aware runtime regression using scikit-learn <code>RandomForestRegressor</code> (240 estimators). Evaluated using zero-leakage grouped holdout against a naive central-tendency median baseline.
          </p>
        </div>

        <button
          type="button"
          className="btn btn-outline"
          onClick={onTrain}
          disabled={training}
          title="Retrain model on latest records in query_history"
        >
          {training ? (
            <span className="loading-content">
              <span className="spinner"></span> Fitting trees...
            </span>
          ) : (
            '⚙️ Retrain Model'
          )}
        </button>
      </div>

      {/* Model Status & Workload Specs Grid */}
      <div className="model-specs-grid">
        <div className="spec-card">
          <span className="spec-label">Algorithm</span>
          <span className="spec-value">Random Forest Regressor</span>
          <span className="spec-sub">240 estimator trees, min_leaf=2</span>
        </div>

        <div className="spec-card">
          <span className="spec-label">Model Status</span>
          <span className={`spec-value ${isTrained ? 'text-mint' : 'text-amber'}`}>
            {isTrained ? 'Trained & Persisted' : 'Untrained'}
          </span>
          <span className="spec-sub">
            {isTrained ? `Version: ${modelStatus?.version}` : 'Run training or collect queries'}
          </span>
        </div>

        <div className="spec-card">
          <span className="spec-label">Evaluation Workload</span>
          <span className="spec-value">{modelStatus?.samples ?? 0} Executions</span>
          <span className="spec-sub">
            {modelStatus?.train_samples != null && modelStatus?.val_samples != null
              ? `${modelStatus.train_samples} Train / ${modelStatus.val_samples} Holdout Val (${modelStatus.unique_fingerprints ?? 0} fingerprints, ${modelStatus.unique_shapes ?? 0} shapes)`
              : 'Measured executions in database'}
          </span>
        </div>

        <div className="spec-card">
          <span className="spec-label">Evaluation Strategy</span>
          <span className="spec-value">
            {modelStatus?.evaluation_strategy === 'grouped_family_holdout'
              ? 'Grouped Family Holdout'
              : modelStatus?.evaluation_strategy === 'grouped_fingerprint_holdout'
              ? 'Grouped Fingerprint'
              : 'Chronological Split'}
          </span>
          <span className="spec-sub">
            {modelStatus?.held_out_families && modelStatus.held_out_families.length > 0
              ? `Held-out: ${modelStatus.held_out_families.join(', ')} (Zero template leakage)`
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
              🏆 OUTPERFORMS BASELINE ({modelStatus.mae_improvement_pct}% lower MAE)
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
            ℹ️ <em>Plan Features Note:</em> {prediction.features_note || 'Plan features derived from estimated PostgreSQL query plan (EXPLAIN without ANALYZE) prior to actual execution.'}
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
              {showFeatures ? 'Hide Extracted Vector ▲' : 'Inspect Feature Vector ▼'}
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
