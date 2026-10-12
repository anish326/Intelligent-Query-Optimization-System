import re

def flatten(plan: dict) -> list[dict]:
    root = plan.get("Plan", {})
    items = []
    def walk(node):
        items.append(node)
        for child in node.get("Plans", []):
            walk(child)
    if root:
        walk(root)
    return items

def recommendations(plan: dict) -> list[dict]:
    nodes = flatten(plan)
    total_cost = plan.get("Plan", {}).get("Total Cost", 1.0)
    exec_time = plan.get("Execution Time") or plan.get("Plan", {}).get("Actual Total Time", 0.0)
    
    recs = []

    for node in nodes:
        kind = node.get("Node Type", "")
        rel = node.get("Relation Name", "")
        cost = node.get("Total Cost", 0.0)
        act_rows = (node.get("Actual Rows") or node.get("Plan Rows") or 0) * (node.get("Actual Loops") or 1)
        node_time = node.get("Actual Total Time", 0.0)
        filter_cond = node.get("Filter", "")

        # 1. Sequential Scans with Filter Predicates
        if kind == "Seq Scan":
            if filter_cond and act_rows >= 10:
                cols = re.findall(r"\b([a-zA-Z_][a-zA-Z0-9_]*)\b", filter_cond)
                filtered_cols = [c for c in cols if c.lower() not in {"and", "or", "not", "is", "null", "in", "like", "between", "true", "false"}]
                suggested_col = filtered_cols[0] if filtered_cols else "filter column"
                recs.append({
                    "severity": "warning",
                    "issue": f"Sequential Scan on '{rel}' with Filter Predicate",
                    "evidence": f"Node scanned {act_rows:.0f} rows evaluating filter condition '{filter_cond[:60]}' (Total Cost: {cost:.1f}).",
                    "action": f"Investigate creating a B-tree index on {rel}({suggested_col}) to enable direct index lookup.",
                    "benefit": "Avoids reading irrelevant pages from disk/RAM buffers, converting O(N) table scan to O(log N) index traversal.",
                    "tradeoffs": "Indexes consume additional disk storage and add write amplification overhead on INSERT, UPDATE, and DELETE operations.",
                    "message": f"Sequential scan on {rel} evaluated filter '{filter_cond[:40]}'. Consider indexing {suggested_col}."
                })
            elif act_rows > 500:
                recs.append({
                    "severity": "info",
                    "issue": f"Unindexed Sequential Table Scan on '{rel}'",
                    "evidence": f"Full sequential scan read {act_rows:.0f} rows without index support.",
                    "action": f"Review whether filtering queries against '{rel}' warrant index coverage.",
                    "benefit": "Reduces total buffer cache pressure and I/O footprint for selective access patterns.",
                    "tradeoffs": "For small tables (<100 pages), sequential scans are often faster than random index page fetches.",
                    "message": f"Full sequential scan on {rel} processed {act_rows:.0f} rows."
                })

        # 2. Avoidable Explicit Sort Operations
        if kind == "Sort":
            sort_key = str(node.get("Sort Key", ""))
            sort_method = node.get("Sort Method", "quicksort")
            recs.append({
                "severity": "info",
                "issue": "Explicit Memory Sort Operation",
                "evidence": f"Plan executed an explicit Sort node using {sort_method} on key {sort_key[:40]}.",
                "action": "Consider adding an index whose leading or trailing key matches the ORDER BY clause to retrieve tuples in pre-sorted order.",
                "benefit": "Eliminates the Sort operator entirely, allowing pipelined streaming of top rows.",
                "tradeoffs": "Composite index must match exact ordering and filter direction (ASC/DESC).",
                "message": f"Explicit sort executed on {sort_key[:30]}. An ordered B-tree index could satisfy ordering without in-memory sorting."
            })

        # 3. High-Loop Nested Loop Operations
        loops = node.get("Actual Loops", 1)
        if kind == "Nested Loop" and loops > 20:
            recs.append({
                "severity": "warning",
                "issue": "High-Iteration Nested Loop Join",
                "evidence": f"Nested Loop executed {loops} inner iteration loops.",
                "action": "Ensure the inner relation has an index on the join key to prevent repeated inner scans, or verify optimizer join strategy.",
                "benefit": "Reduces inner loop execution latency.",
                "tradeoffs": "Nested loops are efficient when inner side is small and indexed; suboptimal for large cardinality joins.",
                "message": f"Nested loop executed across {loops} loops. Verify inner relation index coverage."
            })

        # 4. Spilling to Temporary Disk Storage
        if node.get("Temp Read Blocks", 0) > 0 or "external" in str(node.get("Sort Method", "")).lower():
            recs.append({
                "severity": "critical",
                "issue": f"{kind} Spilled to Temporary Disk Storage",
                "evidence": f"Memory limit exceeded; node spilled {node.get('Temp Read Blocks', 0)} blocks to temporary disk storage.",
                "action": "Increase session 'work_mem' for analytical queries or optimize filtering to reduce intermediate rows.",
                "benefit": "Eliminates slow disk I/O by keeping sorting and hash tables entirely in RAM.",
                "tradeoffs": "Higher work_mem allocations consume more server RAM per concurrent query.",
                "message": f"{kind} spilled to temporary disk storage. Consider reviewing work_mem or reducing row volume."
            })

    if not recs:
        recs.append({
            "severity": "info",
            "issue": "Optimal Execution Structure",
            "evidence": "All plan nodes utilize available index scans, in-memory hash tables, and balanced cardinality estimates.",
            "action": "No structural changes required.",
            "benefit": "Query execution is well-aligned with PostgreSQL cost model.",
            "tradeoffs": "Continue monitoring plan stability under varying table cardinalities.",
            "message": "No obvious plan anti-patterns detected. Execution plan is well-optimized."
        })

    return recs
