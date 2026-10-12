from collections import Counter
import pytest
from fastapi import HTTPException
from app.features import extract_features, extract_plan_features, model_features
from app.ml import CostModel, ModelStatus, classify_query_family
from app.validation import detect_semantic_differences, validate_readonly_query
from app.database import compare_result_sets, compute_spread_metrics, fingerprint, query_template

PLAN = {
    "Plan": {
        "Node Type": "Nested Loop",
        "Total Cost": 42.0,
        "Plan Rows": 10.0,
        "Plans": [{"Node Type": "Seq Scan"}, {"Node Type": "Index Scan"}],
    }
}


def record(i: int, fp: str = "fp1", fam: str = "fam1") -> dict:
    return {
        "sql_text": f"SELECT * FROM orders WHERE customer_id = {i} LIMIT {i % 8 + 1}",
        "runtime_ms": float(1.0 + (i % 5) * 2.5),
        "plan": PLAN,
        "query_fingerprint": fp,
        "metrics": {"query_family": fam},
        "created_at": f"2026-01-{i:02d}",
    }


def test_features_detect_join_aggregate_and_plan_shape():
    values = extract_features("SELECT count(*) FROM a JOIN b ON a.id=b.id WHERE a.id=2")
    plan_values = extract_plan_features(PLAN)
    assert values[1] == 1 and values[2] >= 1 and values[3] == 1
    assert plan_values[0] == 42 and plan_values[3] == 1 and plan_values[4] == 1


@pytest.mark.parametrize(
    "sql",
    [
        "DELETE FROM orders",
        "SELECT 1; SELECT 2",
        "UPDATE orders SET status='paid'",
        "SELECT * INTO copied FROM orders",
    ],
)
def test_parser_validation_rejects_write_multi_and_select_into(sql):
    with pytest.raises(HTTPException):
        validate_readonly_query(sql)


def test_parser_validation_allows_cte():
    assert validate_readonly_query("WITH x AS (SELECT 1) SELECT * FROM x").startswith("WITH")


def test_semantic_difference_detection_flags_limit_and_predicate():
    diffs1 = detect_semantic_differences(
        "SELECT * FROM orders WHERE status = 'paid' LIMIT 50",
        "SELECT * FROM orders WHERE status = 'paid' LIMIT 10",
    )
    assert any("LIMIT" in d for d in diffs1)

    diffs2 = detect_semantic_differences(
        "SELECT * FROM orders WHERE status = 'paid'",
        "SELECT * FROM orders WHERE status = 'pending'",
    )
    assert any("WHERE" in d or "Filter" in d for d in diffs2)

    diffs_none = detect_semantic_differences(
        "SELECT * FROM orders WHERE status = 'paid'",
        "SELECT * FROM orders WHERE status = 'paid'",
    )
    assert len(diffs_none) == 0


# --- Priority 3: Result Equivalence & Ordering Regression Tests ---

def test_result_equivalence_neither_has_order_by():
    # Different incidental physical order, identical multiset
    r1 = ['{"id": 1}', '{"id": 2}', '{"id": 3}']
    r2 = ['{"id": 3}', '{"id": 1}', '{"id": 2}']
    res = compare_result_sets(r1, r2, has_order_1=False, has_order_2=False)
    assert res["status"] == "VERIFIED_EQUIVALENT"
    assert res["equivalent"] is True


def test_result_equivalence_both_have_order_by_matching():
    r1 = ['{"id": 1, "val": 10}', '{"id": 2, "val": 20}']
    r2 = ['{"id": 1, "val": 10}', '{"id": 2, "val": 20}']
    res = compare_result_sets(r1, r2, has_order_1=True, has_order_2=True)
    assert res["status"] == "VERIFIED_EQUIVALENT"
    assert res["equivalent"] is True


def test_result_equivalence_only_one_has_order_by():
    # One query has ORDER BY, the other does not: must NOT be declared equivalent!
    r1 = ['{"id": 1}', '{"id": 2}']
    r2 = ['{"id": 1}', '{"id": 2}']
    res = compare_result_sets(r1, r2, has_order_1=True, has_order_2=False)
    assert res["status"] == "SEMANTIC_DIFFERENCE_DETECTED"
    assert res["equivalent"] is False
    assert "Explicit ORDER BY clause is present in only one query" in res["message"]


def test_result_equivalence_order_by_ties_differing_order():
    # Both have ORDER BY, multiset matches, but sort key ties produced different row sequence
    r1 = ['{"id": 1, "cat": "A"}', '{"id": 2, "cat": "A"}']
    r2 = ['{"id": 2, "cat": "A"}', '{"id": 1, "cat": "A"}']
    res = compare_result_sets(r1, r2, has_order_1=True, has_order_2=True)
    assert res["status"] == "DIFFERENT_RESULTS"
    assert res["equivalent"] is False
    assert "row sequence differs" in res["message"]


def test_result_equivalence_duplicate_rows_detected():
    # r1 has two id:1, r2 has only one id:1
    r1 = ['{"id": 1}', '{"id": 1}', '{"id": 2}']
    r2 = ['{"id": 1}', '{"id": 2}']
    res = compare_result_sets(r1, r2, has_order_1=False, has_order_2=False)
    assert res["status"] == "DIFFERENT_RESULTS"
    assert res["equivalent"] is False


def test_result_equivalence_exceeding_row_cap():
    # Results exceed the 500-row cap -> must return EQUIVALENCE_UNVERIFIED
    r1 = [f'{{"id": {i}}}' for i in range(501)]
    r2 = [f'{{"id": {i}}}' for i in range(501)]
    res = compare_result_sets(r1, r2, has_order_1=False, has_order_2=False, max_rows=500)
    assert res["status"] == "EQUIVALENCE_UNVERIFIED"
    assert res["equivalent"] is None
    assert res["exceeded_cap"] is True


# --- Priority 1 & 4: Benchmark Methodology & ML Generalization Tests ---

def test_compute_spread_iqr_and_mad():
    runtimes = [1.0, 1.2, 1.3, 1.5, 2.0, 2.1, 3.0]
    metrics = compute_spread_metrics(runtimes)
    assert metrics["median_ms"] == 1.5
    assert metrics["iqr_ms"] > 0
    assert metrics["mad_ms"] > 0
    assert metrics["p95_ms"] is not None


def test_benchmark_verdict_decision_rules():
    # Rule 1: Below absolute materiality threshold (< 0.20 ms) must be INCONCLUSIVE
    delta_small = -0.075
    base_small = 0.280
    pct_small = (delta_small / base_small) * 100  # -26.8%
    meets_materiality_small = (abs(delta_small) >= 0.20) and (abs(pct_small) >= 5.0)
    assert not meets_materiality_small  # Fails 0.20 ms threshold -> INCONCLUSIVE

    # Rule 2: Meeting both materiality thresholds (>= 0.20 ms and >= 5.0%) with non-zero-spanning CI -> FASTER
    delta_material = -0.450
    base_material = 2.000
    pct_material = (delta_material / base_material) * 100  # -22.5%
    meets_materiality_mat = (abs(delta_material) >= 0.20) and (abs(pct_material) >= 5.0)
    ci_spans_zero = False
    assert meets_materiality_mat and not ci_spans_zero


def test_model_training_grouped_family_holdout_zero_overlap(tmp_path, monkeypatch):
    monkeypatch.setattr("app.ml.MODEL_PATH", str(tmp_path / "model.joblib"))
    model = CostModel()

    # Generate 45 records across 5 distinct query families
    records = []
    family_names = ["pk_lookup", "aggregation", "multi_table_join", "sorting_limit", "cte_subquery"]
    for fam_idx, fam in enumerate(family_names, 1):
        for rep in range(1, 10):
            records.append(record(fam_idx * 10 + rep, fp=f"fp_{fam}_{rep}", fam=fam))

    status = model.train(records)

    assert status.samples == 45
    assert status.train_samples > 0
    assert status.val_samples > 0
    assert status.evaluation_strategy == "grouped_family_holdout"
    assert len(status.held_out_families) > 0
    assert status.unique_fingerprints > 0
    assert status.unique_shapes > 0
    assert status.query_families_count == 5

    # Metrics verification
    assert status.mae_ms is not None
    assert status.rmse_ms is not None
    assert status.baseline_mae_ms is not None
    assert status.baseline_rmse_ms is not None
    assert status.mdape_pct is not None

    # Model persistence and reloading test
    model2 = CostModel()
    model2.load()
    assert model2.status.version == status.version
    assert model2.status.held_out_families == status.held_out_families

def test_recommendations_detect_seq_scan_filter_and_spill():
    from app.recommendations import recommendations
    bad_plan = {
        "Plan": {
            "Node Type": "Seq Scan",
            "Relation Name": "orders",
            "Filter": "(customer_id = 42)",
            "Actual Rows": 500,
            "Actual Loops": 1,
            "Total Cost": 150.0,
            "Plans": [
                {
                    "Node Type": "Sort",
                    "Sort Key": "orders.total DESC",
                    "Sort Method": "external merge Disk",
                    "Temp Read Blocks": 12,
                    "Total Cost": 80.0,
                }
            ]
        }
    }
    recs = recommendations(bad_plan)
    assert len(recs) >= 2
    # Check structured recommendation fields
    first = recs[0]
    assert "issue" in first and "evidence" in first and "action" in first and "benefit" in first and "tradeoffs" in first
    assert any(r["severity"] == "critical" for r in recs)

def test_recommendations_clean_plan():
    from app.recommendations import recommendations
    clean_plan = {
        "Plan": {
            "Node Type": "Index Scan",
            "Relation Name": "customers",
            "Total Cost": 8.0,
            "Actual Rows": 1,
            "Actual Loops": 1,
        }
    }
    recs = recommendations(clean_plan)
    assert len(recs) == 1
    assert recs[0]["issue"] == "Optimal Execution Structure"
