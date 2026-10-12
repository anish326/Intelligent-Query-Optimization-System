def flatten(plan: dict) -> list[dict]:
    root = plan.get("Plan", {})
    items = []
    def walk(node):
        items.append(node)
        for child in node.get("Plans", []): walk(child)
    walk(root)
    return items

def recommendations(plan: dict) -> list[dict]:
    notes = []
    for node in flatten(plan):
        kind = node.get("Node Type", "")
        rows = node.get("Actual Rows", 0) * node.get("Actual Loops", 1)
        if kind == "Seq Scan" and rows > 1000:
            notes.append({"severity": "info", "message": f"Sequential scan on {node.get('Relation Name', 'a relation')} processed {rows:.0f} rows. Review predicate selectivity and index suitability."})
        if kind in {"Sort", "Hash"} and node.get("Temp Read Blocks", 0):
            notes.append({"severity": "warning", "message": f"{kind} spilled to temporary storage; consider reducing rows, adding an index, or reviewing work_mem for this workload."})
    return notes or [{"severity": "info", "message": "No obvious plan anti-patterns were detected. This is a heuristic recommendation, not a measured improvement."}]
