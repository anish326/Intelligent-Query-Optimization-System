import os

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/queryopt")
ADMIN_DATABASE_URL = os.getenv("ADMIN_DATABASE_URL", DATABASE_URL)
MAX_QUERY_LENGTH = int(os.getenv("MAX_QUERY_LENGTH", "5000"))
STATEMENT_TIMEOUT_MS = int(os.getenv("STATEMENT_TIMEOUT_MS", "5000"))
MODEL_PATH = os.getenv("MODEL_PATH", "/app/data/runtime_model.joblib")
MAX_REPETITIONS = int(os.getenv("MAX_REPETITIONS", "50"))
