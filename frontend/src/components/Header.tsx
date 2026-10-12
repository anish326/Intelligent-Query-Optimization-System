import React from 'react';

interface HeaderProps {
  backendConnected?: boolean | null;
  modelStatus?: unknown;
  isSimulationMode?: boolean;
  onOpenSettings?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenSettings }) => {
  return (
    <header className="app-header">
      <div className="header-brand">
        <h1 className="app-title">Intelligent Query Optimization</h1>
      </div>
      {onOpenSettings && (
        <button
          type="button"
          className="header-settings-btn"
          onClick={onOpenSettings}
          title="Configure API Endpoint"
        >
          API Settings
        </button>
      )}
    </header>
  );
};
