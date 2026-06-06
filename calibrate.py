import os
import json
import psycopg2
import psycopg2.extras
import numpy as np
from dotenv import load_dotenv

load_dotenv()

MODELS = [
    "BAAI/bge-large-en-v1.5",
    "intfloat/e5-large-v2",
    "thenlper/gte-large",
    "sentence-transformers/all-mpnet-base-v2",
    "BAAI/bge-base-en-v1.5",
]
FIELDS = ["abstract", "fulltext"]

def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])

calibration = {}

conn = get_conn()
cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

for model_id in MODELS:
    for field_name in FIELDS:
        print(f"Processing {model_id} / {field_name} ...")
        cur.execute(
            "SELECT embedding FROM article_embeddings WHERE model_name = %s AND field_name = %s ORDER BY article_id",
            (model_id, field_name),
        )
        rows = cur.fetchall()
        if not rows:
            print(f"  No embeddings found, skipping.")
            continue

        matrix = np.array([r["embedding"] for r in rows], dtype=np.float32)
        sims = matrix @ matrix.T
        n = sims.shape[0]
        idx = np.triu_indices(n, k=1)
        vals = sims[idx]
        p1  = float(np.percentile(vals, 1))
        p99 = float(np.percentile(vals, 99))
        calibration[f"{model_id}|{field_name}"] = {"p1": p1, "p99": p99}
        print(f"  n={n}  p1={p1:.4f}  p99={p99:.4f}")

cur.close()
conn.close()

out_path = os.path.join(os.path.dirname(__file__), "calibration.json")
with open(out_path, "w") as f:
    json.dump(calibration, f, indent=2)

print(f"\nSaved to {out_path}")
