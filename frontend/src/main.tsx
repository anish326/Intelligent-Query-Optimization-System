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

const API_BASE = ((import.meta as any).env?.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || 'http://localhost:8000';

type ActiveTab = 'analyzer' | 'charts' | 'compare' | 'plan' | 'model' | 'history';

function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('analyzer');

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

  // Generic API Client
  const apiCall = useCallback(async (path: string, method: 'GET' | 'POST' = 'POST', body?: unknown) => {
    const options: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body !== undefined && method === 'POST') {
      options.body = JSON.stringify(body);
    }
    const response = await fetch(`${API_BASE}${path}`, options);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || data.message || `Request to ${path} failed (${response.status})`);
    }
    return data;
  }, []);

  // Poll Health & Model Metadata
  const refreshHealth = useCallback(async () => {
    try {
      const data = await apiCall('/health', 'GET');
      setBackendConnected(true);
      if (data?.model) {
        setModelStatus(data.model);
      }
    } catch {
      setBackendConnected(false);
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
        if (formatted.length > 0) {
          setSelectedDb(formatted[0].id);
        }
      }
    } catch {
      setDatabases([{ id: 'queryopt', label: 'queryopt (PostgreSQL 16)' }]);
    }
  }, [apiCall]);

  // Load Query History
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const data = await apiCall('/history?limit=30', 'GET');
      if (Array.isArray(data?.entries)) {
        setHistoryEntries(data.entries);
      }
    } catch {
      // Silent catch
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
        model: data.model ?? { samples: 0, mae_ms: null, version: null },
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

  // Train ML Random Forest Regressor
  const handleTrainModel = async () => {
    setTraining(true);
    try {
      const data = await apiCall('/model/train', 'POST', {});
      setModelStatus(data);
      const maeInfo = data.mae_ms != null ? `${Number(data.mae_ms).toFixed(3)} ms` : 'N/A';
      addToast(
        'success',
        `Model Trained: ${data.version || 'Persisted'}`,
        `Trained on ${data.samples} executions. Chronological holdout MAE: ${maeInfo}.`
      );
      refreshHealth();
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : 'Training failed';
      addToast('error', 'Training Failed', msg);
    } finally {
      setTraining(false);
    }
  };

  return (
    <div className="app-shell">
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      <Header backendConnected={backendConnected} modelStatus={modelStatus} />

      {/* Main Tab Navigation Bar */}
      <nav className="tab-navigation-bar" role="tablist" aria-label="Dashboard views">
        <div className="nav-container">
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
            {comparison && <span className="tab-pill-badge delta-badge">{comparison.measured_delta_ms > 0 ? '+' : ''}{comparison.measured_delta_ms.toFixed(1)}ms</span>}
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
        {/* Tab 1: Query Analyzer (Workspace + Instant Metrics & Insights) */}
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
