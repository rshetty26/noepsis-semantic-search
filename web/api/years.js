import { neon } from '@neondatabase/serverless'

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL_UNPOOLED)
  const rows = await sql`
    SELECT DISTINCT EXTRACT(YEAR FROM published_date)::int AS year
    FROM articles
    WHERE published_date IS NOT NULL
    ORDER BY year DESC
  `
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.json(rows.map(r => r.year))
}
