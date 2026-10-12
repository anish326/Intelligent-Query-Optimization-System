"""Generate a reproducible controlled workload; run after PostgreSQL is available."""
import random
from datetime import date, timedelta
from app.database import connect, initialize

random.seed(42)
initialize()
with connect(admin=True) as conn:
    with conn.cursor() as cur:
        if cur.execute("SELECT count(*) AS n FROM customers").fetchone()["n"]:
            print("Seed data already exists; skipping.")
        else:
            customers = [(f"Customer {i}", random.choice(["north", "south", "east", "west"]), date(2022,1,1)+timedelta(days=random.randrange(730))) for i in range(1, 5001)]
            cur.executemany("INSERT INTO customers(name, region, created_at) VALUES (%s,%s,%s)", customers)
            orders = [(random.randint(1,5000), random.choice(["paid", "pending", "cancelled"]), round(random.uniform(10,2000),2), date(2023,1,1)+timedelta(days=random.randrange(1000))) for _ in range(30000)]
            cur.executemany("INSERT INTO orders(customer_id, status, total, created_at) VALUES (%s,%s,%s,%s)", orders)
            print("Seeded 5,000 customers and 30,000 orders with random seed 42.")
