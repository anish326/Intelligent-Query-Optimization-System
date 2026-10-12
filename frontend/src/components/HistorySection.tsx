import React, { useState } from 'react';
import { HistoryEntry } from '../types';

interface HistorySectionProps {
  entries: HistoryEntry[];
  loading: boolean;
  onRefresh: () => void;
  onSelectQuery: (sql: string) => void;
}

export const HistorySection: React.FC<HistorySectionProps> = ({
  entries,
  loading,
  onRefresh,
  onSelectQuery,
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredEntries = entries.filter((entry) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return (
      entry.query_fingerprint.toLowerCase().includes(term) ||
      (entry.sql_text && entry.sql_text.toLowerCase().includes(term)) ||
      (entry.model_version && entry.model_version.toLowerCase().includes(term))
    );
  });

  return (
    <div className="card query-history-card">
      <div className="history-card-header">
        <div>
          <h2 className="card-title">
            <span className="title-icon">📜</span> Recorded Query Audit History
          </h2>
          <p className="card-subtitle">
            Historical executions recorded in PostgreSQL <code>query_history</code> used for model retraining and observational audits.
          </p>
        </div>

        <div className="history-actions-row">
          <input
            type="text"
            className="history-search-input"
            placeholder="Search fingerprints or SQL..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onRefresh}
            disabled={loading}
            title="Reload latest query history"
          >
            {loading ? '↻ Refreshing...' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {loading && entries.length === 0 ? (
        <div className="history-loading-state">
          <div className="spinner"></div>
          <span>Loading historical audit records from database...</span>
        </div>
      ) : entries.length === 0 ? (
        <div className="history-empty-state">
          <span className="empty-icon">📭</span>
          <p>No queries recorded in history yet. Execute a query above to log measured runs.</p>
        </div>
      ) : (
        <div className="history-table-container">
          <table className="history-table">
            <thead>
              <tr>
                <th>Fingerprint</th>
                <th>Query Preview</th>
                <th>Measured</th>
                <th>Predicted</th>
                <th>Model Version</th>
                <th>Timestamp</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.map((item, idx) => {
                const formattedTime = new Date(item.created_at).toLocaleString([], {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                });

                return (
                  <tr key={`${item.query_fingerprint}-${idx}`}>
                    <td>
                      <code className="fingerprint-badge" title={item.query_fingerprint}>
                        {item.query_fingerprint.substring(0, 10)}…
                      </code>
                    </td>
                    <td className="sql-snippet-cell" title={item.sql_text || 'Query text not captured'}>
                      {item.sql_text ? (
                        <span className="sql-snippet-text">{item.sql_text.replace(/\s+/g, ' ')}</span>
                      ) : (
                        <span className="text-muted">Standard benchmark query</span>
                      )}
                    </td>
                    <td>
                      <strong className="text-mint">{item.runtime_ms.toFixed(3)} ms</strong>
                    </td>
                    <td>
                      {item.predicted_ms != null ? (
                        <span className="text-cyan">{item.predicted_ms.toFixed(3)} ms</span>
                      ) : (
                        <span className="text-muted">N/A</span>
                      )}
                    </td>
                    <td>
                      {item.model_version ? (
                        <span className="version-pill">{item.model_version}</span>
                      ) : (
                        <span className="text-muted">Untrained</span>
                      )}
                    </td>
                    <td className="time-cell">{formattedTime}</td>
                    <td>
                      {item.sql_text ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          onClick={() => onSelectQuery(item.sql_text!)}
                          title="Load this query into the SQL editor"
                        >
                          Load SQL ↗
                        </button>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
