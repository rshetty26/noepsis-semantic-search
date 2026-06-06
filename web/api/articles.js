import { neon } from '@neondatabase/serverless'

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL_UNPOOLED)
  const { q, year } = req.query

  let rows
  if (q && q.trim()) {
    const term = `%${q.trim()}%`
    rows = await sql`
      SELECT id, title, abstract, keywords, doi, published_date, article_url, authors
      FROM articles
      WHERE title    ILIKE ${term}
         OR abstract ILIKE ${term}
         OR keywords ILIKE ${term}
         OR authors  ILIKE ${term}
      ORDER BY published_date DESC NULLS LAST, id
      LIMIT 1000
    `
  } else if (year && year !== 'All') {
    rows = await sql`
      SELECT id, title, abstract, keywords, doi, published_date, article_url, authors
      FROM articles
      WHERE EXTRACT(YEAR FROM published_date) = ${parseInt(year)}
      ORDER BY published_date DESC, id
      LIMIT 1000
    `
  } else {
    rows = await sql`
      SELECT id, title, abstract, keywords, doi, published_date, article_url, authors
      FROM articles
      ORDER BY published_date DESC NULLS LAST, id
      LIMIT 1000
    `
  }

  res.setHeader('Access-Control-Allow-Origin', '*')
  res.json(rows)
}
