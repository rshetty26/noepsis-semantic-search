import { useState, useEffect, useCallback, useRef } from 'react'
import './App.css'

const API_URL = import.meta.env.VITE_API_URL ?? ''

function scoreColor(score, darkMode) {
  const stops = [[0, 0], [0.25, 30], [0.50, 60], [0.75, 120], [0.90, 210], [1.00, 280]]
  let hue = 0
  for (let i = 1; i < stops.length; i++) {
    const [s0, h0] = stops[i - 1]
    const [s1, h1] = stops[i]
    if (score <= s1) {
      hue = h0 + ((score - s0) / (s1 - s0)) * (h1 - h0)
      break
    }
  }
  const h = Math.round(hue)
  return darkMode
    ? { bg: `hsl(${h}, 80%, 62%)`, text: `hsl(${h}, 80%, 18%)` }
    : { bg: `hsl(${h}, 75%, 42%)`, text: '#fff' }
}

function YearSelect({ value, onChange, years }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const options = [{ label: 'All years', value: 'All' }, ...years.map(y => ({ label: String(y), value: String(y) }))]
  const selected = options.find(o => o.value === value) || options[0]

  return (
    <div className="year-dropdown" ref={ref}>
      <button
        type="button"
        className="year-dropdown-trigger"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {selected.label}
        <span className="material-icons year-dropdown-icon"
          style={{ transform: open ? 'rotate(180deg)' : 'none' }}>
          expand_more
        </span>
      </button>
      {open && (
        <ul className="year-dropdown-list" role="listbox">
          {options.map(o => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={`year-dropdown-option${o.value === value ? ' selected' : ''}`}
              onClick={() => { onChange(o.value); setOpen(false) }}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function parseLocalDate(dateStr) {
  if (!dateStr) return null
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (match) return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]))
  return new Date(dateStr)
}

function SkeletonCard() {
  return (
    <div className="card skeleton-card">
      <div className="skeleton skeleton-badge" />
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-title short" />
      <div className="skeleton skeleton-line" />
      <div className="skeleton skeleton-line" />
      <div className="skeleton skeleton-line mid" />
      <div className="card-footer skeleton-footer">
        <div className="skeleton skeleton-chip" />
        <div className="skeleton skeleton-chip" />
      </div>
    </div>
  )
}

const PAGE_SIZE = 30

function ArticleCard({ article, score, darkMode }) {
  const [authorsExpanded, setAuthorsExpanded] = useState(false)
  const [hiddenCount, setHiddenCount] = useState(0)
  const chipsRef = useRef(null)
  const abstract = article.abstract || 'No abstract available.'

  useEffect(() => {
    const el = chipsRef.current
    if (!el) return
    const containerTop = el.getBoundingClientRect().top
    let hidden = 0
    el.querySelectorAll('.author-chip').forEach(chip => {
      if (chip.getBoundingClientRect().bottom > containerTop + 40) hidden++
    })
    setHiddenCount(hidden)
  }, [article.authors])

  const keywords = article.keywords
    ? article.keywords.split(/[,;]/).slice(0, 3).map(k => k.trim()).filter(Boolean)
    : []

  const displayDate = article.published_date
    ? parseLocalDate(article.published_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    : null

  function openArticle() {
    if (article.article_url) window.open(article.article_url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="card article-card" onClick={openArticle}>
      <div className="card-top">
        <div className="card-meta">
          {displayDate && <span className="year-badge">{displayDate}</span>}
          {score != null && (() => { const sc = scoreColor(score, darkMode); return (
            <span className="score-badge" title="Cosine similarity score" style={{ background: sc.bg, color: sc.text }}>
              {(score * 100).toFixed(1)}% match
            </span>
          ) })()}
          {article.doi && (
            <a
              className="doi-link"
              href={`https://doi.org/${article.doi}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
            >
              <span className="material-icons">link</span>
              DOI
            </a>
          )}
        </div>
        <p className="article-title">{article.title || 'Untitled'}</p>
        {article.authors && (
          <div className="article-authors">
            <span className="material-icons authors-icon">person</span>
            <div className="author-chips-wrap">
              <div
                ref={chipsRef}
                className={`author-chips${authorsExpanded ? '' : ' author-chips-collapsed'}`}
              >
                {article.authors.split(' | ').map((a, i) => (
                  <span key={i} className="author-chip">{a}</span>
                ))}
              </div>
              {(hiddenCount > 0 || authorsExpanded) && (
                <button
                  className="author-toggle-btn"
                  onClick={e => { e.stopPropagation(); setAuthorsExpanded(v => !v) }}
                >
                  {authorsExpanded ? '− less' : `+${hiddenCount} more`}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      <p className="article-abstract">{abstract}</p>
      <div className="card-footer">
        <div className="kw-chips">
          {keywords.map((kw, i) => (
            <span key={i} className="kw-chip">{kw}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [query, setQuery] = useState('')
  const [activeYear, setActiveYear] = useState('All')
  const [availableYears, setAvailableYears] = useState([])
  const [sortOrder, setSortOrder] = useState('desc')
  const [articles, setArticles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [page, setPage] = useState(1)
  const [visibleCount, setVisibleCount] = useState(15)
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('theme')
    if (saved) return saved === 'dark'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  const [searchMode, setSearchMode] = useState('keyword') // 'keyword' | 'semantic'
  const [serverOnline, setServerOnline] = useState(null)  // null = checking, true, false
  const [hasSearched, setHasSearched] = useState(false)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light')
    localStorage.setItem('theme', darkMode ? 'dark' : 'light')
  }, [darkMode])

  useEffect(() => {
    async function checkServer() {
      try {
        const res = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(2000) })
        setServerOnline(res.ok)
      } catch {
        setServerOnline(false)
      }
    }
    checkServer()
    const interval = setInterval(checkServer, 10000)
    return () => clearInterval(interval)
  }, [])

  const fetchArticles = useCallback(async (q, year) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (q) params.set('q', q)
      if (year !== 'All') params.set('year', year)
      const res = await fetch(`${API_URL}/api/articles?${params}`)
      if (!res.ok) throw new Error('Failed to fetch')
      setArticles(await res.json())
      setPage(1)
      setVisibleCount(15)
    } catch {
      setError('Could not load articles.')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchSemantic = useCallback(async (q) => {
    if (!q.trim()) return
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ q: q.trim(), top_k: 1000 })
      const res = await fetch(`${API_URL}/api/semantic?${params}`)
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setArticles(data)
      setVisibleCount(15)
      setPage(1)
    } catch (e) {
      setError('Semantic search failed: ' + e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetch(`${API_URL}/api/years`).then(r => r.json()).then(setAvailableYears).catch(() => {})
  }, [])

  useEffect(() => {
    async function load(attempt) {
      try {
        const res = await fetch(`${API_URL}/api/articles`)
        if (!res.ok) throw new Error()
        setArticles(await res.json())
        setPage(1)
        setLoading(false)
      } catch {
        if (attempt < 3) {
          setTimeout(() => load(attempt + 1), 800)
        } else {
          setError('Could not load articles.')
          setLoading(false)
        }
      }
    }
    load(1)
  }, [])

  function handleSearch() {
    setHasSearched(true)
    if (searchMode === 'semantic') fetchSemantic(query)
    else fetchArticles(query, activeYear)
  }

  function handleYearClick(year) {
    setActiveYear(year)
    fetchArticles(query, year)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') handleSearch()
  }

  function handleModeSwitch(mode) {
    if (mode === 'semantic' && !serverOnline) return
    setSearchMode(mode)
    setHasSearched(false)
    setQuery('')
    if (hasSearched) fetchArticles('', 'All')
  }

  const isSemantic = searchMode === 'semantic'

  const isSemanticResults = hasSearched && isSemantic

  const sortedArticles = isSemanticResults
    ? articles
    : [...articles].sort((a, b) => {
        const da = a.published_date ? new Date(a.published_date) : new Date(0)
        const db = b.published_date ? new Date(b.published_date) : new Date(0)
        return sortOrder === 'desc' ? db - da : da - db
      })

  const totalPages = Math.ceil(sortedArticles.length / PAGE_SIZE)

  return (
    <div className="layout">
      <header className="header">
        <div className="header-inner">
          <div className="header-top">
            <div className="header-brand">
              <img src={darkMode ? '/imaps_logo_dark_mode.png' : '/imaps_logo_light_mode.png'} alt="IMAPS" className="brand-logo" />
              <div>
                <h1 className="brand-title">Journal of Microelectronics and Electronic Packaging</h1>
                <p className="brand-subtitle">Article Explorer</p>
              </div>
            </div>
            <button className="theme-toggle" onClick={() => setDarkMode(d => !d)} title="Toggle dark mode">
              <span className="material-icons">{darkMode ? 'light_mode' : 'dark_mode'}</span>
            </button>
          </div>
          <p className="header-sub">
            A NLP article search engine demo, explore and discover JMEP publications using natural language queries.
          </p>
          <p className="header-sub">
            To access the full JMEP Journal, <a href="https://imapsjmep.org/" target="_blank" rel="noopener noreferrer" className="header-link">click here</a>.
          </p>
        </div>
      </header>

      <main className="main">
        <section className="search-section">

          {/* Mode toggle */}
          <div className="mode-toggle-row">
            <div className="mode-toggle">
              <button
                className={`mode-btn${!isSemantic ? ' active' : ''}`}
                onClick={() => handleModeSwitch('keyword')}
              >
                <span className="material-icons">search</span>
                Keyword
              </button>
              <button
                className={`mode-btn${isSemantic ? ' active' : ''}${!serverOnline ? ' disabled' : ''}`}
                onClick={() => handleModeSwitch('semantic')}
                title={serverOnline === false ? 'Start the local Python server to enable semantic search' : ''}
                disabled={!serverOnline}
              >
                <span className="material-icons">psychology</span>
                Semantic
                {serverOnline === false && (
                  <span className="server-offline-badge" title="Local server not running">offline</span>
                )}
                {serverOnline === null && (
                  <span className="server-offline-badge">…</span>
                )}
              </button>
            </div>
            {serverOnline === false && window.location.hostname === 'localhost' && (
              <p className="server-hint">
                <span className="material-icons" style={{ fontSize: 14 }}>info</span>
                Run <code>uvicorn server:app --port 8000</code> to enable semantic search
              </p>
            )}
          </div>

          {/* Search bar */}
          <div className="search-box">
            <span className="material-icons search-icon">search</span>
            <input
              className="search-input"
              type="text"
              placeholder={isSemantic ? 'Search by concept, topic, or research question…' : 'Search by keyword or author…'}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button className="search-btn" onClick={handleSearch}>
              <span className="material-icons btn-icon">search</span>
              Search
            </button>
          </div>

          {/* Keyword-only filters */}
          {!hasSearched && (
            <div className="filter-row">
              <span className="filter-label">Filter by year:</span>
              <YearSelect
                value={activeYear}
                onChange={handleYearClick}
                years={availableYears}
              />
              <button
                className="sort-toggle"
                onClick={() => { setSortOrder(o => o === 'desc' ? 'asc' : 'desc'); setPage(1) }}
                title={sortOrder === 'desc' ? 'Showing newest first' : 'Showing oldest first'}
              >
                <span className="material-icons sort-toggle-icon">
                  {sortOrder === 'desc' ? 'arrow_downward' : 'arrow_upward'}
                </span>
                {sortOrder === 'desc' ? 'Newest first' : 'Oldest first'}
              </button>
            </div>
          )}
        </section>

        <section className="results-section">
          <div className="results-header">
            {!loading && !error && (
              <p className="results-count">
                {`${sortedArticles.length} article${sortedArticles.length !== 1 ? 's' : ''} found`}
              </p>
            )}
            {error && <p className="results-count error">{error}</p>}
          </div>
          <div className="card-grid">
            {loading
              ? Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
              : (hasSearched ? sortedArticles.slice(0, visibleCount) : sortedArticles.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)).map(a => (
                  <ArticleCard key={a.id} article={a} score={isSemanticResults ? a.score : null} darkMode={darkMode} />
                ))
            }
          </div>
          {!loading && !error && hasSearched && visibleCount < sortedArticles.length && (
            <div className="pagination">
              <button
                className="page-btn"
                onClick={() => setVisibleCount(c => c + 15)}
              >
                <span className="material-icons">expand_more</span>
                Show More
              </button>
            </div>
          )}
          {!loading && !error && !hasSearched && sortedArticles.length > PAGE_SIZE && (
            <div className="pagination">
              <button
                className="page-btn"
                disabled={page === 1}
                onClick={() => { setPage(p => p - 1); window.scrollTo(0, 0) }}
              >
                <span className="material-icons">arrow_back</span>
                Prev
              </button>
              <span className="page-info">Page {page} of {totalPages}</span>
              <button
                className="page-btn"
                disabled={page === totalPages}
                onClick={() => { setPage(p => p + 1); window.scrollTo(0, 0) }}
              >
                Next
                <span className="material-icons">arrow_forward</span>
              </button>
            </div>
          )}
        </section>
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <img
              src={darkMode ? '/cal_poly_dark_mode.png' : '/cal_poly_light_mode.png'}
              alt="Cal Poly"
              className="footer-calpolylogo"
            />
            <div className="footer-brand-divider" />
            <img src={darkMode ? '/imaps_logo_dark_mode.png' : '/imaps_logo_light_mode.png'} alt="IMAPS" className="footer-logo" />
            <div>
              <a href="https://imapsjmep.org/" target="_blank" rel="noopener noreferrer" className="footer-title footer-link">Journal of Microelectronics and Electronic Packaging</a>
              <p className="footer-subtitle">Article Explorer · Research Demo</p>
            </div>
          </div>
          <div className="footer-right">
            <div className="footer-contact">
              <p className="footer-contact-title">Contact</p>
              <p className="footer-contact-line">Developed by <a href="mailto:rishetty@calpoly.edu" className="footer-name-link">Rithvik Shetty</a></p>
              <p className="footer-contact-line">Advised by <a href="https://ime.calpoly.edu/puneet-agarwal/" className="footer-name-link" target="_blank" rel="noopener noreferrer">Puneet Agarwal</a></p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
