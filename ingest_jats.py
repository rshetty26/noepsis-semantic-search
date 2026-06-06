"""
Ingest JATS XML files into the articles table.

Usage:
    python ingest_jats.py [--xml-dir PATH]

Defaults to an `xml/` directory in the same folder as this script.
Re-running is safe: records are upserted on source_file (XML stem).
"""

import argparse
import os
import re
import xml.etree.ElementTree as ET
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

load_dotenv()

UPSERT_SQL = """
INSERT INTO articles
    (title, abstract, keywords, doi, published_date, article_url, authors, source_file)
VALUES
    (%s, %s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (source_file) DO UPDATE SET
    title          = EXCLUDED.title,
    abstract       = EXCLUDED.abstract,
    keywords       = EXCLUDED.keywords,
    doi            = EXCLUDED.doi,
    published_date = EXCLUDED.published_date,
    article_url    = EXCLUDED.article_url,
    authors        = EXCLUDED.authors;
"""


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip() if text else ""


def extract_title(root) -> str | None:
    el = root.find(".//article-title")
    return normalize("".join(el.itertext())) or None if el is not None else None


def extract_abstract(root) -> str | None:
    el = root.find(".//abstract")
    return normalize("".join(el.itertext())) or None if el is not None else None


def extract_authors(root) -> str | None:
    names = []
    for contrib in root.findall('.//contrib[@contrib-type="author"]'):
        given = (contrib.findtext("name/given-names") or "").strip()
        surname = (contrib.findtext("name/surname") or "").strip()
        name = f"{given} {surname}".strip()
        if name:
            names.append(name)
    return " | ".join(names) or None


def extract_keywords(root) -> str | None:
    kwds = [normalize("".join(k.itertext())) for k in root.findall(".//kwd")]
    kwds = [k for k in kwds if k]
    return ", ".join(kwds) or None


def extract_doi(root) -> str | None:
    el = root.find('.//article-id[@pub-id-type="doi"]')
    return normalize("".join(el.itertext())) or None if el is not None else None


def extract_published_date(root) -> str | None:
    # Prefer collection date (actual issue date); fall back to pub date
    el = root.find('.//pub-date[@date-type="collection"]')
    if el is None:
        el = root.find('.//pub-date[@date-type="pub"]')
    return el.get("iso-8601-date") if el is not None else None


def ingest(xml_dir: Path, conn):
    xml_files = sorted(xml_dir.glob("*.xml"))
    if not xml_files:
        print(f"No XML files found in {xml_dir}")
        return

    cur = conn.cursor()
    inserted = updated = skipped = 0

    for xml_path in xml_files:
        try:
            root = ET.parse(xml_path).getroot()
            doi = extract_doi(root)
            row = (
                extract_title(root),
                extract_abstract(root),
                extract_keywords(root),
                doi,
                extract_published_date(root),
                f"https://doi.org/{doi}" if doi else None,
                extract_authors(root),
                xml_path.stem,
            )
            cur.execute(UPSERT_SQL, row)
            if cur.rowcount:
                updated += 1
            else:
                inserted += 1
            print(f"  ok: {xml_path.name}")
        except Exception as exc:
            print(f"  error: {xml_path.name} — {exc}")
            skipped += 1

    conn.commit()
    cur.close()
    print(f"\nDone. {inserted + updated} upserted, {skipped} errors.")


def main():
    parser = argparse.ArgumentParser(description="Ingest JATS XML files into PostgreSQL.")
    parser.add_argument(
        "--xml-dir",
        default=Path(__file__).resolve().parent / "xml",
        type=Path,
        help="Directory containing JATS XML files (default: ./xml/)",
    )
    args = parser.parse_args()

    if not args.xml_dir.is_dir():
        raise SystemExit(f"XML directory not found: {args.xml_dir}")

    print(f"Ingesting from: {args.xml_dir}")
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        ingest(args.xml_dir, conn)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
