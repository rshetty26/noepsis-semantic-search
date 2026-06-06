import os
import psycopg2
import psycopg2.extras
import numpy as np
from collections import defaultdict
from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer

load_dotenv()

MODEL_ID = "BAAI/bge-base-en-v1.5"
FIELDS = ["abstract", "fulltext"]
MIN_CHARS = 80
BATCH_SIZE = 32
DEVICE = "cpu"
CHUNK_SIZE = 1800
CHUNK_OVERLAP = 200


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def chunk_text(text, chunk_size=CHUNK_SIZE, overlap=CHUNK_OVERLAP):
    chunks = []
    start = 0
    while start < len(text):
        chunks.append(text[start:start + chunk_size])
        if start + chunk_size >= len(text):
            break
        start += chunk_size - overlap
    return chunks or [""]


UPSERT_SQL = """
INSERT INTO article_embeddings (article_id, model_name, field_name, embedding)
VALUES (%s, %s, %s, %s)
ON CONFLICT (article_id, model_name, field_name) DO UPDATE
    SET embedding = EXCLUDED.embedding,
        created_at = NOW();
"""

conn = get_conn()
cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
cur.execute("SELECT id, abstract, fulltext FROM articles ORDER BY id")
rows = cur.fetchall()

cur.execute(
    "SELECT DISTINCT field_name FROM article_embeddings WHERE model_name = %s",
    (MODEL_ID,)
)
completed_fields = {r["field_name"] for r in cur.fetchall()}
cur.close()
conn.close()

print(f"Loaded {len(rows)} articles from DB")
if completed_fields:
    print(f"Skipping already-completed fields: {sorted(completed_fields)}")

model = None

for field_name in FIELDS:
    if field_name in completed_fields:
        print(f"Skipping {field_name} (already in DB)")
        continue

    if model is None:
        print(f"Loading model: {MODEL_ID}")
        model = SentenceTransformer(MODEL_ID, device=DEVICE)

    print(f"\nField: {field_name}")
    eligible = [
        row for row in rows
        if len(str(row[field_name] or "").strip()) >= MIN_CHARS
    ]
    print(f"  {len(eligible)}/{len(rows)} articles have sufficient {field_name} text")

    if field_name == "abstract":
        texts = [str(row[field_name]).strip() for row in eligible]
        embeddings = model.encode(
            texts,
            batch_size=BATCH_SIZE,
            show_progress_bar=True,
            convert_to_numpy=True,
            normalize_embeddings=True,
        ).astype(np.float32)
        results = [(row["id"], vec) for row, vec in zip(eligible, embeddings)]

    else:
        chunk_pairs = []
        for row in eligible:
            for chunk in chunk_text(str(row[field_name]).strip()):
                chunk_pairs.append((row["id"], chunk))

        print(f"  {len(chunk_pairs)} total chunks across {len(eligible)} articles")

        chunk_vecs = model.encode(
            [t for _, t in chunk_pairs],
            batch_size=BATCH_SIZE,
            show_progress_bar=True,
            convert_to_numpy=True,
            normalize_embeddings=True,
        ).astype(np.float32)

        article_chunk_vecs = defaultdict(list)
        for (article_id, _), vec in zip(chunk_pairs, chunk_vecs):
            article_chunk_vecs[article_id].append(vec)

        results = [
            (article_id, np.stack(vecs).mean(axis=0).astype(np.float32))
            for article_id, vecs in article_chunk_vecs.items()
        ]

    conn = get_conn()
    cur = conn.cursor()
    for article_id, vec in results:
        cur.execute(UPSERT_SQL, (article_id, MODEL_ID, field_name, vec.tolist()))
    conn.commit()
    cur.close()
    conn.close()
    print(f"  Committed {len(results)} embeddings for {MODEL_ID} / {field_name}")

print("\nDone.")
