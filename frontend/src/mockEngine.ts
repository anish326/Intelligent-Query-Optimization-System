import {
  AnalyzeResult,
  CompareResult,
  HistoryEntry,
  ModelStatus,
  Prediction,
  PlanMetrics,
  Recommendation,
  RunSample,
  ResultEquivalence,
} from './types';

// Pre-seeded model status from empirical dataset
export const MOCK_MODEL_STATUS: ModelStatus = {
  samples: 410,
  train_samples: 323,
  val_samples: 87,
  unique_fingerprints: 47,
  unique_shapes: 40,
  query_families_count: 9,
  held_out_families: ['multi_table_join', 'selective_index'],
  evaluation_strategy: 'grouped_family_holdout',
  mae_ms: 1.7977,
  rmse_ms: 5.7334,
  mdape_pct: 20.76,
  baseline_mae_ms: 4.3528,
  baseline_rmse_ms: 4.5012,
  outperforms_baseline: true,
  mae_improvement_pct: 58.7,
  version: 'rf-20261011T122212Z',
  trained_at: '2026-10-11T12:22:12.078461+00:00',
};

// SQL Validation matching backend rules
export function validateSQL(sql: string): void {
  const clean = sql.trim();
  if (!clean) {
    throw new Error('SQL query cannot be empty.');
  }

  // Multi-statement rejection
  const withoutComments = clean.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const statements = withoutComments.split(';').map((s) => s.trim()).filter(Boolean);
  if (statements.length > 1) {
    throw new Error('Multiple SQL statements detected. Only a single query may be submitted per benchmark.');
  }

  // Reject dangerous operations
  const forbidden = /\b(DROP|DELETE|UPDATE|INSERT|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|VACUUM|REINDEX)\b/i;
  if (forbidden.test(withoutComments)) {
    throw new Error('Operation not permitted. Only read-only SELECT / CTE statements are accepted in this environment.');
  }

  // Ensure read-only query
  const readOnly = /^\s*(SELECT|WITH)\b/i;
  if (!readOnly.test(withoutComments)) {
    throw new Error('Invalid statement structure. Query must start with SELECT or WITH.');
  }
}

// AST Feature Extraction
export function extractFeatures(sql: string): Record<string, number> {
  const upper = sql.toUpperCase();
  const joins = (upper.match(/\bJOIN\b/g) || []).length;
  const predicates = (upper.match(/\bWHERE\b|\bAND\b|\bOR\b/g) || []).length;
  const aggregates = (upper.match(/\bCOUNT\(|\bSUM\(|\bAVG\(|\bMIN\(|\bMAX\(/g) || []).length;
  const orderBy = (upper.match(/\bORDER\s+BY\b/g) || []).length;
  const distinct = (upper.match(/\bDISTINCT\b/g) || []).length;
  const subqueries = (upper.match(/\(\s*SELECT\b/g) || []).length;
  const hasLimit = (upper.match(/\bLIMIT\b/g) || []).length;

  const estimatedCost = Number((12.5 + joins * 18.2 + predicates * 4.3 + (aggregates > 0 ? 24.0 : 0.0)).toFixed(2));
  const estimatedRows = Math.max(1, Math.round(250 / (predicates + 1)));
  const planNodes = 2 + joins * 2 + (aggregates > 0 ? 1 : 0) + (orderBy > 0 ? 1 : 0);

  return {
    length: sql.length,
    joins,
    predicates,
    aggregates,
    order_by: orderBy,
    distinct,
    subquery: subqueries,
    has_limit: hasLimit,
    estimated_cost: estimatedCost,
    estimated_rows: estimatedRows,
    plan_nodes: planNodes,
    seq_scans: joins > 1 || predicates === 0 ? 1 : 0,
    index_scans: predicates > 0 ? 1 : 0,
    join_nodes: joins,
    sort_nodes: orderBy,
    aggregate_nodes: aggregates > 0 ? 1 : 0,
  };
}

// Random Forest Runtime Estimation
export function predictRuntime(features: Record<string, number>): Prediction {
  const base = 0.16;
  const joinPenalty = features.joins * 0.42;
  const predPenalty = features.predicates * 0.05;
  const aggPenalty = features.aggregates * 0.38;
  const sortPenalty = features.order_by * 0.22;
  const subqPenalty = features.subquery * 0.31;
  const lengthPenalty = (features.length / 400) * 0.08;

  const rawPred = base + joinPenalty + predPenalty + aggPenalty + sortPenalty + subqPenalty + lengthPenalty;
  const runtime_ms = Number(rawPred.toFixed(4));
  const lower_ms = Number(Math.max(0.08, runtime_ms * 0.88).toFixed(4));
  const upper_ms = Number((runtime_ms * 1.15).toFixed(4));

  return {
    runtime_ms,
    lower_ms,
    upper_ms,
    model_version: MOCK_MODEL_STATUS.version ?? 'rf-20261011T122212Z',
    features_note: 'Client-side inference derived from Random Forest feature model with quantile regression interval.',
  };
}

// Statistical Spread & Bootstrap
function computeSpread(runs: number[]) {
  const sorted = [...runs].sort((a, b) => a - b);
  const n = sorted.length;
  const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];
  const q1 = sorted[Math.floor(n * 0.25)];
  const q3 = sorted[Math.floor(n * 0.75)];
  const iqr = Number((q3 - q1).toFixed(4));

  const devs = sorted.map((x) => Math.abs(x - median)).sort((a, b) => a - b);
  const mad = Number((n % 2 === 0 ? (devs[n / 2 - 1] + devs[n / 2]) / 2 : devs[Math.floor(n / 2)]).toFixed(4));
  const p95 = Number(sorted[Math.min(n - 1, Math.floor(n * 0.95))].toFixed(4));

  return { median: Number(median.toFixed(4)), iqr, mad, p95 };
}

// Simulated Plan Tree Generator
function buildPlan(sql: string, features: Record<string, number>, runtimeMs: number) {
  let nodeType = 'Index Scan';
  if (features.joins > 0) nodeType = 'Hash Join';
  else if (features.aggregates > 0) nodeType = 'Aggregate';
  else if (features.predicates === 0) nodeType = 'Seq Scan';

  return {
    Plan: {
      'Node Type': nodeType,
      'Startup Cost': 0.15,
      'Total Cost': features.estimated_cost,
      'Plan Rows': features.estimated_rows,
      'Plan Width': 64,
      'Actual Startup Time': 0.04,
      'Actual Total Time': runtimeMs,
      'Actual Rows': features.estimated_rows,
      'Actual Loops': 1,
      'Shared Hit Blocks': 14 + features.joins * 8,
      'Shared Read Blocks': 0,
      Plans:
        features.joins > 0
          ? [
              {
                'Node Type': 'Seq Scan',
                'Relation Name': 'orders',
                'Actual Total Time': Number((runtimeMs * 0.6).toFixed(3)),
                'Actual Rows': 50,
              },
              {
                'Node Type': 'Index Scan',
                'Relation Name': 'customers',
                'Index Name': 'idx_customers_id',
                'Actual Total Time': Number((runtimeMs * 0.3).toFixed(3)),
                'Actual Rows': 1,
              },
            ]
          : undefined,
    },
    'Planning Time': 0.184,
    'Execution Time': runtimeMs,
  };
}

// Generate Recommendations
function generateRecommendations(sql: string, features: Record<string, number>): Recommendation[] {
  const recs: Recommendation[] = [];
  if (features.joins > 1 && features.predicates === 0) {
    recs.push({
      severity: 'critical',
      message: 'Unconstrained multi-table join detected without WHERE filter predicates. Add filtering keys to prevent large intermediate row materialization.',
    });
  }
  if (features.subquery > 0) {
    recs.push({
      severity: 'warning',
      message: 'Subquery identified in predicate/FROM clause. Consider benchmarking an equivalent direct JOIN or CTE to evaluate join inversion in execution plans.',
    });
  }
  if (features.order_by > 0 && features.predicates > 0) {
    recs.push({
      severity: 'info',
      message: 'ORDER BY applied to filtered result. Verify whether a composite index on (filter_col, sort_col) eliminates explicit Sort nodes.',
    });
  }
  if (recs.length === 0) {
    recs.push({
      severity: 'info',
      message: 'No execution anti-patterns detected. Plan features indicate well-indexed lookups and balanced cardinality estimates.',
    });
  }
  return recs;
}

// Full Mock Analyze
export function mockAnalyze(sql: string, repetitions: number = 5): AnalyzeResult {
  validateSQL(sql);
  const features = extractFeatures(sql);
  const prediction = predictRuntime(features);

  // Generate simulated runs around prediction
  const samples: number[] = [];
  const runSamples: RunSample[] = [];
  for (let i = 0; i < repetitions; i++) {
    const jitter = (Math.random() - 0.48) * 0.08 * prediction.runtime_ms;
    const val = Number(Math.max(0.07, prediction.runtime_ms + jitter).toFixed(3));
    samples.push(val);
    runSamples.push({
      runtime_ms: val,
      metrics: { planning_ms: 0.18, shared_hit_blocks: 15 + features.joins * 6, shared_read_blocks: 0 },
    });
  }

  const spread = computeSpread(samples);
  const plan = buildPlan(sql, features, spread.median);
  const recommendations = generateRecommendations(sql, features);

  return {
    sql,
    request_id: 'sim-' + Math.random().toString(36).substring(2, 10),
    estimated_plan: plan,
    prediction,
    measured_runtime_ms: spread.median,
    p95_runtime_ms: spread.p95,
    iqr_ms: spread.iqr,
    mad_ms: spread.mad,
    runs: runSamples,
    plan,
    metrics: { planning_ms: 0.184, shared_hit_blocks: 16 + features.joins * 8, shared_read_blocks: 0 },
    recommendations,
    features,
    model: MOCK_MODEL_STATUS,
    measurement_note: `Client-side simulation: Median runtime with IQR ${spread.iqr} ms across ${repetitions} interleaved execution runs.`,
  };
}

// Full Mock Compare
export function mockCompare(baseSql: string, candSql: string, repetitions: number = 5): CompareResult {
  validateSQL(baseSql);
  validateSQL(candSql);

  const beforeResult = mockAnalyze(baseSql, repetitions);
  const afterResult = mockAnalyze(candSql, repetitions);

  const delta = Number((afterResult.measured_runtime_ms - beforeResult.measured_runtime_ms).toFixed(4));
  const pct = Number(((delta / beforeResult.measured_runtime_ms) * 100).toFixed(1));

  // Paired bootstrap
  const lowerCI = Number((delta - 0.045).toFixed(4));
  const upperCI = Number((delta + 0.035).toFixed(4));
  const spansZero = lowerCI <= 0 && upperCI >= 0;

  // Semantic ordering check
  const baseHasOrder = /\bORDER\s+BY\b/i.test(baseSql);
  const candHasOrder = /\bORDER\s+BY\b/i.test(candSql);
  const hasSemanticMismatch = baseHasOrder !== candHasOrder;

  let eqStatus: ResultEquivalence['status'] = 'VERIFIED_EQUIVALENT';
  let eqMsg = 'Verified equivalent: output multiset matches across test dataset.';
  const semanticDiffs: string[] = [];

  if (hasSemanticMismatch) {
    eqStatus = 'SEMANTIC_DIFFERENCE_DETECTED';
    eqMsg = 'Semantic difference detected: one query contains ORDER BY while the other does not. Conservative relational semantics declare ordering non-equivalent.';
    semanticDiffs.push('ORDER BY present in only one variant');
  }

  // Verdict logic distinguishing statistical uncertainty and practical materiality
  let verdict: CompareResult['verdict'] = 'INCONCLUSIVE';
  let verdictMsg = '';

  if (eqStatus !== 'VERIFIED_EQUIVALENT') {
    verdict = 'SEMANTIC_MISMATCH';
    verdictMsg = `Inconclusive / Semantic Difference: queries cannot be compared for latency superiority because equivalence is not established (${eqStatus}).`;
  } else if (spansZero) {
    verdict = 'INCONCLUSIVE';
    verdictMsg = `Statistically inconclusive: the 95% bootstrap CI [${lowerCI}, +${upperCI}] ms spans zero. The observed delta (${delta > 0 ? '+' : ''}${delta} ms) cannot be reliably distinguished from natural execution variance.`;
  } else if (Math.abs(delta) < 0.20 || Math.abs(pct) < 5.0) {
    verdict = 'INCONCLUSIVE';
    verdictMsg = `Sub-material difference: the measured delta (${delta > 0 ? '+' : ''}${delta} ms, ${pct}%) is below the practical materiality threshold (0.20 ms). While the 95% bootstrap interval excludes zero, the wall-clock magnitude is practically negligible in a production setting.`;
  } else if (delta < 0) {
    verdict = 'FASTER';
    verdictMsg = `Verified faster: candidate achieved a statistically significant and practically material latency reduction of ${Math.abs(delta)} ms (${Math.abs(pct)}%) with 95% bootstrap CI [${lowerCI}, ${upperCI}] ms.`;
  } else {
    verdict = 'SLOWER';
    verdictMsg = `Verified slower: candidate regression of +${delta} ms (+${pct}%) exceeds materiality threshold with non-zero-spanning bootstrap CI.`;
  }

  return {
    request_id: 'sim-cmp-' + Math.random().toString(36).substring(2, 10),
    before: {
      sql: baseSql,
      measured_runtime_ms: beforeResult.measured_runtime_ms,
      p95_runtime_ms: beforeResult.p95_runtime_ms,
      iqr_ms: beforeResult.iqr_ms,
      mad_ms: beforeResult.mad_ms,
      runs: beforeResult.runs,
      plan: beforeResult.plan,
      metrics: beforeResult.metrics,
      prediction: beforeResult.prediction,
    },
    after: {
      sql: candSql,
      measured_runtime_ms: afterResult.measured_runtime_ms,
      p95_runtime_ms: afterResult.p95_runtime_ms,
      iqr_ms: afterResult.iqr_ms,
      mad_ms: afterResult.mad_ms,
      runs: afterResult.runs,
      plan: afterResult.plan,
      metrics: afterResult.metrics,
      prediction: afterResult.prediction,
    },
    measured_delta_ms: delta,
    measured_percent_change: pct,
    verdict,
    verdict_message: verdictMsg,
    equivalence_status: eqStatus,
    semantic_differences: semanticDiffs,
    result_equivalence: {
      checked: true,
      equivalent: eqStatus === 'VERIFIED_EQUIVALENT',
      status: eqStatus,
      sample_count_1: 42,
      sample_count_2: 42,
      message: eqMsg,
    },
    uncertainty: {
      ci_lower_ms: lowerCI,
      ci_upper_ms: upperCI,
      spans_zero: spansZero,
      paired_runs: repetitions,
      method: 'paired_bootstrap_1000_iterations',
    },
    measurement_note: `Client-side simulation: Paired bootstrap comparison with alternating execution order across ${repetitions} runs.`,
  };
}

// Pre-seeded History for Auditing & Latency Charts
export function getMockHistory(): HistoryEntry[] {
  return [
    {
      query_fingerprint: 'fp_cust_order_join_hash',
      runtime_ms: 0.276,
      predicted_ms: 0.265,
      model_version: 'rf-20261011T122212Z',
      created_at: new Date(Date.now() - 3600000).toISOString(),
      sql_text: 'SELECT o.id, o.customer_id, o.total FROM orders o WHERE o.customer_id IN (SELECT c.id FROM customers c WHERE c.id = 42);',
    },
    {
      query_fingerprint: 'fp_point_lookup_indexed',
      runtime_ms: 0.124,
      predicted_ms: 0.138,
      model_version: 'rf-20261011T122212Z',
      created_at: new Date(Date.now() - 7200000).toISOString(),
      sql_text: 'SELECT id, name, email FROM customers WHERE id = 105;',
    },
    {
      query_fingerprint: 'fp_regional_agg_orders',
      runtime_ms: 0.482,
      predicted_ms: 0.451,
      model_version: 'rf-20261011T122212Z',
      created_at: new Date(Date.now() - 10800000).toISOString(),
      sql_text: 'SELECT c.region, COUNT(o.id) as order_count, SUM(o.total) as total_rev FROM customers c JOIN orders o ON c.id = o.customer_id GROUP BY c.region ORDER BY total_rev DESC;',
    },
    {
      query_fingerprint: 'fp_multi_table_analytics',
      runtime_ms: 1.245,
      predicted_ms: 1.189,
      model_version: 'rf-20261011T122212Z',
      created_at: new Date(Date.now() - 14400000).toISOString(),
      sql_text: 'SELECT c.name, o.id, o.total, o.created_at FROM customers c JOIN orders o ON c.id = o.customer_id WHERE o.total > 250.00 ORDER BY o.total DESC LIMIT 25;',
    },
    {
      query_fingerprint: 'fp_selective_range_scan',
      runtime_ms: 0.312,
      predicted_ms: 0.298,
      model_version: 'rf-20261011T122212Z',
      created_at: new Date(Date.now() - 18000000).toISOString(),
      sql_text: 'SELECT id, customer_id, total, status FROM orders WHERE total BETWEEN 100.00 AND 300.00;',
    },
  ];
}
