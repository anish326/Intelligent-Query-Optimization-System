"""Persisted plan-aware runtime regression with leakage-free grouped evaluation and baseline benchmarking."""
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import json
import os
import random
import re
import joblib
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error
from .config import MODEL_PATH
from .features import model_features
from .database import fingerprint, query_template


def classify_query_family(sql: str, metrics: dict | None) -> str:
    """Classify SQL query into one of 9 canonical relational query families."""
    if metrics and isinstance(metrics, dict) and metrics.get("query_family"):
        return str(metrics["query_family"])
    s = sql.lower()
    if s.startswith("with ") or "with " in s:
        return "cte_subquery"
    if "join " in s and "group by" in s:
        return "grouped_aggregate_join"
    if "join " in s:
        return "multi_table_join"
    if "group by" in s or re.search(r"\b(count|sum|avg|min|max)\s*\(", s):
        return "aggregation"
    if "order by" in s and "limit" in s:
        return "sorting_limit"
    if re.search(r"\bwhere\s+id\s*=", s):
        return "pk_lookup"
    if "customer_id =" in s or "customer_id=" in s:
        return "selective_index"
    if "status =" in s or "region =" in s:
        return "non_selective_filter"
    return "single_table_scan"


@dataclass
class ModelStatus:
    samples: int = 0
    train_samples: int = 0
    val_samples: int = 0
    unique_fingerprints: int = 0
    unique_shapes: int = 0
    query_families_count: int = 0
    held_out_families: list[str] = field(default_factory=list)
    evaluation_strategy: str = "none"
    mae_ms: float | None = None
    rmse_ms: float | None = None
    mdape_pct: float | None = None
    baseline_mae_ms: float | None = None
    baseline_rmse_ms: float | None = None
    outperforms_baseline: bool | None = None
    mae_improvement_pct: float | None = None
    version: str | None = None
    trained_at: str | None = None


class CostModel:
    def __init__(self):
        self.model: RandomForestRegressor | None = None
        self.status = ModelStatus()

    def load(self) -> None:
        if os.path.exists(MODEL_PATH):
            payload = joblib.load(MODEL_PATH)
            self.model = payload["model"]
            self.status = ModelStatus(**payload["status"])

    def train(self, records: list[dict]) -> ModelStatus:
        if len(records) < 12:
            raise ValueError("At least 12 measured historical executions are required to train the model.")

        # Extract fingerprints, normalized query shapes, and query families
        fps = [r.get("query_fingerprint") or fingerprint(r["sql_text"]) for r in records]
        shapes = [query_template(r["sql_text"]) for r in records]

        families = []
        for r in records:
            m = r.get("metrics")
            if isinstance(m, str):
                try: m = json.loads(m)
                except Exception: m = {}
            elif not isinstance(m, dict):
                m = {}
            fam = classify_query_family(r["sql_text"], m)
            families.append(fam)

        unique_fps = sorted(list(set(fps)))
        unique_shapes = sorted(list(set(shapes)))
        unique_fams = sorted(list(set(families)))

        # Zero-Leakage Grouped Evaluation Splitting Strategy
        rng = random.Random(42)

        if len(unique_fams) >= 4:
            shuffled_fams = unique_fams.copy()
            rng.shuffle(shuffled_fams)
            val_fam_count = max(1, int(len(unique_fams) * 0.25))
            val_fams = sorted(shuffled_fams[:val_fam_count])

            train_idx = [i for i, f in enumerate(families) if f not in val_fams]
            val_idx = [i for i, f in enumerate(families) if f in val_fams]
            eval_strategy = "grouped_family_holdout"
            held_out = val_fams

            # Fallback if partition is degenerate
            if len(val_idx) < 2 or len(train_idx) < 8:
                eval_strategy = "grouped_fingerprint_holdout"
                shuffled_fps = unique_fps.copy()
                rng.shuffle(shuffled_fps)
                val_fps_count = max(1, int(len(unique_fps) * 0.25))
                val_fps = set(shuffled_fps[:val_fps_count])
                train_idx = [i for i, fp in enumerate(fps) if fp not in val_fps]
                val_idx = [i for i, fp in enumerate(fps) if fp in val_fps]
                held_out = []
        elif len(unique_fps) >= 4:
            shuffled_fps = unique_fps.copy()
            rng.shuffle(shuffled_fps)
            val_fps_count = max(1, int(len(unique_fps) * 0.25))
            val_fps = set(shuffled_fps[:val_fps_count])

            train_idx = [i for i, fp in enumerate(fps) if fp not in val_fps]
            val_idx = [i for i, fp in enumerate(fps) if fp in val_fps]
            eval_strategy = "grouped_fingerprint_holdout"
            held_out = []
        else:
            split = max(8, int(len(records) * 0.75))
            if len(records) - split < 3:
                split = len(records) - 3
            train_idx = list(range(split))
            val_idx = list(range(split, len(records)))
            eval_strategy = "chronological_holdout"
            held_out = []

        x = np.array([model_features(row["sql_text"], row["plan"]) for row in records])
        y = np.array([float(row["runtime_ms"]) for row in records])

        x_train, y_train = x[train_idx], y[train_idx]
        x_val, y_val = x[val_idx], y[val_idx]

        # Fit candidate evaluation model on training partition only
        candidate = RandomForestRegressor(n_estimators=240, random_state=42, min_samples_leaf=2, n_jobs=-1)
        candidate.fit(x_train, y_train)
        y_val_pred = candidate.predict(x_val)

        # 1. Primary Model Evaluation Metrics on Validation Partition
        mae = float(mean_absolute_error(y_val, y_val_pred))
        rmse = float(np.sqrt(np.mean((y_val - y_val_pred) ** 2)))
        denom = np.maximum(y_val, 0.05)  # Safe floor to guard against division by zero on sub-ms runtimes
        mdape = float(np.median(np.abs(y_val - y_val_pred) / denom) * 100)

        # 2. Naive Central-Tendency Baseline Regressor evaluated on EXACT SAME validation rows
        # Baseline fitted ONLY on training partition median
        median_train_runtime = float(np.median(y_train))
        baseline_mae = float(np.mean(np.abs(y_val - median_train_runtime)))
        baseline_rmse = float(np.sqrt(np.mean((y_val - median_train_runtime) ** 2)))
        outperforms = bool(mae < baseline_mae)
        improvement_pct = float(((baseline_mae - mae) / baseline_mae * 100) if baseline_mae > 0 else 0.0)

        # 3. Fit production model on all historical observations for real-time serving
        self.model = RandomForestRegressor(n_estimators=240, random_state=42, min_samples_leaf=2, n_jobs=-1)
        self.model.fit(x, y)

        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        self.status = ModelStatus(
            samples=len(records),
            train_samples=len(train_idx),
            val_samples=len(val_idx),
            unique_fingerprints=len(unique_fps),
            unique_shapes=len(unique_shapes),
            query_families_count=len(unique_fams),
            held_out_families=held_out,
            evaluation_strategy=eval_strategy,
            mae_ms=round(mae, 4),
            rmse_ms=round(rmse, 4),
            mdape_pct=round(mdape, 2),
            baseline_mae_ms=round(baseline_mae, 4),
            baseline_rmse_ms=round(baseline_rmse, 4),
            outperforms_baseline=outperforms,
            mae_improvement_pct=round(improvement_pct, 1),
            version=f"rf-{stamp}",
            trained_at=datetime.now(timezone.utc).isoformat(),
        )

        os.makedirs(os.path.dirname(MODEL_PATH) or ".", exist_ok=True)
        joblib.dump({"model": self.model, "status": asdict(self.status)}, MODEL_PATH)
        return self.status

    def predict(self, sql: str, plan: dict) -> dict | None:
        if self.model is None:
            return None
        features = [model_features(sql, plan)]
        tree_predictions = np.array([tree.predict(features)[0] for tree in self.model.estimators_])
        return {
            "runtime_ms": float(np.mean(tree_predictions)),
            "lower_ms": float(np.quantile(tree_predictions, 0.1)),
            "upper_ms": float(np.quantile(tree_predictions, 0.9)),
            "model_version": self.status.version,
            "features_note": "Inference derived from PostgreSQL estimated execution-plan features (EXPLAIN without ANALYZE) prior to execution.",
        }
