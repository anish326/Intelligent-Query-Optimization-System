import React from 'react';
import { Recommendation } from '../types';

interface RecommendationsProps {
  recommendations: Recommendation[];
}

export const Recommendations: React.FC<RecommendationsProps> = ({ recommendations }) => {
  const isDefaultInfo =
    recommendations.length === 1 &&
    recommendations[0].message.toLowerCase().includes('no obvious plan anti-patterns');

  return (
    <div className="card recommendations-card">
      <div className="recommendations-header">
        <div>
          <h2 className="card-title">
            <span className="title-icon">💡</span> Optimization Insights
          </h2>
          <p className="card-subtitle">
            Heuristic rules analyzing PostgreSQL execution nodes, disk spillage, and sequential scan row counts.
          </p>
        </div>
        <span className="heuristics-badge">Advisory Heuristics • Non-ML</span>
      </div>

      {recommendations.length === 0 || isDefaultInfo ? (
        <div className="recommendations-clean-state">
          <div className="clean-icon">✓</div>
          <div className="clean-text">
            <strong>Optimal Plan Shape Detected</strong>
            <p>
              No obvious execution bottlenecks or disk spills were detected for this query structure. Execution relied cleanly on available indices or low-cost scans.
            </p>
          </div>
        </div>
      ) : (
        <div className="recommendations-list">
          {recommendations.map((rec, idx) => {
            const isSeqScan = rec.message.toLowerCase().includes('sequential scan');
            const isSpill = rec.message.toLowerCase().includes('spilled') || rec.message.toLowerCase().includes('temp');

            return (
              <div key={idx} className={`recommendation-item severity-${rec.severity}`}>
                <div className="rec-severity-badge">
                  {rec.severity.toUpperCase()}
                </div>
                <div className="rec-body">
                  <h4 className="rec-title">
                    {isSeqScan ? 'High-Volume Sequential Table Scan Detected' : isSpill ? 'Execution Spilled to Temporary Disk Storage' : 'Execution Node Advisory'}
                  </h4>
                  <p className="rec-message">{rec.message}</p>
                  
                  <div className="rec-guidance">
                    <strong>Recommended Next Steps:</strong>{' '}
                    {isSeqScan
                      ? 'Evaluate adding a filtered/composite B-tree index on the WHERE filter columns, or verify selectivity to ensure a sequential scan is genuinely cheaper than random index I/O.'
                      : isSpill
                      ? 'Consider increasing the transaction work_mem or applying tighter LIMIT/projection conditions to avoid spilling temporary sorting or hash buffers to disk.'
                      : 'Review query structure, join ordering, or column projections to reduce overall block I/O.'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="recommendations-footer-disclaimer">
        ⚠️ <em>Advisory Note:</em> Recommendations are heuristic rules based on plan node metrics and do not modify database schemas, create indexes, or guarantee runtime reductions without empirical validation.
      </div>
    </div>
  );
};
