"""Execute reproducible diverse workload across 9 query families to generate measured training history.

All execution times are real EXPLAIN ANALYZE measurements against the PostgreSQL database.
"""
import json
from app.database import connect, execute_once, fingerprint

# 9 Query Families covering essential database access paths and relational operators
WORKLOAD_FAMILIES = [
    # 1. Primary-key lookups (Index Unique Scan)
    {
        "family": "pk_lookup",
        "queries": [
            "SELECT * FROM customers WHERE id = 100",
            "SELECT * FROM customers WHERE id = 1250",
            "SELECT * FROM orders WHERE id = 500",
            "SELECT * FROM orders WHERE id = 12345",
        ],
    },
    # 2. Selective indexed filters (Bitmap / Index Scan on indexed customer_id or status)
    {
        "family": "selective_index",
        "queries": [
            "SELECT * FROM orders WHERE customer_id = 42 ORDER BY created_at DESC",
            "SELECT * FROM orders WHERE customer_id = 150 AND created_at > '2024-01-01'",
            "SELECT * FROM orders WHERE customer_id = 300 AND status = 'paid'",
        ],
    },
    # 3. Non-selective filters (Seq Scan or Bitmap Scan on status/region)
    {
        "family": "non_selective_filter",
        "queries": [
            "SELECT * FROM orders WHERE status = 'paid'",
            "SELECT * FROM orders WHERE status = 'pending'",
            "SELECT * FROM customers WHERE region = 'north'",
            "SELECT * FROM customers WHERE region = 'west'",
        ],
    },
    # 4. Aggregation queries (Aggregate / HashAggregate)
    {
        "family": "aggregation",
        "queries": [
            "SELECT status, count(*), avg(total), min(total), max(total) FROM orders GROUP BY status",
            "SELECT count(*), sum(total), avg(total) FROM orders",
            "SELECT region, count(*) FROM customers GROUP BY region",
        ],
    },
    # 5. Sorting and LIMIT queries (Sort / Top-N Heapsort)
    {
        "family": "sorting_limit",
        "queries": [
            "SELECT * FROM orders ORDER BY total DESC LIMIT 20",
            "SELECT * FROM orders ORDER BY created_at DESC LIMIT 50",
            "SELECT * FROM customers ORDER BY created_at ASC LIMIT 30",
        ],
    },
    # 6. Single-table scans (Sequential Scan with transformations)
    {
        "family": "single_table_scan",
        "queries": [
            "SELECT id, name, region FROM customers WHERE region != 'unknown'",
            "SELECT id, customer_id, total, round(total * 1.05, 2) AS total_with_tax FROM orders WHERE total > 200",
        ],
    },
    # 7. Multi-table joins (Nested Loop / Hash Join)
    {
        "family": "multi_table_join",
        "queries": [
            "SELECT c.name, c.region, o.id, o.total, o.status FROM customers c JOIN orders o ON o.customer_id = c.id WHERE o.status = 'paid' LIMIT 100",
            "SELECT c.id, c.name, o.id, o.created_at FROM customers c JOIN orders o ON o.customer_id = c.id WHERE c.region = 'south' LIMIT 50",
        ],
    },
    # 8. Grouped aggregate joins (Join + HashAggregate)
    {
        "family": "grouped_aggregate_join",
        "queries": [
            "SELECT c.region, count(o.id) AS order_cnt, sum(o.total) AS total_revenue FROM customers c JOIN orders o ON o.customer_id = c.id GROUP BY c.region",
            "SELECT c.id, c.name, count(o.id) AS orders_count, sum(o.total) AS customer_spend FROM customers c JOIN orders o ON o.customer_id = c.id GROUP BY c.id, c.name ORDER BY customer_spend DESC LIMIT 30",
            "SELECT c.region, o.status, count(*) AS count, avg(o.total) AS avg_total FROM customers c JOIN orders o ON o.customer_id = c.id GROUP BY c.region, o.status",
        ],
    },
    # 9. Subqueries and CTEs (Subquery Scan / CTE Scan)
    {
        "family": "cte_subquery",
        "queries": [
            "WITH regional_summary AS (SELECT c.region, count(o.id) AS order_count, sum(o.total) AS revenue FROM customers c JOIN orders o ON o.customer_id = c.id WHERE o.status = 'paid' GROUP BY c.region) SELECT region, revenue, order_count FROM regional_summary WHERE revenue > 10000",
            "SELECT * FROM customers WHERE id IN (SELECT customer_id FROM orders WHERE total > 1800) LIMIT 40",
            "WITH recent_orders AS (SELECT customer_id, total FROM orders WHERE created_at >= '2024-01-01') SELECT customer_id, sum(total) AS ytd_spend FROM recent_orders GROUP BY customer_id ORDER BY ytd_spend DESC LIMIT 20",
        ],
    },
]

def collect(repetitions_per_query: int = 4):
    print("================================================================================")
    print("Collecting Measured Database Workload Across 9 Query Families")
    print("================================================================================")

    total_collected = 0
    family_stats = {}

    for item in WORKLOAD_FAMILIES:
        family = item["family"]
        queries = item["queries"]
        family_runtimes = []

        print(f"\n--- Query Family: {family} ({len(queries)} distinct query patterns) ---")
        for q_idx, sql in enumerate(queries, 1):
            fp = fingerprint(sql)
            # Execute 1 unrecorded warm-up run to stabilize buffer cache
            execute_once(sql, request_id="collector-warmup", predicted_ms=None, model_version=None, record=False)

            for rep in range(1, repetitions_per_query + 1):
                req_id = f"workload-{family}-q{q_idx}-rep{rep}"
                result = execute_once(sql, request_id=req_id, predicted_ms=None, model_version=None, record=False)
                runtime = result["runtime_ms"]
                plan = result["plan"]
                root = plan.get("Plan", {})

                # Enrich metadata
                metrics = {
                    **result["metrics"],
                    "query_family": family,
                    "repetition": rep,
                    "dataset": "queryopt-synthetic-v1",
                    "total_cost": float(root.get("Total Cost", 0)),
                    "plan_rows": float(root.get("Plan Rows", 0)),
                }

                # Record into query_history
                with connect() as conn:
                    conn.execute(
                        "INSERT INTO query_history(sql_text, runtime_ms, plan, query_fingerprint, request_id, predicted_ms, model_version, metrics) "
                        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                        (sql, runtime, json.dumps(plan), fp, req_id, None, None, json.dumps(metrics)),
                    )

                family_runtimes.append(runtime)
                total_collected += 1

            avg_rt = sum(family_runtimes[-repetitions_per_query:]) / repetitions_per_query
            print(f"  [Q{q_idx}] {sql[:60]}... -> Avg Runtime: {avg_rt:.3f} ms")

        family_stats[family] = {
            "queries": len(queries),
            "samples": len(family_runtimes),
            "mean_ms": round(sum(family_runtimes) / len(family_runtimes), 3),
            "min_ms": round(min(family_runtimes), 3),
            "max_ms": round(max(family_runtimes), 3),
        }

    print("\n================================================================================")
    print(f"Collection Complete: {total_collected} measured execution records inserted.")
    print("Summary by Query Family:")
    for fam, s in family_stats.items():
        print(f"  - {fam:<25}: {s['samples']} runs ({s['queries']} patterns) | Mean: {s['mean_ms']:>6.3f} ms (Range: {s['min_ms']:.2f} - {s['max_ms']:.2f} ms)")
    print("================================================================================")

if __name__ == "__main__":
    collect(repetitions_per_query=4)
