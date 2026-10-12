import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

import {
  AnalyzeResult,
  CompareResult,
  DatabaseOption,
  HistoryEntry,
  ModelStatus,
  ToastMessage,
} from './types';

import { Header } from './components/Header';
import { QueryWorkspace, QUERY_EXAMPLES } from './components/QueryWorkspace';
import { MetricsPanel } from './components/MetricsPanel';
import { ChartsSection } from './components/ChartsSection';
import { ModelIntelligence } from './components/ModelIntelligence';
import { PlanDetails } from './components/PlanDetails';
import { ComparisonPanel } from './components/ComparisonPanel';
import { HistorySection } from './components/HistorySection';
import { ToastContainer } from './components/Toast';
import {
  mockAnalyze,
  mockCompare,
  getMockHistory,
  MOCK_MODEL_STATUS,
} from './mockEngine';

const getInitialApiBase = () => {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('QUERYOPT_API_URL');
    if (stored !== null) return stored.trim();
  }
  const envUrl = ((import.meta as any).env?.VITE_API_BASE as string | undefined)?.trim();
  if (envUrl) return envUrl.replace(/\/$/, '');
  if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
    return ''; // On HTTPS deployments (e.g. Vercel), don't attempt mixed-content calls to localhost
  }
  return 'http://localhost:8000';
};

type ActiveTab = 'analyzer' | 'charts' | 'compare' | 'plan' | 'model' | 'history';

function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('analyzer');

  const [apiUrl, setApiUrl] = useState<string>(getInitialApiBase);
  const [tempApiUrl, setTempApiUrl] = useState<string>(apiUrl);
  const [showApiModal, setShowApiModal] = useState<boolean>(false);
  const [isSimulationMode, setIsSimulationMode] = useState<boolean>(!apiUrl);

  const [sql, setSql] = useState<string>(QUERY_EXAMPLES[0].sql);
  const [candidateSql, setCandidateSql] = useState<string>(QUERY_EXAMPLES[0].comparisonSql || '');
  const [repetitions, setRepetitions] = useState<number>(5);
  const [databases, setDatabases] = useState<DatabaseOption[]>([]);
  const [selectedDb, setSelectedDb] = useState<string>('queryopt');

  const [backendConnected, setBackendConnected] = useState<boolean | null>(null);
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);

  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [comparison, setComparison] = useState<CompareResult | null>(null);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);

  const [loading, setLoading] = useState<boolean>(false);
  const [loadingStage, setLoadingStage] = useState<string>('');
  const [training, setTraining] = useState<boolean>(false);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((type: 'success' | 'error' | 'info', title: string, description?: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    setToasts((prev) => [...prev, { id, type, title, description }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Generic API Client with Transparent In-Browser Simulation Fallback
  const apiCall = useCallback(
    async (path: string, method: 'GET' | 'POST' = 'POST', body?: unknown) => {
      if (apiUrl) {
        try {
          const options: RequestInit = {
            method,
            headers: { 'Content-Type': 'application/json' },
          };
          if (body !== undefined && method === 'POST') {
            options.body = JSON.stringify(body);
          }
          const response = await fetch(`${apiUrl}${path}`, options);
          const data = await response.json();
          if (!response.ok) {
            throw new Error(data.detail || data.message || `Request to ${path} failed (${response.status})`);
          }
          setIsSimulationMode(false);
          setBackendConnected(true);
          return data;
        } catch (fetchErr: any) {
          // If the server answered with an error message (like 400 Bad SQL), throw it
          if (
            fetchErr.message &&
            !fetchErr.message.includes('Failed to fetch') &&
            !fetchErr.message.includes('NetworkError') &&
            !fetchErr.message.includes('Load failed')
          ) {
            throw fetchErr;
          }
          console.warn(
            `[QueryOptimizer] Live backend at ${apiUrl} unreachable; falling back to In-Browser Engine.`,
            fetchErr
          );
        }
      }

      // In-Browser Engine Fallback for Cloud / Vercel Previews
      setIsSimulationMode(true);
      setBackendConnected(true);
      await new Promise((r) => setTimeout(r, 100));

      if (path === '/health') {
        return { ok: true, model: MOCK_MODEL_STATUS };
      }
      if (path === '/databases') {
        return {
          databases: [
            { id: 'queryopt', label: 'queryopt (PostgreSQL 16 - In-Browser Engine)' },
            { id: 'analytics_bench', label: 'analytics_bench (Simulation)' },
          ],
        };
      }
      if (path.startsWith('/history')) {
        return getMockHistory();
      }
      if (path === '/analyze') {
        const payload = (body as any) || {};
        return mockAnalyze(payload.sql, payload.repetitions || 5);
      }
      if (path === '/compare') {
        const payload = (body as any) || {};
        return mockCompare(payload.before_sql, payload.after_sql, payload.repetitions || 5);
      }
      if (path === '/model/train') {
        return {
          ok: true,
          message: 'Model simulated retraining completed on in-browser dataset.',
          model: MOCK_MODEL_STATUS,
        };
      }

      throw new Error(`Endpoint ${path} is not supported in simulation mode.`);
    },
    [apiUrl]
  );

  // Poll Health & Model Metadata
  const refreshHealth = useCallback(async () => {
    try {
      const data = await apiCall('/health', 'GET');
      if (data?.model) {
        setModelStatus(data.model);
      }
    } catch {
      setModelStatus(MOCK_MODEL_STATUS);
    }
  }, [apiCall]);

  // Load Databases Options
  const loadDatabases = useCallback(async () => {
    try {
      const data = await apiCall('/databases', 'GET');
      if (Array.isArray(data?.databases)) {
        const formatted = data.databases.map((db: any) =>
          typeof db === 'string' ? { id: db, label: db } : db
        );
        setDatabases(formatted);
      }
    } catch {
      setDatabases([{ id: 'queryopt', label: 'queryopt (PostgreSQL 16)' }]);
    }
  }, [apiCall]);

  // Load Execution History
  const loadHistory = useCallback(async () => {
    try {
      setHistoryLoading(true);
      const data = await apiCall('/history?limit=30', 'GET');
      if (Array.isArray(data)) {
        setHistoryEntries(data);
      } else if (Array.isArray(data?.history)) {
        setHistoryEntries(data.history);
      } else {
        setHistoryEntries(getMockHistory());
      }
    } catch {
      setHistoryEntries(getMockHistory());
    } finally {
      setHistoryLoading(false);
    }
  }, [apiCall]);

  useEffect(() => {
    refreshHealth();
    loadDatabases();
    loadHistory();
  }, [refreshHealth, loadDatabases, loadHistory]);

  // Execute Measure & Analyze
  const handleAnalyze = async () => {
    if (!sql.trim()) {
      setError('Please provide a valid SELECT or WITH query.');
      return;
    }

    setLoading(true);
    setLoadingStage(`Executing 1 warm-up run + ${repetitions} measured runs...`);
    setError(null);

    try {
      const data = await apiCall('/analyze', 'POST', {
        sql: sql.trim(),
        repetitions,
        warmups: 1,
      });

      const normalizedResult: AnalyzeResult = {
        sql: data.sql,
        request_id: data.request_id,
        estimated_plan: data.estimated_plan ?? {},
        prediction: data.prediction ?? null,
        measured_runtime_ms: Number(data.measured_runtime_ms ?? 0),
        p95_runtime_ms: Number(data.p95_runtime_ms ?? data.measured_runtime_ms ?? 0),
        runs: Array.isArray(data.runs) ? data.runs : [],
        plan: data.plan ?? {},
        metrics: data.metrics ?? {},
        recommendations: Array.isArray(data.recommendations) ? data.recommendations : [],
        features: data.features ?? {},
        model: data.model ?? MOCK_MODEL_STATUS,
        measurement_note: data.measurement_note ?? 'Benchmark completed.',
      };

      setResult(normalizedResult);
      if (data.model) {
        setModelStatus(data.model);
      }
      addToast(
        'success',
        'Analysis Completed',
        `Median: ${normalizedResult.measured_runtime_ms.toFixed(3)} ms (P95: ${normalizedResult.p95_runtime_ms.toFixed(3)} ms)`
      );
      loadHistory();
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : 'Execution failed';
      setError(msg);
      addToast('error', 'Query Rejected', msg);
    } finally {
      setLoading(false);
      setLoadingStage('');
    }
  };

  // Execute Side-by-Side Comparison
  const handleCompare = async () => {
    if (!sql.trim() || !candidateSql.trim()) {
      setError('Both baseline and revised candidate queries are required for comparison.');
      return;
    }

    setLoading(true);
    setLoadingStage(`Benchmarking baseline and revised queries (${repetitions} runs each)...`);
    setError(null);

    try {
      const data = await apiCall('/compare', 'POST', {
        before_sql: sql.trim(),
        after_sql: candidateSql.trim(),
        repetitions,
        warmups: 1,
      });

      setComparison(data);
      addToast(
        'info',
        'Comparison Completed',
        `Latency delta: ${data.measured_delta_ms > 0 ? '+' : ''}${data.measured_delta_ms.toFixed(3)} ms`
      );
      loadHistory();
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : 'Comparison failed';
      setError(msg);
      addToast('error', 'Comparison Failed', msg);
    } finally {
      setLoading(false);
      setLoadingStage('');
    }
  };

  // Retrain Random Forest Model
  const handleTrainModel = async () => {
    setTraining(true);
    try {
      const data = await apiCall('/model/train', 'POST');
      if (data?.model) {
        setModelStatus(data.model);
      }
      addToast(
        'success',
        'Model Retrained',
        `Evaluated across ${data?.model?.samples ?? 410} queries. Holdout MAE: ${data?.model?.mae_ms?.toFixed(3) ?? '1.798'} ms`
      );
    } catch (err: any) {
      addToast('error', 'Training Failed', err?.message || 'Retraining error');
    } finally {
      setTraining(false);
    }
  };

  return (
    <div className="app-shell">
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      <Header
        backendConnected={backendConnected}
        modelStatus={modelStatus}
        isSimulationMode={isSimulationMode}
        onOpenSettings={() => {
          setTempApiUrl(apiUrl);
          setShowApiModal(true);
        }}
      />

      {/* Navigation Tabs */}
      <nav className="tab-nav-container" aria-label="Dashboard views">
        <div className="tab-nav-list" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'analyzer'}
            className={`tab-nav-btn ${activeTab === 'analyzer' ? 'active' : ''}`}
            onClick={() => setActiveTab('analyzer')}
          >
            <span className="tab-icon">⚡</span>
            <span>Query Analyzer</span>
            {result && <span className="tab-pill-badge">{result.measured_runtime_ms.toFixed(2)} ms</span>}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'charts'}
            className={`tab-nav-btn ${activeTab === 'charts' ? 'active' : ''}`}
            onClick={() => setActiveTab('charts')}
          >
            <span className="tab-icon">📈</span>
            <span>Latency Charts</span>
            {result && <span className="tab-status-dot"></span>}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'compare'}
            className={`tab-nav-btn ${activeTab === 'compare' ? 'active' : ''}`}
            onClick={() => setActiveTab('compare')}
          >
            <span className="tab-icon">⚖️</span>
            <span>Compare Rewrites</span>
            {comparison && (
              <span className="tab-pill-badge delta-badge">
                {comparison.measured_delta_ms > 0 ? '+' : ''}
                {comparison.measured_delta_ms.toFixed(1)}ms
              </span>
            )}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'plan'}
            className={`tab-nav-btn ${activeTab === 'plan' ? 'active' : ''}`}
            onClick={() => setActiveTab('plan')}
          >
            <span className="tab-icon">🔍</span>
            <span>Execution Plan</span>
            {result?.plan && <span className="tab-status-dot"></span>}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'model'}
            className={`tab-nav-btn ${activeTab === 'model' ? 'active' : ''}`}
            onClick={() => setActiveTab('model')}
          >
            <span className="tab-icon">🤖</span>
            <span>ML Intelligence</span>
            {modelStatus?.samples ? <span className="tab-pill-badge">{modelStatus.samples} samples</span> : null}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'history'}
            className={`tab-nav-btn ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            <span className="tab-icon">📜</span>
            <span>Audit History</span>
            <span className="tab-pill-badge">{historyEntries.length}</span>
          </button>
        </div>
      </nav>

      <main className="main-content">
        {/* Tab 1: Query Analyzer */}
        {activeTab === 'analyzer' && (
          <section className="tab-panel workspace-grid">
            <div className="grid-left-pane">
              <QueryWorkspace
                databases={databases}
                selectedDb={selectedDb}
                onSelectDb={setSelectedDb}
                sql={sql}
                onSqlChange={setSql}
                repetitions={repetitions}
                onRepetitionsChange={setRepetitions}
                onAnalyze={handleAnalyze}
                loading={loading}
                loadingStage={loadingStage}
                error={error}
                onClearError={() => setError(null)}
                onOpenCompare={() => setActiveTab('compare')}
              />
            </div>

            <div className="grid-right-pane">
              <MetricsPanel
                result={result}
                loading={loading}
                onOpenCharts={() => setActiveTab('charts')}
                onOpenPlan={() => setActiveTab('plan')}
              />
            </div>
          </section>
        )}

        {/* Tab 2: Latency Charts */}
        {activeTab === 'charts' && (
          <section className="tab-panel">
            <ChartsSection
              result={result}
              historyEntries={historyEntries}
              onNavigateToAnalyzer={() => setActiveTab('analyzer')}
            />
          </section>
        )}

        {/* Tab 3: Compare Rewrites */}
        {activeTab === 'compare' && (
          <section className="tab-panel">
            <ComparisonPanel
              baselineSql={sql}
              onBaselineSqlChange={setSql}
              candidateSql={candidateSql}
              onCandidateSqlChange={setCandidateSql}
              comparison={comparison}
              repetitions={repetitions}
              onRepetitionsChange={setRepetitions}
              onCompare={handleCompare}
              loading={loading}
            />
          </section>
        )}

        {/* Tab 4: Execution Plan */}
        {activeTab === 'plan' && (
          <section className="tab-panel">
            <PlanDetails
              plan={result?.plan ?? null}
              onCopySuccess={() => addToast('success', 'Plan JSON Copied', 'Plan JSON copied to clipboard.')}
              onNavigateToAnalyzer={() => setActiveTab('analyzer')}
            />
          </section>
        )}

        {/* Tab 5: ML Intelligence */}
        {activeTab === 'model' && (
          <section className="tab-panel">
            <ModelIntelligence
              modelStatus={modelStatus}
              prediction={result?.prediction ?? null}
              features={result?.features}
              actualRuntimeMs={result?.measured_runtime_ms}
              onTrain={handleTrainModel}
              training={training}
            />
          </section>
        )}

        {/* Tab 6: Audit History */}
        {activeTab === 'history' && (
          <section className="tab-panel">
            <HistorySection
              entries={historyEntries}
              loading={historyLoading}
              onRefresh={loadHistory}
              onSelectQuery={(historySql) => {
                setSql(historySql);
                setActiveTab('analyzer');
                addToast('info', 'Query Loaded', 'Loaded query from history into the SQL workspace.');
              }}
            />
          </section>
        )}
      </main>

      {/* API Endpoint & Backend Settings Modal */}
      {showApiModal && (
        <div className="modal-overlay" onClick={() => setShowApiModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Database &amp; API Endpoint Settings</h3>
              <button className="modal-close" onClick={() => setShowApiModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p className="modal-desc">
                Active Execution Mode:{' '}
                <strong>
                  {isSimulationMode ? '🟣 In-Browser Simulation Engine' : '🟢 Live PostgreSQL 16 Backend'}
                </strong>
              </p>
              <label className="modal-label">Backend API URL:</label>
              <input
                type="text"
                className="modal-input"
                value={tempApiUrl}
                placeholder="e.g. http://localhost:8000 or https://your-backend.onrender.com"
                onChange={(e) => setTempApiUrl(e.target.value)}
              />
              <p className="modal-hint">
                When running locally with Docker Compose, enter <code>http://localhost:8000</code>. When deployed on Vercel without a cloud backend, leave empty to use the In-Browser Simulation Engine.
              </p>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  localStorage.removeItem('QUERYOPT_API_URL');
                  setApiUrl((import.meta as any).env?.DEV ? 'http://localhost:8000' : '');
                  setShowApiModal(false);
                }}
              >
                Reset Default
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  const clean = tempApiUrl.trim().replace(/\/$/, '');
                  if (clean) {
                    localStorage.setItem('QUERYOPT_API_URL', clean);
                  } else {
                    localStorage.removeItem('QUERYOPT_API_URL');
                  }
                  setApiUrl(clean);
                  setShowApiModal(false);
                  refreshHealth();
                }}
              >
                Save &amp; Connect
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <p className="footer-tagline">
            Intelligent Query Optimization in Modern Database Systems &bull; PostgreSQL 16 EXPLAIN ANALYZE &amp; ML Regression
          </p>
          <p className="footer-meta">
            Read-only role <code>query_reader</code> &bull; Statement timeout 5000ms &bull; Clean Modular Architecture
          </p>
        </div>
      </footer>
    </div>
  );
}

// Error Boundary
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  state: { hasError: boolean; error: Error | null } = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="app-shell error-recovery-screen">
          <div className="card error-card">
            <h2>⚠️ Dashboard Rendering Error</h2>
            <p className="error-msg">{this.state.error?.message || 'An unexpected rendering error occurred.'}</p>
            <button className="btn btn-primary" onClick={() => window.location.reload()}>
              ↻ Reload Application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
