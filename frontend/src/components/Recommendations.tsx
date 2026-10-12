import React from 'react';
import { Recommendation } from '../types';

interface RecommendationsProps {
  recommendations: Recommendation[];
}

export const Recommendations: React.FC<RecommendationsProps> = ({ recommendations }) => {
  const isDefaultInfo =
    recommendations.length === 1 &&
    (recommendations[0].message?.toLowerCase().includes('no obvious plan anti-patterns') ||
     recommendations[0].issue?.toLowerCase().includes('optimal'));

  return (
    <div className="card recommendations-card">
      <div className="recommendations-header">
        <div>
          <h2 className="card-title">
            Index &amp; Query Optimization Recommendations
          </h2>
          <p className="card-subtitle">
            Transparent rule-based advisory engine analyzing PostgreSQL execution plan nodes, sequential scans, and buffer metrics.
          </p>
        </div>
        <span className="heuristics-badge">Rule-Based Engine &bull; Non-ML</span>
      </div>

      {recommendations.length === 0 || isDefaultInfo ? (
        <div className="recommendations-clean-state">
          <div className="clean-text">
            <strong>Optimal Plan Shape Detected</strong>
            <p>
              No high-cost sequential scans, avoidable sorts, unindexed filter columns, or disk spills were detected. Execution relied cleanly on available indexes or low-cost index-only/bitmap scans.
            </p>
          </div>
        </div>
      ) : (
        <div className="recommendations-list">
          {recommendations.map((rec, idx) => {
            const hasStructured = !!(rec.issue && rec.action);
            const severityClass = `severity-${rec.severity || 'info'}`;

            return (
              <div key={idx} className={`recommendation-item ${severityClass}`}>
                <div className="rec-severity-badge">
                  {(rec.severity || 'info').toUpperCase()}
                </div>
                <div className="rec-body">
                  <h4 className="rec-title">
                    {rec.issue || 'Optimization Opportunity'}
                  </h4>

                  {hasStructured ? (
                    <div className="rec-structured-details">
                      {rec.evidence && (
                        <div className="rec-detail-row">
                          <span className="rec-detail-label">Evidence:</span>
                          <span className="rec-detail-val">{rec.evidence}</span>
                        </div>
                      )}
                      {rec.action && (
                        <div className="rec-detail-row rec-action-row">
                          <span className="rec-detail-label">Suggested Action:</span>
                          <span className="rec-detail-val action-text">{rec.action}</span>
                        </div>
                      )}
                      {rec.benefit && (
                        <div className="rec-detail-row">
                          <span className="rec-detail-label">Expected Benefit:</span>
                          <span className="rec-detail-val benefit-text">{rec.benefit}</span>
                        </div>
                      )}
                      {rec.tradeoffs && (
                        <div className="rec-detail-row">
                          <span className="rec-detail-label">Trade-offs &amp; Uncertainty:</span>
                          <span className="rec-detail-val tradeoff-text">{rec.tradeoffs}</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <p className="rec-message">{rec.message}</p>
                      <div className="rec-guidance">
                        <strong>Recommended Next Steps:</strong>{' '}
                        {rec.action || 'Review query structure, join ordering, or filter column indexes to reduce total block I/O.'}
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="recommendations-footer-disclaimer">
        <em>Advisory Safety Guarantee:</em> The optimization engine never automatically creates indexes or alters the database schema. All suggestions are presented for database administrator review. Adding secondary indexes increases storage overhead and incurs write penalties during INSERT/UPDATE operations.
      </div>
    </div>
  );
};
