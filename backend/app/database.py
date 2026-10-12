"""PostgreSQL access, versioned schema changes, repeatable safe measurements, and statistical benchmarking."""
import hashlib
import json
import re
from collections import Counter
from statistics import median
import numpy as np
import psycopg
from psycopg.rows import dict_row
import sqlglot
from sqlglot import exp
from .config import ADMIN_DATABASE_URL, DATABASE_URL, STATEMENT_TIMEOUT_MS

MIGRATIONS = [
    """CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS customers (id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, region TEXT NOT NULL, created_at DATE NOT NULL);
    CREATE TABLE IF NOT EXISTS orders (id BIGSERIAL PRIMARY KEY, customer_id BIGINT NOT NULL REFERENCES customers(id), status TEXT NOT NULL, total NUMERIC(12,2) NOT NULL, created_at DATE NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_orders_customer_created ON orders(customer_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE TABLE IF NOT EXISTS query_history (id BIGSERIAL PRIMARY KEY, sql_text TEXT NOT NULL, runtime_ms DOUBLE PRECISION NOT NULL, plan JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());""",
    """ALTER TABLE query_history ADD COLUMN IF NOT EXISTS query_fingerprint TEXT;
    ALTER TABLE query_history ADD COLUMN IF NOT EXISTS request_id TEXT;
    ALTER TABLE query_history ADD COLUMN IF NOT EXISTS predicted_ms DOUBLE PRECISION;
    ALTER TABLE query_history ADD COLUMN IF NOT EXISTS model_version TEXT;
    ALTER TABLE query_history ADD COLUMN IF NOT EXISTS metrics JSONB NOT NULL DEFAULT '{}'::jsonb;
    CREATE INDEX IF NOT EXISTS idx_query_history_fingerprint_created ON query_history(query_fingerprint, created_at DESC);""",
    """DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'query_reader') THEN
            CREATE ROLE query_reader LOGIN PASSWORD 'query_reader';
        END IF;
    END $$;
    GRANT CONNECT ON DATABASE queryopt TO query_reader;
    GRANT USAGE ON SCHEMA public TO query_reader;
    GRANT SELECT, INSERT ON customers, orders, query_history TO query_reader;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO query_reader;""",
]

def connect(admin: bool = False):
    return psycopg.connect(ADMIN_DATABASE_URL if admin else DATABASE_URL, row_factory=dict_row)

def initialize() -> None:
    with connect(admin=True) as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())")
        for version, sql in enumerate(MIGRATIONS, start=1):
            if conn.execute("SELECT 1 FROM schema_migrations WHERE version=%s", (version,)).fetchone(): continue
            conn.execute(sql)
            conn.execute("INSERT INTO schema_migrations(version) VALUES (%s)", (version,))

def fingerprint(sql: str) -> str:
    """Literal-preserving exact SQL fingerprint."""
    return hashlib.sha256(re.sub(r"\s+", " ", sql.strip().lower()).encode()).hexdigest()[:16]

def query_template(sql: str) -> str:
    """Normalized query shape masking literal constants to group query templates."""
    s = re.sub(r"\b\d+\b", "?", sql.strip().lower())
    s = re.sub(r"'[^']*'", "'?'", s)
    return hashlib.sha256(re.sub(r"\s+", " ", s).encode()).hexdigest()[:16]

def estimated_plan(sql: str) -> dict:
    with connect() as conn, conn.cursor() as cur:
        cur.execute("BEGIN READ ONLY")
        cur.execute("SET LOCAL statement_timeout = %s" % int(STATEMENT_TIMEOUT_MS))
        cur.execute("EXPLAIN (FORMAT JSON) " + sql)
        return cur.fetchone()["QUERY PLAN"][0]

def execute_once(sql: str, request_id: str, predicted_ms: float | None, model_version: str | None, record: bool = True) -> dict:
    with connect() as conn, conn.cursor() as cur:
        cur.execute("BEGIN READ ONLY")
        cur.execute("SET LOCAL statement_timeout = %s" % int(STATEMENT_TIMEOUT_MS))
        cur.execute("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + sql)
        plan = cur.fetchone()["QUERY PLAN"][0]
        runtime = float(plan["Execution Time"])
        metrics = {
            "planning_ms": float(plan.get("Planning Time", 0)),
            "shared_hit_blocks": plan["Plan"].get("Shared Hit Blocks", 0),
            "shared_read_blocks": plan["Plan"].get("Shared Read Blocks", 0),
        }
        conn.commit()

    if record:
        with connect() as audit_conn:
            audit_conn.execute(
                "INSERT INTO query_history(sql_text,runtime_ms,plan,query_fingerprint,request_id,predicted_ms,model_version,metrics) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                (sql, runtime, json.dumps(plan), fingerprint(sql), request_id, predicted_ms, model_version, json.dumps(metrics))
            )
    return {"runtime_ms": runtime, "plan": plan, "metrics": metrics}

def compute_spread_metrics(runtimes: list[float]) -> dict:
    """Compute median, IQR, MAD, and P95 (when N >= 5)."""
    arr = np.array(sorted(runtimes))
    med = float(np.median(arr))
    q25 = float(np.percentile(arr, 25))
    q75 = float(np.percentile(arr, 75))
    iqr = round(q75 - q25, 4)
    mad = round(float(np.median(np.abs(arr - med))), 4)
    p95 = round(float(np.percentile(arr, 95)), 4) if len(arr) >= 5 else None
    return {
        "median_ms": round(med, 4),
        "iqr_ms": iqr,
        "mad_ms": mad,
        "p95_ms": p95,
    }

def measure(sql: str, repetitions: int, warmups: int, request_id: str, predicted_ms: float | None, model_version: str | None) -> dict:
    for _ in range(warmups):
        execute_once(sql, request_id + "-warmup", predicted_ms, model_version, record=False)
    samples = [execute_once(sql, request_id, predicted_ms, model_version) for _ in range(repetitions)]
    runtimes = [s["runtime_ms"] for s in samples]
    spread = compute_spread_metrics(runtimes)
    return {
        "measured_runtime_ms": spread["median_ms"],
        "p95_runtime_ms": spread["p95_ms"] if spread["p95_ms"] is not None else spread["median_ms"],
        "iqr_ms": spread["iqr_ms"],
        "mad_ms": spread["mad_ms"],
        "runs": samples,
        "plan": samples[-1]["plan"],
        "metrics": samples[-1]["metrics"],
    }

def measure_interleaved(
    sql_base: str,
    sql_cand: str,
    repetitions: int,
    warmups: int,
    request_id: str,
    pred_base: float | None,
    pred_cand: float | None,
    model_version: str | None,
) -> dict:
    """Execute baseline and candidate queries with alternating execution order to eliminate sequential bias."""
    # Warmups
    for _ in range(warmups):
        execute_once(sql_base, request_id + "-w-base", pred_base, model_version, record=False)
        execute_once(sql_cand, request_id + "-w-cand", pred_cand, model_version, record=False)

    base_samples = []
    cand_samples = []

    for i in range(repetitions):
        # Alternate order: even iterations run base then cand; odd run cand then base
        if i % 2 == 0:
            s_b = execute_once(sql_base, f"{request_id}-base-{i}", pred_base, model_version)
            s_c = execute_once(sql_cand, f"{request_id}-cand-{i}", pred_cand, model_version)
        else:
            s_c = execute_once(sql_cand, f"{request_id}-cand-{i}", pred_cand, model_version)
            s_b = execute_once(sql_base, f"{request_id}-base-{i}", pred_base, model_version)
        base_samples.append(s_b)
        cand_samples.append(s_c)

    base_runtimes = [s["runtime_ms"] for s in base_samples]
    cand_runtimes = [s["runtime_ms"] for s in cand_samples]

    spread_base = compute_spread_metrics(base_runtimes)
    spread_cand = compute_spread_metrics(cand_runtimes)

    # Paired Bootstrap 95% Confidence Interval for median difference
    diffs = np.array(cand_runtimes) - np.array(base_runtimes)
    n = len(diffs)
    if n >= 3:
        rng = np.random.default_rng(42)
        boot_idx = rng.integers(0, n, size=(1000, n))
        boot_meds = np.median(diffs[boot_idx], axis=1)
        ci_lower = round(float(np.percentile(boot_meds, 2.5)), 4)
        ci_upper = round(float(np.percentile(boot_meds, 97.5)), 4)
    else:
        ci_lower = round(float(min(diffs)), 4)
        ci_upper = round(float(max(diffs)), 4)

    return {
        "baseline": {
            "measured_runtime_ms": spread_base["median_ms"],
            "p95_runtime_ms": spread_base["p95_ms"] if spread_base["p95_ms"] is not None else spread_base["median_ms"],
            "iqr_ms": spread_base["iqr_ms"],
            "mad_ms": spread_base["mad_ms"],
            "runs": base_samples,
            "plan": base_samples[-1]["plan"],
            "metrics": base_samples[-1]["metrics"],
        },
        "candidate": {
            "measured_runtime_ms": spread_cand["median_ms"],
            "p95_runtime_ms": spread_cand["p95_ms"] if spread_cand["p95_ms"] is not None else spread_cand["median_ms"],
            "iqr_ms": spread_cand["iqr_ms"],
            "mad_ms": spread_cand["mad_ms"],
            "runs": cand_samples,
            "plan": cand_samples[-1]["plan"],
            "metrics": cand_samples[-1]["metrics"],
        },
        "uncertainty": {
            "ci_lower_ms": ci_lower,
            "ci_upper_ms": ci_upper,
            "spans_zero": bool(ci_lower <= 0 <= ci_upper),
            "paired_runs": n,
            "method": "paired_bootstrap_median_95ci",
        },
    }

def compare_result_sets(
    r1: list[str],
    r2: list[str],
    has_order_1: bool,
    has_order_2: bool,
    max_rows: int = 500,
) -> dict:
    """Core logic to compare serialized result sets under multiset and ordering semantics."""
    count1, count2 = len(r1), len(r2)
    exceeded_cap = (count1 > max_rows) or (count2 > max_rows)

    if exceeded_cap:
        return {
            "checked": True,
            "equivalent": None,
            "status": "EQUIVALENCE_UNVERIFIED",
            "sample_count_1": count1,
            "sample_count_2": count2,
            "exceeded_cap": True,
            "max_sample_rows": max_rows,
            "message": (
                f"Result set exceeded the {max_rows}-row verification cap (returned >= {max_rows + 1} rows). "
                "Complete result equivalence across the entire dataset could not be verified."
            ),
        }

    if count1 != count2:
        return {
            "checked": True,
            "equivalent": False,
            "status": "DIFFERENT_RESULTS",
            "sample_count_1": count1,
            "sample_count_2": count2,
            "exceeded_cap": False,
            "max_sample_rows": max_rows,
            "message": f"Result count mismatch: baseline returned {count1} row(s), candidate returned {count2} row(s).",
        }

    # Both queries have explicit ORDER BY: strict sequence equality
    if has_order_1 and has_order_2:
        if r1 == r2:
            return {
                "checked": True,
                "equivalent": True,
                "status": "VERIFIED_EQUIVALENT",
                "sample_count_1": count1,
                "sample_count_2": count2,
                "exceeded_cap": False,
                "max_sample_rows": max_rows,
                "message": f"Result equivalence verified: identical {count1} row(s) returned in matching sort order (within tested database state).",
            }
        else:
            if Counter(r1) == Counter(r2):
                return {
                    "checked": True,
                    "equivalent": False,
                    "status": "DIFFERENT_RESULTS",
                    "sample_count_1": count1,
                    "sample_count_2": count2,
                    "exceeded_cap": False,
                    "max_sample_rows": max_rows,
                    "message": "Multiset rows match, but row sequence differs. Non-unique sort keys or differing ORDER BY criteria produced different row orders.",
                }
            else:
                return {
                    "checked": True,
                    "equivalent": False,
                    "status": "DIFFERENT_RESULTS",
                    "sample_count_1": count1,
                    "sample_count_2": count2,
                    "exceeded_cap": False,
                    "max_sample_rows": max_rows,
                    "message": "Row values differ between baseline and candidate queries.",
                }

    # Neither query has explicit ORDER BY: multiset equality (preserves duplicate rows)
    if not has_order_1 and not has_order_2:
        if Counter(r1) == Counter(r2):
            return {
                "checked": True,
                "equivalent": True,
                "status": "VERIFIED_EQUIVALENT",
                "sample_count_1": count1,
                "sample_count_2": count2,
                "exceeded_cap": False,
                "max_sample_rows": max_rows,
                "message": f"Result equivalence verified: identical multiset of {count1} row(s) returned (order-independent, duplicates preserved, within tested database state).",
            }
        else:
            return {
                "checked": True,
                "equivalent": False,
                "status": "DIFFERENT_RESULTS",
                "sample_count_1": count1,
                "sample_count_2": count2,
                "exceeded_cap": False,
                "max_sample_rows": max_rows,
                "message": "Row values or duplicate multiplicity counts differ between queries.",
            }

    # One query has ORDER BY, the other does not: conservative semantic difference
    multiset_match = (Counter(r1) == Counter(r2))
    return {
        "checked": True,
        "equivalent": False,
        "status": "SEMANTIC_DIFFERENCE_DETECTED",
        "sample_count_1": count1,
        "sample_count_2": count2,
        "exceeded_cap": False,
        "max_sample_rows": max_rows,
        "message": (
            "Explicit ORDER BY clause is present in only one query. Ordering semantics differ; queries cannot be declared equivalent."
            if multiset_match
            else "Row values and ordering clauses differ between baseline and candidate queries."
        ),
    }


def check_result_equivalence(sql1: str, sql2: str, max_rows: int = 500) -> dict:
    """Safe, bounded result equivalence check executed in read-only transaction with statement timeout."""
    has_order_1 = False
    has_order_2 = False
    try:
        ast1 = sqlglot.parse_one(sql1, read="postgres")
        ast2 = sqlglot.parse_one(sql2, read="postgres")
        has_order_1 = bool(ast1.find(exp.Order))
        has_order_2 = bool(ast2.find(exp.Order))
    except Exception:
        pass

    try:
        with connect() as conn, conn.cursor() as cur:
            cur.execute("BEGIN READ ONLY")
            cur.execute("SET LOCAL statement_timeout = %s" % min(int(STATEMENT_TIMEOUT_MS), 3000))
            # Query up to max_rows + 1 to detect if the query exceeded the verification cap
            cur.execute(f"SELECT row_to_json(t) AS r FROM ({sql1}) t LIMIT {max_rows + 1}")
            r1 = [json.dumps(row["r"], sort_keys=True) for row in cur.fetchall()]
            cur.execute(f"SELECT row_to_json(t) AS r FROM ({sql2}) t LIMIT {max_rows + 1}")
            r2 = [json.dumps(row["r"], sort_keys=True) for row in cur.fetchall()]
            conn.commit()

        return compare_result_sets(r1, r2, has_order_1, has_order_2, max_rows=max_rows)

    except Exception as exc:
        return {
            "checked": False,
            "equivalent": None,
            "status": "EQUIVALENCE_UNVERIFIED",
            "sample_count_1": None,
            "sample_count_2": None,
            "exceeded_cap": False,
            "max_sample_rows": max_rows,
            "message": f"Controlled result equivalence check could not be completed safely: {exc}",
        }

def history() -> list[dict]:
    with connect() as conn:
        return conn.execute("SELECT sql_text,runtime_ms,plan,metrics,query_fingerprint,created_at FROM query_history ORDER BY created_at ASC,id ASC LIMIT 5000").fetchall()

def recent_history(limit: int = 50) -> list[dict]:
    with connect() as conn:
        return conn.execute("SELECT sql_text,query_fingerprint,runtime_ms,predicted_ms,model_version,metrics,created_at FROM query_history ORDER BY id DESC LIMIT %s", (limit,)).fetchall()
