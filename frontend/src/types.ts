export interface ModelStatus {
  samples: number;
  train_samples?: number;
  val_samples?: number;
  unique_groups?: number;
  unique_fingerprints?: number;
  unique_shapes?: number;
  query_families_count?: number;
  held_out_families?: string[];
  evaluation_strategy?: string;
  mae_ms: number | null;
  rmse_ms?: number | null;
  mdape_pct?: number | null;
  baseline_mae_ms?: number | null;
  baseline_rmse_ms?: number | null;
  outperforms_baseline?: boolean | null;
  mae_improvement_pct?: number | null;
  version: string | null;
  trained_at?: string | null;
}

export interface Prediction {
  runtime_ms: number;
  lower_ms?: number;
  upper_ms?: number;
  model_version?: string;
  features_note?: string;
}

export interface PlanMetrics {
  planning_ms?: number;
  shared_hit_blocks?: number;
  shared_read_blocks?: number;
  [key: string]: unknown;
}

export interface Recommendation {
  severity: 'info' | 'warning' | 'critical' | string;
  message: string;
}

export interface RunSample {
  runtime_ms: number;
  plan?: unknown;
  metrics?: PlanMetrics;
}

export interface AnalyzeResult {
  sql: string;
  request_id: string;
  estimated_plan: Record<string, unknown>;
  prediction: Prediction | null;
  measured_runtime_ms: number;
  p95_runtime_ms: number;
  iqr_ms?: number;
  mad_ms?: number;
  runs: RunSample[];
  plan: Record<string, unknown>;
  metrics: PlanMetrics;
  recommendations: Recommendation[];
  features: Record<string, number>;
  model: ModelStatus;
  measurement_note: string;
}

export interface ResultEquivalence {
  checked: boolean;
  equivalent: boolean | null;
  status:
    | 'VERIFIED_EQUIVALENT'
    | 'SEMANTIC_DIFFERENCE_DETECTED'
    | 'DIFFERENT_RESULTS'
    | 'EQUIVALENCE_UNVERIFIED';
  sample_count_1: number | null;
  sample_count_2: number | null;
  exceeded_cap?: boolean;
  max_sample_rows?: number;
  message: string;
}

export interface UncertaintyEstimate {
  ci_lower_ms: number;
  ci_upper_ms: number;
  spans_zero: boolean;
  paired_runs: number;
  method: string;
}

export interface CompareResult {
  request_id: string;
  before: {
    sql?: string;
    measured_runtime_ms: number;
    p95_runtime_ms: number;
    iqr_ms?: number;
    mad_ms?: number;
    runs: RunSample[];
    plan: Record<string, unknown>;
    metrics: PlanMetrics;
    prediction?: Prediction | null;
    estimated_plan?: Record<string, unknown>;
  };
  after: {
    sql?: string;
    measured_runtime_ms: number;
    p95_runtime_ms: number;
    iqr_ms?: number;
    mad_ms?: number;
    runs: RunSample[];
    plan: Record<string, unknown>;
    metrics: PlanMetrics;
    prediction?: Prediction | null;
    estimated_plan?: Record<string, unknown>;
  };
  measured_delta_ms: number;
  measured_percent_change: number | null;
  verdict: 'FASTER' | 'SLOWER' | 'INCONCLUSIVE' | 'SEMANTIC_MISMATCH';
  verdict_message: string;
  equivalence_status:
    | 'VERIFIED_EQUIVALENT'
    | 'SEMANTIC_DIFFERENCE_DETECTED'
    | 'DIFFERENT_RESULTS'
    | 'EQUIVALENCE_UNVERIFIED';
  semantic_differences: string[];
  result_equivalence: ResultEquivalence;
  uncertainty?: UncertaintyEstimate;
  measurement_note: string;
}

export interface HistoryEntry {
  query_fingerprint: string;
  runtime_ms: number;
  predicted_ms: number | null;
  model_version: string | null;
  metrics?: PlanMetrics;
  created_at: string;
  sql_text?: string;
}

export interface DatabaseOption {
  id: string;
  label: string;
  fixed_profile?: boolean;
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  description?: string;
}
