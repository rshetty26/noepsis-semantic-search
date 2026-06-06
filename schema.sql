CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS articles (
    id             SERIAL PRIMARY KEY,
    title          TEXT,
    abstract       TEXT,
    keywords       TEXT,
    doi            TEXT,
    published_date DATE,
    article_url    TEXT,
    authors        TEXT,
    source_file    TEXT UNIQUE,
    fulltext       TEXT
);

CREATE TABLE IF NOT EXISTS article_embeddings (
    id          SERIAL PRIMARY KEY,
    article_id  INT  NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    model_name  TEXT NOT NULL,
    field_name  TEXT NOT NULL,
    embedding   vector(768),
    created_at  TIMESTAMP DEFAULT NOW(),
    UNIQUE(article_id, model_name, field_name)
);
