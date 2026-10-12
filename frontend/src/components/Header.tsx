import React from 'react';
import { ModelStatus } from '../types';

interface HeaderProps {
  backendConnected: boolean | null;
  modelStatus: ModelStatus | null;
}

export const Header: React.FC<HeaderProps> = ({ backendConnected, modelStatus }) => {
  const isTrained = (modelStatus?.samples ?? 0) > 0 && modelStatus?.version != null;

  return (
    <header className="app-header">
      <div className="header-brand">
        <div className="tech-badge">
          <span>POSTGRESQL</span>
          <span className="dot">•</span>
          <span>FASTAPI</span>
          <span className="dot">•</span>
          <span>REACT 19</span>
          <span className="dot">•</span>
          <span>SCIKIT-LEARN</span>
        </div>
        <h1 className="app-title">Intelligent Query Optimization</h1>
        <p className="app-subtitle">
          Benchmarking execution latency with PostgreSQL <code>EXPLAIN ANALYZE</code> and estimating runtimes via tree-quantile Random Forest regression.
        </p>
      </div>

      <div className="header-status-group">
        {/* Backend Connection Indicator */}
        <div className={`status-pill ${backendConnected === true ? 'pill-connected' : backendConnected === false ? 'pill-disconnected' : 'pill-checking'}`}>
          <span className="status-dot"></span>
          <span className="status-label">
            {backendConnected === true ? 'PostgreSQL 16 Connected' : backendConnected === false ? 'Backend Offline' : 'Connecting...'}
          </span>
        </div>

        {/* ML Model Status */}
        <div className={`status-pill ${isTrained ? 'pill-trained' : 'pill-untrained'}`}>
          <span className="model-chip-icon">🤖</span>
          <span className="status-label">
            {isTrained ? (
              <>Model: <strong>{modelStatus?.version}</strong> ({modelStatus?.samples} samples)</>
            ) : backendConnected ? (
              'ML Model: Untrained'
            ) : (
              'ML Model: Unavailable'
            )}
          </span>
        </div>

        {/* Environment Profile */}
        <div className="status-pill pill-env" title="Read-only queries permitted on controlled test dataset">
          <span className="env-lock-icon">🔒</span>
          <span className="status-label">Controlled Read-Only DB</span>
        </div>
      </div>
    </header>
  );
};
