import React from 'react';
import { ModelStatus } from '../types';

interface HeaderProps {
  backendConnected: boolean | null;
  modelStatus: ModelStatus | null;
  isSimulationMode?: boolean;
  onOpenSettings?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  backendConnected,
  modelStatus,
  isSimulationMode = false,
  onOpenSettings,
}) => {
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
        {isSimulationMode ? (
          <div
            className="status-pill pill-simulation"
            title="Running in-browser ML inference & PostgreSQL plan simulation. Click to configure live backend."
            onClick={onOpenSettings}
            style={{ cursor: 'pointer' }}
          >
            <span className="status-dot"></span>
            <span className="status-label">In-Browser ML Engine (Cloud Preview)</span>
          </div>
        ) : (
          <div
            className={`status-pill ${
              backendConnected === true
                ? 'pill-connected'
                : backendConnected === false
                ? 'pill-disconnected'
                : 'pill-checking'
            }`}
            onClick={onOpenSettings}
            style={{ cursor: 'pointer' }}
            title="Click to view or edit backend connection settings"
          >
            <span className="status-dot"></span>
            <span className="status-label">
              {backendConnected === true
                ? 'PostgreSQL 16 Connected (Live)'
                : backendConnected === false
                ? 'Backend Offline'
                : 'Connecting...'}
            </span>
          </div>
        )}

        {/* ML Model Status */}
        <div className={`status-pill ${isTrained ? 'pill-trained' : 'pill-untrained'}`}>
          <span className="status-label">
            {isTrained ? (
              <>Model: <strong>{modelStatus?.version}</strong> ({modelStatus?.samples} samples)</>
            ) : backendConnected ? (
              'ML Model: Untrained'
            ) : (
              'ML Model: Initializing'
            )}
          </span>
        </div>

        {/* Environment Profile */}
        <div className="status-pill pill-env" title="Read-only queries permitted on controlled test dataset">
          <span className="status-label">Controlled Read-Only DB</span>
        </div>
      </div>
    </header>
  );
};
