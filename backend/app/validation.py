"""SQL AST validation and semantic difference detection using sqlglot."""
import re
from fastapi import HTTPException
import sqlglot
from sqlglot import exp
from .config import MAX_QUERY_LENGTH


def validate_readonly_query(sql: str) -> str:
    query = sql.strip()
    if not query or len(query) > MAX_QUERY_LENGTH:
        raise HTTPException(400, "Query is empty or exceeds the configured length limit.")
    try:
        statements = sqlglot.parse(query, read="postgres")
    except sqlglot.errors.ParseError as exc:
        raise HTTPException(400, f"Invalid PostgreSQL SQL: {exc}")
    if len(statements) != 1 or not isinstance(statements[0], exp.Query):
        raise HTTPException(400, "Only one read-only SELECT or WITH...SELECT statement is permitted.")
    if statements[0].find(exp.Into):
        raise HTTPException(400, "SELECT INTO is not permitted.")
    return query


def detect_semantic_differences(sql1: str, sql2: str) -> list[str]:
    """Detect structural semantic differences between baseline and revised queries."""
    diffs: list[str] = []
    try:
        ast1 = sqlglot.parse_one(sql1, read="postgres")
        ast2 = sqlglot.parse_one(sql2, read="postgres")
    except Exception as exc:
        return [f"Unable to parse queries for AST semantic comparison: {exc}"]

    # 1. Compare LIMIT
    lim1 = ast1.find(exp.Limit)
    lim2 = ast2.find(exp.Limit)
    l1_str = lim1.expression.sql().strip() if lim1 and lim1.expression else None
    l2_str = lim2.expression.sql().strip() if lim2 and lim2.expression else None
    if l1_str != l2_str:
        if l1_str is None:
            diffs.append(f"Revised query added LIMIT {l2_str} (truncates result row count).")
        elif l2_str is None:
            diffs.append(f"Revised query removed LIMIT {l1_str}.")
        else:
            diffs.append(f"LIMIT differs: baseline LIMIT {l1_str} vs revised LIMIT {l2_str}.")

    # 2. Compare WHERE clause
    where1 = ast1.find(exp.Where)
    where2 = ast2.find(exp.Where)
    w1_sql = re.sub(r"\s+", " ", where1.this.sql().strip().lower()) if where1 and where1.this else ""
    w2_sql = re.sub(r"\s+", " ", where2.this.sql().strip().lower()) if where2 and where2.this else ""
    if w1_sql != w2_sql:
        diffs.append("Filter predicates (WHERE clause) differ between baseline and revised query.")

    # 3. Compare Selected Projections
    proj1 = [re.sub(r"\s+", " ", e.sql().strip().lower()) for e in ast1.expressions]
    proj2 = [re.sub(r"\s+", " ", e.sql().strip().lower()) for e in ast2.expressions]
    if proj1 != proj2:
        diffs.append("Selected columns or projection expressions differ.")

    # 4. Compare GROUP BY aggregation
    grp1 = ast1.find(exp.Group)
    grp2 = ast2.find(exp.Group)
    g1_sql = re.sub(r"\s+", " ", grp1.sql().strip().lower()) if grp1 else ""
    g2_sql = re.sub(r"\s+", " ", grp2.sql().strip().lower()) if grp2 else ""
    if g1_sql != g2_sql:
        diffs.append("Aggregation grouping (GROUP BY) structure differs.")

    # 5. Compare Tables and JOINs
    tables1 = sorted(t.name.lower() for t in ast1.find_all(exp.Table) if t.name)
    tables2 = sorted(t.name.lower() for t in ast2.find_all(exp.Table) if t.name)
    if tables1 != tables2:
        diffs.append(f"Referenced tables differ: {tables1} vs {tables2}.")

    joins1 = len(list(ast1.find_all(exp.Join)))
    joins2 = len(list(ast2.find_all(exp.Join)))
    if joins1 != joins2:
        diffs.append(f"JOIN count differs: {joins1} vs {joins2} join(s).")

    return diffs
