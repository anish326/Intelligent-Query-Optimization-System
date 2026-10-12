import React from 'react';
import { AnalyzeResult } from '../types';
import { Recommendations } from './Recommendations';

interface MetricsPanelProps {
  result: AnalyzeResult | null;
  loading: boolean;
  onOpenCharts?: () => void;
  onOpenPlan?: () => void;
}

export const MetricsPanel: React.FC<MetricsPanelProps> = ({
  result,
  loading,
  onOpenCharts,
  onOpenPlan,
}) => {
  if (loading && !result) {
    return (
      <div className="card metrics-card">
        <h2 className="card-title">
          Execution Metrics
        </h2>
        <div className="metrics-loading-skeleton">
          <div className="skeleton-spinner-wrap">
            <div className="spinner-large"></div>
            <p className="skeleton-text">Executing warm-up &amp; measured runs...</p>
            <p className="skeleton-subtext">PostgreSQL <code>EXPLAIN ANALYZE</code> + Random Forest inference</p>
          </div>
          <div className="skeleton-grid">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="skeleton-metric-box"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="card metrics-card">
        <h2 className="card-title">
          Execution Metrics
        </h2>
        <div className="metrics-empty-state">
          <div className="empty-icon-circle">
            </div>
          <h3 className="empty-title">Ready to analyze query performance</h3>
          <p className="empty-desc">
            Submit a SQL query in the editor to measure execution latency, buffer cache hits, and compare against the Random Forest ML model.
          </p>

          <div className="empty-steps-list">
            <div className="empty-step-item">
              <span className="step-num">1</span>
              <div className="step-content">
                <strong>Pick a query</strong>
                <span>Choose a template or write custom read-only SQL.</span>
              </div>
            </div>
            <div className="empty-step-item">
              <span className="step-num">2</span>
              <div className="step-content">
                <strong>Benchmark runs</strong>
                <span>Click &ldquo;Measure &amp; Analyze&rdquo; to benchmark the query.</span>
              </div>
            </div>
            <div className="empty-step-item">
              <span className="step-num">3</span>
              <div className="step-content">
                <strong>Inspect results</strong>
                <span>Examine latency, plan nodes, and ML predictions.</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const {
    measured_runtime_ms,
    p95_runtime_ms,
    prediction,
    metrics,
    model,
    runs,
    recommendations,
  } = result;

  const planningTime = metrics?.planning_ms != null ? Number(metrics.planning_ms) : null;
  const hitBlocks = metrics?.shared_hit_blocks != null ? Number(metrics.shared_hit_blocks) : 0;
  const readBlocks = metrics?.shared_read_blocks != null ? Number(metrics.shared_read_blocks) : 0;
  const totalBlocks = hitBlocks + readBlocks;
  const hitRatio = totalBlocks > 0 ? (hitBlocks / totalBlocks) * 100 : 100;

  return (
    <div className="card metrics-card">
      <div className="metrics-card-header">
        <h2 className="card-title">
          Execution Metrics
        </h2>
        <span className="sample-badge">
          {runs.length} runs (median)
        </span>
      </div>

      <p className="metrics-subtitle-note">
        {result.measurement_note}
      </p>

      <div className="metrics-grid">
        {/* Metric 1: Median Measured Runtime */}
        <div className="metric-tile metric-primary">
          <div className="metric-tile-header">
            <span className="metric-label">Median Measured</span>
            <span className="metric-tag tag-measured">ACTUAL</span>
          </div>
          <div className="metric-value-row">
            <span className="metric-big-num">
              {measured_runtime_ms != null ? measured_runtime_ms.toFixed(3) : 'N/A'}
            </span>
            <span className="metric-unit">ms</span>
          </div>
          <span className="metric-caption">Statistical median over {runs.length} runs</span>
        </div>

        {/* Metric 2: P95 Measured Runtime */}
        <div className="metric-tile">
          <div className="metric-tile-header">
            <span className="metric-label">P95 Tail Latency</span>
            <span className="metric-tag tag-measured">P95</span>
          </div>
          <div className="metric-value-row">
            <span className="metric-big-num">
              {p95_runtime_ms != null ? p95_runtime_ms.toFixed(3) : 'N/A'}
            </span>
            <span className="metric-unit">ms</span>
          </div>
          <span className="metric-caption">95th percentile latency</span>
        </div>

        {/* Metric 3: ML Predicted Runtime */}
        <div className="metric-tile metric-ml">
          <div className="metric-tile-header">
            <span className="metric-label">ML Predicted</span>
            <span className="metric-tag tag-ml">PREDICTION</span>
          </div>
          <div className="metric-value-row">
            <span className="metric-big-num">
              {prediction?.runtime_ms != null ? prediction.runtime_ms.toFixed(3) : 'Untrained'}
            </span>
            {prediction?.runtime_ms != null && <span className="metric-unit">ms</span>}
          </div>
          <span className="metric-caption">
            {prediction?.runtime_ms != null && measured_runtime_ms != null ? (
              <>
                Abs Error: {Math.abs(measured_runtime_ms - prediction.runtime_ms).toFixed(3)} ms
                {prediction?.lower_ms != null && prediction?.upper_ms != null && (
                  <> &bull; [{prediction.lower_ms.toFixed(2)}, {prediction.upper_ms.toFixed(2)}] ms</>
                )}
              </>
            ) : (
              'Plan-aware regressor forecast'
            )}
          </span>
        </div>

        {/* Metric 4: PostgreSQL Planning Time */}
        <div className="metric-tile">
          <div className="metric-tile-header">
            <span className="metric-label">Planner Time</span>
            <span className="metric-tag tag-db">PLANNER</span>
          </div>
          <div className="metric-value-row">
            <span className="metric-big-num">
              {planningTime != null ? planningTime.toFixed(3) : 'N/A'}
            </span>
            {planningTime != null && <span className="metric-unit">ms</span>}
          </div>
          <span className="metric-caption">Query optimization time</span>
        </div>

        {/* Metric 5: Model Holdout MAE */}
        <div className="metric-tile">
          <div className="metric-tile-header">
            <span className="metric-label">Holdout MAE</span>
            <span className="metric-tag tag-ml">ACCURACY</span>
          </div>
          <div className="metric-value-row">
            <span className="metric-big-num">
              {model?.mae_ms != null ? model.mae_ms.toFixed(3) : 'Untrained'}
            </span>
            {model?.mae_ms != null && <span className="metric-unit">ms</span>}
          </div>
          <span className="metric-caption">
            {model?.baseline_mae_ms != null ? (
              <>vs Baseline {model.baseline_mae_ms.toFixed(3)} ms ({model.mae_improvement_pct}% lower)</>
            ) : model?.samples ? (
              `${model.samples} measured queries`
            ) : (
              'Untrained model'
            )}
          </span>
        </div>

        {/* Metric 6: Buffer Cache I/O */}
        <div className="metric-tile">
          <div className="metric-tile-header">
            <span className="metric-label">Shared Buffer I/O</span>
            <span className="metric-tag tag-db">CACHE</span>
          </div>
          <div className="metric-value-row">
            <span className="metric-big-num">
              {hitBlocks}
            </span>
            <span className="metric-unit">hits / {readBlocks} reads</span>
          </div>
          <span className="metric-caption">
            Cache Hit Ratio: {hitRatio.toFixed(1)}% ({hitBlocks} RAM blocks)
          </span>
        </div>
      </div>

      {/* Quick Jump Buttons to other parts */}
      <div className="quick-inspect-row">
        {onOpenCharts && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenCharts}>
            View Latency Charts &rarr;
          </button>
        )}
        {onOpenPlan && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenPlan}>
            View Execution Plan &rarr;
          </button>
        )}
      </div>

      {/* Optimization Insights directly below metrics */}
      <div className="metrics-insights-wrapper">
        <Recommendations recommendations={recommendations} />
      </div>
    </div>
  );
};
