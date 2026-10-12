"""Deterministic query features shared by training and prediction."""
import re

SQL_FEATURE_NAMES = ["length", "joins", "predicates", "aggregates", "order_by", "distinct", "subquery", "has_limit"]
PLAN_FEATURE_NAMES = ["estimated_cost", "estimated_rows", "plan_nodes", "seq_scans", "index_scans", "join_nodes", "sort_nodes", "aggregate_nodes"]
FEATURE_NAMES = SQL_FEATURE_NAMES + PLAN_FEATURE_NAMES

def extract_features(sql: str) -> list[float]:
    normalized = re.sub(r"\s+", " ", sql.lower()).strip()
    return [
        float(len(normalized)),
        float(len(re.findall(r"\bjoin\b", normalized))),
        float(len(re.findall(r"\b(where|and|or)\b", normalized))),
        float(len(re.findall(r"\b(count|sum|avg|min|max)\s*\(", normalized))),
        float("order by" in normalized),
        float("distinct" in normalized),
        float(len(re.findall(r"\(\s*select\b", normalized))),
        float("limit" in normalized),
    ]

def extract_plan_features(plan: dict) -> list[float]:
    root = plan.get("Plan", {})
    nodes: list[dict] = []
    def walk(node: dict) -> None:
        nodes.append(node)
        for child in node.get("Plans", []): walk(child)
    walk(root)
    kinds = [node.get("Node Type", "") for node in nodes]
    return [float(root.get("Total Cost", 0)), float(root.get("Plan Rows", 0)), float(len(nodes)),
            float(kinds.count("Seq Scan")), float(kinds.count("Index Scan") + kinds.count("Index Only Scan")),
            float(sum("Join" in kind or kind in {"Nested Loop", "Hash", "Merge Join"} for kind in kinds)),
            float(kinds.count("Sort")), float(sum("Aggregate" in kind for kind in kinds))]

def model_features(sql: str, plan: dict) -> list[float]:
    return extract_features(sql) + extract_plan_features(plan)
