# Noepsis

A self-hostable semantic search platform for academic journals.

Noepsis uses sentence transformer embeddings to enable natural language search over a journal corpus. Researchers can query using full sentences or even paste an abstract to find thematically related work, without needing to identify the right keywords. All components are open-source and deployable on commodity hardware.

## Architecture

```
JATS XML files
      │
      ▼
ingest_jats.py ──► PostgreSQL (articles table)
                         │
                         ▼
                    embed.py ──► pgvector (article_embeddings table)
                                       │
                                       ▼
                                  server.py ──► REST API (:8000)
                                                     │
                                                     ▼
                                              React frontend (optional)
```

## Prerequisites

- Python 3.9+
- PostgreSQL with the [pgvector](https://github.com/pgvector/pgvector) extension
- Node.js 18+ (reference frontend only)

## Setup

### 1. Clone and install dependencies

```bash
git clone https://github.com/rshetty26/noepsis-semantic-search.git
cd noepsis-semantic-search
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set `DATABASE_URL` to your PostgreSQL connection string:

```
DATABASE_URL=postgresql://user:password@host:5432/dbname
```

### 3. Initialize the database

Run the schema against your PostgreSQL instance:

```bash
psql -d your_database -f schema.sql
```

This creates two tables (`articles`, `article_embeddings`) and enables the `vector` extension.

## Ingestion Pipeline

### 1. Prepare JATS XML files

Place your journal's JATS XML files in an `xml/` directory:

```
xml/
  article-001.xml
  article-002.xml
  ...
```

Noepsis extracts the following fields from standard JATS elements:

| Field | JATS element |
|---|---|
| Title | `<article-title>` |
| Abstract | `<abstract>` |
| Authors | `<contrib contrib-type="author">` → `<given-names>` + `<surname>` |
| Keywords | `<kwd>` (all within `<kwd-group>`) |
| DOI | `<article-id pub-id-type="doi">` |
| Publication date | `<pub-date date-type="collection">` (falls back to `date-type="pub"`), `iso-8601-date` attribute |

### 2. Ingest articles

```bash
python ingest_jats.py
```

By default this reads from `xml/`. To use a different directory:

```bash
python ingest_jats.py --xml-dir /path/to/your/xml
```

Re-running is safe — records are upserted on the XML filename as a unique key.

### 3. Generate embeddings

```bash
python embed.py
```

This encodes each article abstract using `BAAI/bge-base-en-v1.5` and stores the resulting 768-dimensional vectors in the `article_embeddings` table. Embeddings are L2-normalized prior to storage.

The model (~419 MB) is downloaded automatically from Hugging Face on first run.

## Running the Server

```bash
uvicorn server:app
```

The server loads the embedding model and caches all embeddings in memory at startup, then serves requests at `http://localhost:8000`.

## API Reference

All endpoints return JSON. Semantic search requires the local server; keyword search can be served from any PostgreSQL-connected host.

### `GET /health`

```
200 OK
{"status": "ok"}
```

### `GET /api/articles`

Keyword search. Case-insensitive substring match across title, abstract, keywords, and authors.

| Parameter | Type | Description |
|---|---|---|
| `q` | string | Search term (optional) |
| `year` | int | Filter by publication year (optional) |

Returns up to 1000 articles ordered by publication date descending.

**Example:**
```bash
curl "http://localhost:8000/api/articles?q=sintered+silver"
```

### `GET /api/semantic`

Semantic search using cosine similarity against abstract embeddings.

| Parameter | Type | Description |
|---|---|---|
| `q` | string | Query (required) |
| `top_k` | int | Number of results, 1–10000 (default: 20) |

Results include a `score` field (0–1) representing calibrated percent match.

**Example:**
```bash
curl "http://localhost:8000/api/semantic?q=pressureless+silver+bonding+for+power+electronics&top_k=10"
```

### `GET /api/years`

Returns a list of publication years present in the database, descending.

```bash
curl "http://localhost:8000/api/years"
```

## Reference Frontend

A React-based demo frontend is included in `web/`. It offers keyword and semantic search, year filtering, and match score visualization.

```bash
cd web
npm install
npm run dev
```

Open `http://localhost:5173`. The frontend proxies API requests to `http://localhost:8000`, so the server must be running for semantic search to work.

The frontend is a reference implementation — journal publishers can build their own interface against the REST API to match their platform's design.

## Configuration

### Changing the embedding model

1. Update `MODEL_ID` in both `server.py` and `embed.py` to your chosen model.
2. If the model outputs a different embedding dimension, update `vector(768)` in `schema.sql` and recreate the `article_embeddings` table.
3. Re-run `embed.py` to generate new embeddings.
4. Restart the server.

The five models evaluated in the paper are:

| Model | Params | Dim | Notes |
|---|---|---|---|
| `BAAI/bge-base-en-v1.5` | 109M | 768 | **Recommended** — highest relevance score at lowest cost |
| `BAAI/bge-large-en-v1.5` | 335M | 1024 | Highest MRR/NDCG; 3× larger |
| `intfloat/e5-large-v2` | 335M | 1024 | Strong retrieval; prepend "query: " to queries |
| `thenlper/gte-large` | 335M | 1024 | Competitive performance |
| `sentence-transformers/all-mpnet-base-v2` | 109M | 768 | Well-established baseline |

### Similarity score calibration

The server normalizes raw cosine similarity scores to a 0–1 percent match scale using fixed anchors (P1 = 0.30, P99 = 0.90). To derive corpus-specific anchors from your own data, run:

```bash
python calibrate.py
```

Then update `_load_calibration()` in `server.py` to read from `calibration.json`.

## Evaluation

Performance was measured on 50 domain-specific queries using LLM-as-judge relevance scoring (Claude Haiku) and three retrieval metrics: MRR@3, NDCG@3, and Hit@3. All five semantic models substantially outperformed keyword search (~0.96–0.99 vs. ~0.72 across all metrics). Abstract-level embeddings outperformed full-text embeddings and are used in production.

See the paper for full methodology and results.

## Citation

```bibtex
@article{shetty2024noepsis,
  title   = {Noepsis: A Self-Hostable Semantic Search Platform for Journals},
  author  = {Shetty, Rithvik},
  year    = {2024},
  url     = {https://github.com/rshetty26/noepsis-semantic-search}
}
```

## License

MIT — see [LICENSE](LICENSE).
