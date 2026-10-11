import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ArrowDownToLine, Check, LoaderCircle, RefreshCw, SlidersHorizontal } from 'lucide-react'
import { ChartCanvas } from './ChartCanvas'
import type { IChartApi } from 'lightweight-charts'
import { ema, getTurnover, paintCandles } from './indicators'
import type { Bar } from './data'
import { renderDailyChartPng, renderTradeChartPng } from './chartImage'
import './App.css'

type FeedResponse = {
  symbol: string
  exchange: string
  source: string
  retrievedAt: string
  lastBarAt: string
  bars: Bar[]
}

const defaultSymbol = 'PTCIL.NS'

function fmtPrice(value: number) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value)
}

function fmtCr(value: number | null) {
  return value === null ? '—' : `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value)} Cr`
}

function tickerLabel(symbol: string) {
  return symbol.replace(/\.(NS|BO)$/i, '').toUpperCase()
}

function App() {
  const [input, setInput] = useState(defaultSymbol)
  const [symbol, setSymbol] = useState(defaultSymbol)
  const [feed, setFeed] = useState<FeedResponse | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [saved, setSaved] = useState(false)
  const [tradePanelOpen, setTradePanelOpen] = useState(false)
  const [buyDate, setBuyDate] = useState('')
  const [buyPrice, setBuyPrice] = useState('')
  const [sellDate, setSellDate] = useState('')
  const [sellPrice, setSellPrice] = useState('')
  const [tradeExporting, setTradeExporting] = useState(false)
  const [tradeSaved, setTradeSaved] = useState(false)
  const [tradeError, setTradeError] = useState('')
  const [priceScaleHovered, setPriceScaleHovered] = useState(false)
  const chartRef = useRef<IChartApi | null>(null)
  const shellRef = useRef<HTMLElement>(null)
  const controlsRef = useRef<HTMLElement>(null)
  const tradePanelRef = useRef<HTMLFormElement>(null)
  const setChart = useCallback((chart: IChartApi | null) => { chartRef.current = chart }, [])

  useLayoutEffect(() => {
    const shell = shellRef.current
    if (!tradePanelOpen) {
      shell?.style.removeProperty('--trade-chart-height')
      return
    }

    const updateHeight = () => {
      if (!shell) return
      const reservedHeight = (controlsRef.current?.offsetHeight ?? 0)
        + (tradePanelRef.current?.offsetHeight ?? 0)
      const nextHeight = Math.max(180, shell.clientHeight - reservedHeight)
      shell.style.setProperty('--trade-chart-height', `${nextHeight}px`)
    }

    updateHeight()
    const observer = new ResizeObserver(updateHeight)
    if (controlsRef.current) observer.observe(controlsRef.current)
    if (tradePanelRef.current) observer.observe(tradePanelRef.current)
    window.addEventListener('resize', updateHeight)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateHeight)
      shell?.style.removeProperty('--trade-chart-height')
    }
  }, [tradePanelOpen])

  async function loadDailyBars(nextSymbol = symbol) {
    setLoading(true)
    setError('')
    setFeed(null)
    setSaved(false)
    setBuyDate('')
    setBuyPrice('')
    setSellDate('')
    setSellPrice('')
    setTradeError('')
    setSymbol(nextSymbol)
    try {
      const response = await fetch(`/api/candles?symbol=${encodeURIComponent(nextSymbol)}`)
      const payload = await response.json() as FeedResponse & { error?: string }
      if (!response.ok) throw new Error(payload.error || `Market data request failed (${response.status}).`)
      if (!payload.bars?.length) throw new Error(`No daily candles were returned for ${nextSymbol}.`)
      setFeed(payload)
      setSymbol(nextSymbol)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Daily market data is unavailable right now.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    async function loadInitialData() {
      try {
        const response = await fetch(`/api/candles?symbol=${encodeURIComponent(defaultSymbol)}`)
        const payload = await response.json() as FeedResponse & { error?: string }
        if (!response.ok) throw new Error(payload.error || `Market data request failed (${response.status}).`)
        if (!payload.bars?.length) throw new Error(`No daily candles were returned for ${defaultSymbol}.`)
        if (!cancelled) {
          setFeed(payload)
          setSymbol(defaultSymbol)
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Daily market data is unavailable right now.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadInitialData()
    return () => { cancelled = true }
  }, [])

  const bars = useMemo(() => feed?.bars ?? [], [feed])
  const paintedBars = useMemo(() => paintCandles(bars), [bars])
  const overlays = useMemo(() => ({
    ema10: ema(bars, 10),
    ema20: ema(bars, 20),
    ema50: ema(bars, 50),
    ema100: ema(bars, 100),
  }), [bars])
  const turnover = useMemo(() => getTurnover(bars), [bars])
  const latest = bars.at(-1)
  const previous = bars.at(-2)
  const change = latest && previous ? latest.close - previous.close : 0
  const changePct = previous ? change / previous.close * 100 : 0
  const updated = feed ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(feed.retrievedAt)) : ''

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalized = input.trim().toUpperCase().replace(/\s+/g, '')
    if (!normalized) return
    const fullSymbol = /\.(NS|BO)$/.test(normalized) ? normalized : `${normalized}.NS`
    setInput(tickerLabel(fullSymbol))
    void loadDailyBars(fullSymbol)
  }

  async function exportPng() {
    if (!feed || !latest || bars.length === 0) return
    setExporting(true)
    setSaved(false)
    chartRef.current?.clearCrosshairPosition()
    try {
      const visibleStart = bars[Math.max(0, bars.length - 76)]
      if (!visibleStart) throw new Error('The daily chart has no visible candles to export.')
      const blob = await renderDailyChartPng({
        ticker: symbol,
        exchange: feed.exchange,
        bars,
        startDate: String(visibleStart.time),
        endDate: String(latest.time),
        width: 2048,
        height: 995,
      })

      const link = document.createElement('a')
      link.download = `${tickerLabel(symbol).toLowerCase()}-1d-chart.png`
      link.href = URL.createObjectURL(blob)
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(link.href), 1000)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2200)
    } catch {
      setError('The chart image could not be created. Refresh the data and try again.')
    } finally {
      setExporting(false)
    }
  }

  async function exportTradePng(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!feed) return
    setTradeError('')
    setTradeSaved(false)

    const buy = getTradePoint(buyDate, buyPrice, 'Buy')
    const sell = getTradePoint(sellDate, sellPrice, 'Sell')
    if ('error' in buy) { setTradeError(buy.error); return }
    if ('error' in sell) { setTradeError(sell.error); return }
    if (!buy.value) { setTradeError('Enter the buy date and price to create a trade image.'); return }

    setTradeExporting(true)
    try {
      const blob = await renderTradeChartPng({
        ticker: symbol,
        buy: buy.value,
        ...(sell.value ? { sell: sell.value } : {}),
        width: 2048,
        height: 995,
      })
      downloadBlob(blob, `${tickerLabel(symbol).toLowerCase()}-trade-1d-chart.png`)
      setTradeSaved(true)
      window.setTimeout(() => setTradeSaved(false), 2200)
    } catch (reason) {
      setTradeError(reason instanceof Error ? reason.message : 'The annotated chart image could not be created.')
    } finally {
      setTradeExporting(false)
    }
  }

  return (
    <main
      ref={shellRef}
      className={`app-shell${tradePanelOpen ? ' trade-panel-open' : ''}`}
    >
      <header ref={controlsRef} className="controls" aria-label="Chart controls">
        <form className="symbol-form" onSubmit={submit}>
          <label htmlFor="ticker">NSE</label>
          <input id="ticker" value={input} onChange={(event) => setInput(event.target.value)} aria-label="NSE ticker symbol" spellCheck={false} />
          <span className="timeframe-pill">1D</span>
          <button className="icon-control" type="submit" title="Load daily data" disabled={loading}><RefreshCw size={16} className={loading ? 'spinning' : ''} /></button>
        </form>
        <div className="controls-right">
          {feed && <span className="updated">Updated {updated} IST · {feed.source}</span>}
          <button
            className="trade-image-toggle"
            type="button"
            title="Create a chart with optional buy and sell annotations"
            aria-expanded={tradePanelOpen}
            aria-controls="trade-image-panel"
            onClick={() => setTradePanelOpen((open) => !open)}
          ><SlidersHorizontal size={15} /> Trade image</button>
          <button className="download-button" onClick={() => void exportPng()} disabled={!feed || exporting || loading}>
            {exporting ? <LoaderCircle size={16} className="spinning" /> : saved ? <Check size={16} /> : <ArrowDownToLine size={16} />}
            {exporting ? 'Preparing image' : saved ? 'Image saved' : 'Download PNG'}
          </button>
        </div>
      </header>

      {tradePanelOpen && <form ref={tradePanelRef} id="trade-image-panel" className="trade-image-panel" onSubmit={(event) => void exportTradePng(event)}>
        <TradeInputGroup
          title="Buy / Entry (required)"
          date={buyDate}
          price={buyPrice}
          maxDate={latest ? String(latest.time) : undefined}
          required
          onDateChange={setBuyDate}
          onPriceChange={setBuyPrice}
        />
        <TradeInputGroup
          title="Sell / Exit (optional)"
          date={sellDate}
          price={sellPrice}
          minDate={buyDate || undefined}
          maxDate={latest ? String(latest.time) : undefined}
          onDateChange={setSellDate}
          onPriceChange={setSellPrice}
        />
        <div className="trade-image-actions">
          <button className="download-button" type="submit" disabled={!feed || tradeExporting || loading}>
            {tradeExporting ? <LoaderCircle size={15} className="spinning" /> : tradeSaved ? <Check size={15} /> : <ArrowDownToLine size={15} />}
            {tradeExporting ? 'Preparing image' : tradeSaved ? 'Image saved' : 'Download trade PNG'}
          </button>
          <span>20 before entry · 5 after exit (or latest available).</span>
        </div>
        {tradeError && <p className="trade-image-error" role="alert">{tradeError}</p>}
      </form>}

      <section className="chart-wrap" aria-label="Daily candlestick chart">
        {feed && latest && <div
          className={`export-frame${priceScaleHovered ? ' is-price-scale-hovered' : ''}`}
          onPointerMove={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect()
            const x = event.clientX - bounds.left
            const y = event.clientY - bounds.top
            const onPriceScale = x >= bounds.width - 84 && y >= 41 && y <= bounds.height - 24
            setPriceScaleHovered((hovered) => hovered === onPriceScale ? hovered : onPriceScale)
          }}
          onPointerLeave={() => setPriceScaleHovered(false)}
        >
          <div className="quote-header">
            <span className="quote-symbol">{tickerLabel(symbol)}</span><span>·</span><span>1D</span><span>·</span><span>{feed.exchange}</span>
            <span className="quote-values">O{fmtPrice(latest.open)}&nbsp; H{fmtPrice(latest.high)}&nbsp; L{fmtPrice(latest.low)}&nbsp; C{fmtPrice(latest.close)}&nbsp; <b className={change >= 0 ? 'gain' : 'loss'}>{change >= 0 ? '+' : ''}{fmtPrice(change)} ({changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%)</b></span>
          </div>
          <div className="turnover-table" aria-label="Turnover statistics">
            <div><span>AT (20):</span><strong>{fmtCr(turnover.at20)}</strong></div>
            <div><span>LT:</span><strong>{fmtCr(turnover.last)}</strong></div>
          </div>
          <button
            type="button"
            className="auto-fit-button"
            aria-label="Fit price scale to visible data"
            title="Auto (fits data to screen)"
            onClick={() => chartRef.current?.priceScale('right').setAutoScale(true)}
          >A</button>
          <ChartCanvas key={tradePanelOpen ? 'trade-open' : 'trade-closed'} bars={paintedBars} overlays={overlays} onChartReady={setChart} />
        </div>}

        {!feed && <div className={`data-state ${error ? 'has-error' : ''}`}>
          {loading ? <><LoaderCircle className="spinning" size={24} /><strong>Loading daily NSE data</strong><span>Fetching the latest available daily candles for {tickerLabel(symbol)}.</span></> : error ? <><strong>Daily data unavailable</strong><span>{error}</span><button onClick={() => void loadDailyBars(symbol)}>Try again</button></> : null}
        </div>}
      </section>

    </main>
  )
}

type TradePointResult = { value: { date: string; price: number } | null } | { error: string }

function getTradePoint(date: string, price: string, label: 'Buy' | 'Sell'): TradePointResult {
  if (!date && !price) return { value: null }
  if (!date || !price) return { error: `Enter both the ${label.toLowerCase()} date and price, or leave both blank.` }
  const parsedPrice = Number(price)
  if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) return { error: `${label} price must be a positive number.` }
  return { value: { date, price: parsedPrice } }
}

function downloadBlob(blob: Blob, filename: string) {
  const link = document.createElement('a')
  link.download = filename
  link.href = URL.createObjectURL(blob)
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000)
}

type TradeInputGroupProps = {
  title: string
  date: string
  price: string
  minDate?: string
  maxDate?: string
  required?: boolean
  onDateChange: (value: string) => void
  onPriceChange: (value: string) => void
}

function TradeInputGroup({ title, date, price, minDate, maxDate, required = false, onDateChange, onPriceChange }: TradeInputGroupProps) {
  return <div className="trade-field-group">
    <span className="trade-group-title">{title}</span>
    <div className="trade-input-group">
      <label>Date<input type="date" required={required} value={date} min={minDate} max={maxDate} onChange={(event) => onDateChange(event.target.value)} /></label>
      <label>Price<input type="number" required={required} inputMode="decimal" min="0" step="any" value={price} placeholder="e.g. 1250.50" onChange={(event) => onPriceChange(event.target.value)} /></label>
    </div>
  </div>
}

export default App
