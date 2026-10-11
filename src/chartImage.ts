import { createChart, type IChartApi } from 'lightweight-charts'
import type { Bar } from './data'
import { addDailySeries, dailyChartOptions, type TradeAnnotation } from './chartConfig'
import { ema, getTurnover, paintCandles } from './indicators'

export type TradePoint = { date: string; price: number }

export type TradeChartImageOptions = {
  ticker: string
  buy: TradePoint
  sell?: TradePoint
  width?: number
  height?: number
}

export type DailyChartImageOptions = {
  ticker: string
  startDate: string
  endDate: string
  buy?: TradePoint
  sell?: TradePoint
  bars: Bar[]
  exchange: string
  width?: number
  height?: number
}

const defaultSize = { width: 2048, height: 995 }

/**
 * Render a daily stock chart PNG for automation or other programmatic callers.
 * Buy and sell dates use YYYY-MM-DD and must match actual exchange sessions.
 * The chart shows 20 sessions before buy and 5 sessions after sell, or through the latest candle.
 * This browser-side API does not add controls to the app UI or trigger a download.
 */
export async function renderTradeChartPng(options: TradeChartImageOptions): Promise<Blob> {
  validateTradeRequest(options)
  const ticker = normalizeTicker(options.ticker)
  const warmupStart = shiftDate(options.buy.date, -440)
  const query = new URLSearchParams({
    symbol: ticker,
    startDate: warmupStart,
    endDate: todayInIndia(),
  })
  const response = await fetch(`/api/candles?${query}`)
  const payload = await response.json() as { bars?: Bar[]; exchange?: string; error?: string }
  if (!response.ok) throw new Error(payload.error || `Daily history request failed (${response.status}).`)
  const bars = payload.bars ?? []
  const entryIndex = bars.findIndex((bar) => String(bar.time) === options.buy.date)
  if (entryIndex < 0) throw new Error(`No daily candle is available for the buy date ${options.buy.date}. Choose a trading day with data.`)
  const exitIndex = options.sell ? bars.findIndex((bar) => String(bar.time) === options.sell?.date) : -1
  if (options.sell && exitIndex < 0) throw new Error(`No daily candle is available for the sell date ${options.sell.date}. Choose a trading day with data.`)
  if (options.sell && exitIndex < entryIndex) throw new Error('The sell date must be on or after the buy date.')

  const firstIndex = Math.max(0, entryIndex - 20)
  const lastIndex = options.sell ? Math.min(bars.length - 1, exitIndex + 5) : bars.length - 1
  return renderChartImage({
    ...options,
    ticker,
    startDate: String(bars[firstIndex].time),
    endDate: String(bars[lastIndex].time),
    exchange: payload.exchange ?? (ticker.endsWith('.BO') ? 'BSE' : 'NSE'),
    bars,
  })
}

/** Render the already-loaded daily series in the same clean, fixed-size PNG layout. */
export function renderDailyChartPng(options: DailyChartImageOptions): Promise<Blob> {
  validateDailyRequest(options)
  return renderChartImage({ ...options, ticker: normalizeTicker(options.ticker) })
}

async function renderChartImage(options: DailyChartImageOptions): Promise<Blob> {
  const width = boundedSize(options.width ?? defaultSize.width, 'width')
  const height = boundedSize(options.height ?? defaultSize.height, 'height')
  const bars = options.bars
  const firstIndex = bars.findIndex((bar) => String(bar.time) >= options.startDate)
  const lastIndex = bars.findLastIndex((bar) => String(bar.time) <= options.endDate)
  if (firstIndex < 0 || lastIndex < firstIndex) throw new Error(`No daily candles are available for ${options.ticker} in that date range.`)

  const annotations: TradeAnnotation[] = [
    ...(options.buy ? [{ ...options.buy, label: 'BUY' as const }] : []),
    ...(options.sell ? [{ ...options.sell, label: 'SELL' as const }] : []),
  ]
  for (const annotation of annotations) {
    if (!Number.isFinite(annotation.price) || annotation.price <= 0) throw new Error(`${annotation.label.toLowerCase()}.price must be a positive number.`)
    if (annotation.date < options.startDate || annotation.date > options.endDate) throw new Error(`${annotation.label.toLowerCase()}.date must fall within the requested chart range.`)
    if (!bars.some((bar) => String(bar.time) === annotation.date)) {
      throw new Error(`${annotation.label} date ${annotation.date} is not a trading day with available daily data.`)
    }
  }

  const buyIndex = options.buy ? bars.findIndex((bar) => String(bar.time) === options.buy?.date) : -1
  const contextStartIndex = buyIndex >= 0 ? Math.min(firstIndex, Math.max(0, buyIndex - 5)) : firstIndex
  const visibleBars = bars.slice(contextStartIndex, lastIndex + 1)

  const container = document.createElement('div')
  container.setAttribute('aria-hidden', 'true')
  Object.assign(container.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: `${width}px`,
    height: `${height - 42}px`,
    pointerEvents: 'none',
    background: '#ffffff',
  })
  document.body.append(container)
  let chart: IChartApi | undefined
  try {
    chart = createChart(container, dailyChartOptions({ width, height: height - 42, autoSize: false }))
    const overlays = { ema10: ema(bars, 10), ema20: ema(bars, 20), ema50: ema(bars, 50), ema100: ema(bars, 100) }
    const candles = addDailySeries(chart, paintCandles(bars), overlays, annotations)
    const rightSpace = annotations.length ? Math.max(8, Math.ceil(width * 0.15 / 23)) : 2.75
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, contextStartIndex - 0.5), to: lastIndex + rightSpace })
    await nextFrame()
    await nextFrame()

    const chartImage = chart.takeScreenshot(false, false)
    if (!chartImage) throw new Error('The chart renderer did not produce an image.')
    const output = document.createElement('canvas')
    output.width = width
    output.height = height
    const context = output.getContext('2d')
    if (!context) throw new Error('The PNG canvas could not be created.')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.drawImage(chartImage, 0, 42, width, height - 42)
    paintTradeAnnotations(context, chart, candles, bars, annotations, height - 42)
    paintHeader(
      context,
      width,
      options.ticker,
      options.exchange,
      visibleBars.at(-1)!,
      visibleBars.at(-2),
      getTurnover(bars.slice(0, lastIndex + 1)),
    )
    return await canvasBlob(output)
  } finally {
    chart?.remove()
    container.remove()
  }
}

function paintHeader(
  context: CanvasRenderingContext2D,
  width: number,
  ticker: string,
  exchange: string,
  latest: Bar,
  previous: Bar | undefined,
  turnover: ReturnType<typeof getTurnover>,
) {
  const price = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })
  const crore = (value: number | null) => value === null ? '—' : `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value)} Cr`
  const textScale = Math.max(12, Math.min(16, width / 100))
  context.fillStyle = '#17191b'
  context.font = `600 ${textScale}px Arial, sans-serif`
  const title = `${ticker.replace(/\.(NS|BO)$/i, '')} · 1D · ${exchange}`
  context.fillText(title, 13, 27)
  context.font = `500 ${textScale}px Arial, sans-serif`
  const change = previous ? latest.close - previous.close : 0
  const percent = previous ? change / previous.close * 100 : 0
  const quote = `O${price.format(latest.open)}   H${price.format(latest.high)}   L${price.format(latest.low)}   C${price.format(latest.close)}   ${change >= 0 ? '+' : ''}${price.format(change)} (${percent >= 0 ? '+' : ''}${percent.toFixed(2)}%)`
  context.fillText(quote, 13 + context.measureText(`${title}   `).width, 27)

  const table = [
    ['AT (20):', crore(turnover.at20)],
    ['LT:', crore(turnover.last)],
  ]
  const tableX = width - 260
  context.font = '14px Arial, sans-serif'
  table.forEach(([label, value], index) => {
    const y = 24 + index * 24
    context.fillStyle = '#4c5159'
    context.fillText(label, tableX, y)
    context.fillStyle = '#34383e'
    context.font = '600 14px Arial, sans-serif'
    context.fillText(value, tableX + 91, y)
    context.font = '14px Arial, sans-serif'
  })
}

function paintTradeAnnotations(
  context: CanvasRenderingContext2D,
  chart: IChartApi,
  candles: ReturnType<typeof addDailySeries>,
  bars: Bar[],
  annotations: TradeAnnotation[],
  chartHeight: number,
) {
  if (annotations.length === 0) return
  const timeScale = chart.timeScale()
  const plotRight = timeScale.width()
  const price = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })
  const dateLabel = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  const fontSize = Math.max(18, Math.min(28, context.canvas.width / 75))

  context.save()
  context.translate(0, 42)
  context.textBaseline = 'middle'
  context.lineCap = 'round'
  context.lineJoin = 'round'
  for (const annotation of annotations) {
    const x = timeScale.timeToCoordinate(annotation.date)
    const y = candles.priceToCoordinate(annotation.price)
    const bar = bars.find((item) => String(item.time) === annotation.date)
    const candleSideY = bar ? candles.priceToCoordinate(annotation.label === 'SELL' ? bar.high : bar.low) : null
    if (x === null || y === null || candleSideY === null) continue

    const color = annotation.label === 'BUY' ? '#4baf50' : '#f03746'
    const tradeText = `${annotation.label === 'BUY' ? 'Buy' : 'Sell'} ${price.format(annotation.price)}`
    context.font = `600 ${fontSize}px Arial, sans-serif`
    const labelWidth = context.measureText(tradeText).width
    const labelRight = plotRight - 10
    const labelLeft = labelRight - labelWidth
    const labelTop = y - fontSize / 2 - 2
    context.fillStyle = '#ffffff'
    context.fillRect(labelLeft - 5, labelTop, labelWidth + 10, fontSize + 4)
    context.fillStyle = color
    context.textAlign = 'right'
    context.fillText(tradeText, labelRight, y)

    context.strokeStyle = color
    context.lineWidth = 2
    context.beginPath()
    context.moveTo(x, y)
    context.lineTo(Math.max(x + 3, labelLeft - 9), y)
    context.stroke()

    paintDateArrow(context, x, candleSideY, annotation, dateLabel.format(new Date(`${annotation.date}T00:00:00Z`)), chartHeight, fontSize, plotRight)
  }
  context.restore()
}

function paintDateArrow(
  context: CanvasRenderingContext2D,
  x: number,
  candleSideY: number,
  annotation: TradeAnnotation,
  label: string,
  chartHeight: number,
  fontSize: number,
  plotRight: number,
) {
  const arrowColor = '#17191b'
  const headLength = 12
  const headHalfWidth = 10
  const gap = 12
  const downward = annotation.label === 'SELL'
  const labelY = downward && x > plotRight - 280 ? 112 : downward ? 12 : chartHeight - 34
  const tipY = downward ? candleSideY - gap : candleSideY + gap
  const startY = downward ? labelY + fontSize + 15 : chartHeight - 72
  const arrowWingY = tipY + (downward ? -headLength : headLength)

  context.strokeStyle = arrowColor
  context.fillStyle = arrowColor
  context.lineWidth = 3
  context.beginPath()
  context.moveTo(x, startY)
  context.lineTo(x, tipY)
  context.moveTo(x - headHalfWidth, arrowWingY)
  context.lineTo(x, tipY)
  context.lineTo(x + headHalfWidth, arrowWingY)
  context.stroke()

  context.font = `700 ${fontSize}px Arial, sans-serif`
  context.textAlign = 'center'
  context.textBaseline = downward ? 'top' : 'bottom'
  context.fillStyle = arrowColor
  context.fillText(label, x, labelY)
}

function validateTradeRequest(options: TradeChartImageOptions) {
  validateTradePoint(options.buy, 'buy')
  if (options.sell) {
    validateTradePoint(options.sell, 'sell')
    if (options.sell.date < options.buy.date) throw new Error('The sell date must be on or after the buy date.')
  }
  if (options.width !== undefined) boundedSize(options.width, 'width')
  if (options.height !== undefined) boundedSize(options.height, 'height')
}

function validateDailyRequest(options: DailyChartImageOptions) {
  validateDate(options.startDate, 'startDate')
  validateDate(options.endDate, 'endDate')
  if (options.startDate > options.endDate) throw new Error('startDate must be on or before endDate.')
  for (const [label, point] of [['buy', options.buy], ['sell', options.sell]] as const) {
    if (!point) continue
    validateTradePoint(point, label)
    if (point.date < options.startDate || point.date > options.endDate) throw new Error(`${label}.date must fall within the requested chart range.`)
  }
  if (options.width !== undefined) boundedSize(options.width, 'width')
  if (options.height !== undefined) boundedSize(options.height, 'height')
}

function validateTradePoint(point: TradePoint, label: 'buy' | 'sell') {
  validateDate(point.date, `${label}.date`)
  if (!Number.isFinite(point.price) || point.price <= 0) throw new Error(`${label}.price must be a positive number.`)
}

function shiftDate(date: string, days: number) {
  const shifted = new Date(`${date}T00:00:00Z`)
  shifted.setUTCDate(shifted.getUTCDate() + days)
  return shifted.toISOString().slice(0, 10)
}

function todayInIndia() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

function normalizeTicker(value: string) {
  const ticker = value.trim().toUpperCase().replace(/\s+/g, '')
  const full = /\.(NS|BO)$/.test(ticker) ? ticker : `${ticker}.NS`
  if (!/^[A-Z0-9&._-]+\.(NS|BO)$/.test(full)) throw new Error('ticker must be an NSE symbol or a BSE symbol ending in .BO.')
  return full
}

function validateDate(value: string, label: string) {
  const timestamp = Date.parse(`${value}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a valid YYYY-MM-DD date.`)
  }
}

function boundedSize(value: number, label: string) {
  if (!Number.isInteger(value) || value < 480 || value > 4096) throw new Error(`${label} must be an integer between 480 and 4096.`)
  return value
}

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG encoding failed.')), 'image/png')
  })
}
