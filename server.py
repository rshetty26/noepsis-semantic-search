import os
import json
import psycopg2
import psycopg2.extras
import numpy as np
from contextlib import asynccontextmanager
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer

load_dotenv()

MODEL_ID = "BAAI/bge-base-en-v1.5"
FIELD = "abstract"

_model: SentenceTransformer = None
_emb_matrix: np.ndarray = None
_emb_meta: list = []
_cal_p1: float = 0.0
_cal_p99: float = 1.0


def _load_calibration():
    # Fixed anchors for BAAI/bge-base-en-v1.5 query-to-document cosine similarity.
    # Corpus-derived p1/p99 (0.52, 0.80) are article-article similarities, which
    # are too narrow a baseline for query-article scoring and cause low-% results.
    # To revert: return values from calibration.json using the commented code below.
    #   path = os.path.join(os.path.dirname(__file__), "calibration.json")
    #   with open(path) as f: raw = json.load(f)
    #   entry = raw.get(f"{MODEL_ID}|{FIELD}", {})
    #   return entry.get("p1", 0.0), entry.get("p99", 1.0)
    return 0.3, 0.9


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def _load_embeddings():
    global _emb_matrix, _emb_meta
    print(f"  Caching embeddings: {MODEL_ID} / {FIELD}")
    conn = get_conn()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT ae.embedding,
               a.id, a.title, a.abstract, a.keywords, a.doi,
               a.published_date, a.article_url, a.authors
        FROM article_embeddings ae
        JOIN articles a ON a.id = ae.article_id
        WHERE ae.model_name = %s AND ae.field_name = %s
        ORDER BY ae.article_id
    """, (MODEL_ID, FIELD))
    rows = cur.fetchall()
    cur.close()
    conn.close()

    _emb_matrix = np.array([r["embedding"] for r in rows], dtype=np.float32)
    _emb_meta = [{
        "id": r["id"],
        "title": r["title"],
        "abstract": r["abstract"],
        "keywords": r["keywords"],
        "doi": r["doi"],
        "published_date": str(r["published_date"]) if r["published_date"] else None,
        "article_url": r["article_url"],
        "authors": r["authors"],
    } for r in rows]


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _model, _cal_p1, _cal_p99
    _cal_p1, _cal_p99 = _load_calibration()
    print(f"Loading model: {MODEL_ID}")
    _model = SentenceTransformer(MODEL_ID, device="cpu")
    _load_embeddings()
    print("Server ready.\n")
    yield
    _model = None
    _emb_meta.clear()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


def row_to_article(r):
    return {
        "id": r["id"],
        "title": r["title"],
        "abstract": r["abstract"],
        "keywords": r["keywords"],
        "doi": r["doi"],
        "published_date": str(r["published_date"]) if r["published_date"] else None,
        "article_url": r["article_url"],
        "authors": r["authors"],
    }


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/articles")
def get_articles(q: str = None, year: int = None):
    conn = get_conn()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    if q and q.strip():
        term = f"%{q.strip()}%"
        cur.execute("""
            SELECT id, title, abstract, keywords, doi, published_date, article_url, authors
            FROM articles
            WHERE title    ILIKE %s
               OR abstract ILIKE %s
               OR keywords ILIKE %s
               OR authors  ILIKE %s
            ORDER BY published_date DESC NULLS LAST, id
            LIMIT 1000
        """, (term, term, term, term))
    elif year:
        cur.execute("""
            SELECT id, title, abstract, keywords, doi, published_date, article_url, authors
            FROM articles
            WHERE EXTRACT(YEAR FROM published_date) = %s
            ORDER BY published_date DESC, id
            LIMIT 1000
        """, (year,))
    else:
        cur.execute("""
            SELECT id, title, abstract, keywords, doi, published_date, article_url, authors
            FROM articles
            ORDER BY published_date DESC NULLS LAST, id
            LIMIT 1000
        """)
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [row_to_article(r) for r in rows]


@app.get("/api/years")
def get_years():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT DISTINCT EXTRACT(YEAR FROM published_date)::int AS year
        FROM articles
        WHERE published_date IS NOT NULL
        ORDER BY year DESC
    """)
    years = [r[0] for r in cur.fetchall()]
    cur.close()
    conn.close()
    return years


@app.get("/api/semantic")
def semantic_search(
    q: str = Query(..., min_length=1),
    top_k: int = Query(20, ge=1, le=10000),
):
    query_vec = _model.encode(
        [q.strip()],
        convert_to_numpy=True,
        normalize_embeddings=True,
    ).astype(np.float32)[0]

    scores = _emb_matrix @ query_vec
    top_indices = np.argsort(scores)[::-1][:top_k]

    span = _cal_p99 - _cal_p1

    return [
        {**_emb_meta[i], "score": round(float(np.clip((scores[i] - _cal_p1) / span, 0.0, 1.0)), 4)}
        for i in top_indices
    ]
