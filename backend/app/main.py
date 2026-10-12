from contextlib import asynccontextmanager
import uuid
import psycopg
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from .config import MAX_REPETITIONS
from .database import (
    check_result_equivalence,
    estimated_plan,
    history,
    initialize,
    measure,
    measure_interleaved,
    recent_history,
)
from .validation import detect_semantic_differences, validate_readonly_query
from .ml import CostModel
from .features import FEATURE_NAMES, model_features
from .recommendations import recommendations

model = CostModel()


@asynccontextmanager
async def lifespan(app: FastAPI):
    initialize()
    model.load()
    yield


app = FastAPI(title="Intelligent Query Optimization API", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_methods=["*"], allow_headers=["*"])


class MeasurementOptions(BaseModel):
    repetitions: int = Field(default=5, ge=1, le=MAX_REPETITIONS)
    warmups: int = Field(default=1, ge=0, le=3)


class QueryRequest(MeasurementOptions):
    sql: str = Field(min_length=1, max_length=5000)
    database: str = "queryopt"


class CompareRequest(MeasurementOptions):
    before_sql: str = Field(min_length=1, max_length=5000)
    after_sql: str = Field(min_length=1, max_length=5000)


def prediction_for(sql: str) -> tuple[dict, dict | None]:
    estimate = estimated_plan(sql)
    return estimate, model.predict(sql, estimate)


def api_error(exc: psycopg.Error) -> HTTPException:
    return HTTPException(400, f"PostgreSQL rejected or timed out the query: {exc.diag.message_primary if exc.diag else str(exc)}")


@app.get("/health")
def health():
    return {"ok": True, "model": model.status.__dict__}


@app.get("/databases")
def databases():
    return {"databases": [{"id": "queryopt", "label": "queryopt — controlled PostgreSQL test database", "fixed_profile": True}]}


@app.get("/history")
def query_history(limit: int = Query(default=25, ge=1, le=100)):
    return {"entries": recent_history(limit)}


@app.post("/analyze")
def analyze(request: QueryRequest):
    sql, request_id = validate_readonly_query(request.sql), str(uuid.uuid4())
    try:
        estimate, prediction = prediction_for(sql)
        result = measure(
            sql,
            request.repetitions,
            request.warmups,
            request_id,
            prediction["runtime_ms"] if prediction else None,
            prediction["model_version"] if prediction else None,
        )
        return {
            "sql": sql,
            "request_id": request_id,
            "estimated_plan": estimate,
            "prediction": prediction,
            **result,
            "recommendations": recommendations(result["plan"]),
            "features": dict(zip(FEATURE_NAMES, model_features(sql, estimate))),
            "model": model.status.__dict__,
            "measurement_note": (
                f"Median runtime with IQR {result.get('iqr_ms', 0):.3f} ms from {request.repetitions} measured EXPLAIN ANALYZE runs "
                f"after {request.warmups} warm-up run(s)."
            ),
        }
    except psycopg.Error as exc:
        raise api_error(exc)


@app.post("/model/train")
def train():
    try:
        return model.train(history()).__dict__
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@app.post("/compare")
def compare(request: CompareRequest):
    before = validate_readonly_query(request.before_sql)
    after = validate_readonly_query(request.after_sql)
    request_id = str(uuid.uuid4())

    try:
        # 1. AST Structural Semantic Differences Analysis
        semantic_diffs = detect_semantic_differences(before, after)

        # 2. Controlled Result Equivalence Verification (bounded multiset check in read-only transaction)
        result_equiv = check_result_equivalence(before, after)

        # 3. Interleaved / Alternating Benchmark Measurements
        before_estimate, before_prediction = prediction_for(before)
        after_estimate, after_prediction = prediction_for(after)

        bench = measure_interleaved(
            before,
            after,
            request.repetitions,
            request.warmups,
            request_id,
            before_prediction["runtime_ms"] if before_prediction else None,
            after_prediction["runtime_ms"] if after_prediction else None,
            model.status.version,
        )

        baseline = bench["baseline"]
        revised = bench["candidate"]
        uncertainty = bench["uncertainty"]

        delta = round(revised["measured_runtime_ms"] - baseline["measured_runtime_ms"], 4)
        base_time = baseline["measured_runtime_ms"]
        pct = round((delta / base_time * 100), 2) if base_time > 0 else 0.0

        # Materiality rule: require BOTH absolute >= 0.20 ms AND relative >= 5.0%
        meets_materiality = (abs(delta) >= 0.20) and (abs(pct) >= 5.0)
        spans_zero = uncertainty["spans_zero"]

        # 4. Rigorous Scientific Verdict Determination
        equiv_status = result_equiv.get("status", "EQUIVALENCE_UNVERIFIED")

        if equiv_status == "DIFFERENT_RESULTS":
            verdict = "SEMANTIC_MISMATCH"
            verdict_message = (
                "Queries returned different result rows or counts. "
                "Returning fewer rows or altering requested results does not constitute a database optimization."
            )
        elif equiv_status == "EQUIVALENCE_UNVERIFIED":
            if semantic_diffs:
                equiv_status = "SEMANTIC_DIFFERENCE_DETECTED"
            verdict = "INCONCLUSIVE"
            if not meets_materiality:
                verdict_message = (
                    f"Measured latency delta ({delta:+.3f} ms, {pct:+.1f}%) does not meet practical materiality thresholds "
                    "(requires both >= 0.20 ms absolute delta and >= 5.0% relative change). Result equivalence was unverified."
                )
            else:
                verdict_message = (
                    f"Candidate measured {abs(pct):.1f}% faster ({abs(delta):.3f} ms reduction), but result set exceeded the verification cap. "
                    "Complete result equivalence could not be verified; cannot confirm optimization."
                )
        else:
            # Result set is VERIFIED_EQUIVALENT (multiset and ordering verified within tested database state)
            equiv_status = "VERIFIED_EQUIVALENT"
            if not meets_materiality:
                verdict = "INCONCLUSIVE"
                if spans_zero:
                    verdict_message = (
                        f"Measured latency delta ({delta:+.3f} ms, {pct:+.1f}%) fails practical materiality thresholds "
                        f"(<0.20 ms or <5.0%) and the 95% bootstrap CI [{uncertainty['ci_lower_ms']:+.3f}, {uncertainty['ci_upper_ms']:+.3f}] ms "
                        f"spans zero (both practically negligible and statistically uncertain over {request.repetitions} runs)."
                    )
                else:
                    verdict_message = (
                        f"Measured latency delta ({delta:+.3f} ms, {pct:+.1f}%) is below the practical materiality threshold "
                        f"(requires both >= 0.20 ms absolute change and >= 5.0% relative change). While the 95% bootstrap CI "
                        f"[{uncertainty['ci_lower_ms']:+.3f}, {uncertainty['ci_upper_ms']:+.3f}] ms excludes zero, the effect is "
                        f"practically negligible in wall-clock terms and based on a preliminary sample of {request.repetitions} runs."
                    )
            elif spans_zero:
                verdict = "INCONCLUSIVE"
                verdict_message = (
                    f"Measured delta ({delta:+.3f} ms) meets practical materiality thresholds, but the 95% bootstrap uncertainty interval "
                    f"[{uncertainty['ci_lower_ms']:+.3f}, {uncertainty['ci_upper_ms']:+.3f}] ms spans zero, indicating high run-to-run variability "
                    f"and statistical uncertainty over {request.repetitions} runs."
                )
            elif delta < 0:
                verdict = "FASTER"
                sample_note = f"preliminary inference based on {request.repetitions} runs" if request.repetitions < 30 else f"confirmed over {request.repetitions} paired runs"
                verdict_message = (
                    f"Candidate achieved a measured {abs(pct):.1f}% latency reduction ({abs(delta):.3f} ms faster). "
                    f"Meets both practical materiality thresholds (>=0.20 ms and >=5.0%) with 95% bootstrap CI "
                    f"[{uncertainty['ci_lower_ms']:+.3f}, {uncertainty['ci_upper_ms']:+.3f}] ms ({sample_note})."
                )
            else:
                verdict = "SLOWER"
                sample_note = f"preliminary inference based on {request.repetitions} runs" if request.repetitions < 30 else f"confirmed over {request.repetitions} paired runs"
                verdict_message = (
                    f"Candidate introduced a measured {abs(pct):.1f}% execution overhead (+{delta:.3f} ms slower). "
                    f"Meets practical materiality thresholds with 95% bootstrap CI "
                    f"[{uncertainty['ci_lower_ms']:+.3f}, {uncertainty['ci_upper_ms']:+.3f}] ms ({sample_note})."
                )

        return {
            "request_id": request_id,
            "before": {
                **baseline,
                "sql": before,
                "prediction": before_prediction,
                "estimated_plan": before_estimate,
            },
            "after": {
                **revised,
                "sql": after,
                "prediction": after_prediction,
                "estimated_plan": after_estimate,
            },
            "measured_delta_ms": delta,
            "measured_percent_change": pct,
            "verdict": verdict,
            "verdict_message": verdict_message,
            "equivalence_status": equiv_status,
            "semantic_differences": semantic_diffs,
            "result_equivalence": result_equiv,
            "uncertainty": uncertainty,
            "measurement_note": (
                f"Controlled interleaved benchmarking ({request.repetitions} paired runs, {request.warmups} warm-up) under identical database state. "
                f"Uncertainty estimated via paired bootstrap (95% CI: [{uncertainty['ci_lower_ms']:+.3f}, {uncertainty['ci_upper_ms']:+.3f}] ms)."
            ),
        }
    except psycopg.Error as exc:
        raise api_error(exc)
