import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, type Plugin } from 'vite'

function json(response: ServerResponse, status: number, payload: unknown) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(payload))
}

function indiaDate(timestamp: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(timestamp * 1000)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

async function marketData(request: IncomingMessage, response: ServerResponse) {
  if (!request.url?.startsWith('/api/candles')) return false
  const url = new URL(request.url, 'http://localhost')
  const symbol = url.searchParams.get('symbol')?.toUpperCase() ?? ''
  const startDate = url.searchParams.get('startDate')
  const endDate = url.searchParams.get('endDate')
  if (!/^[A-Z0-9&._-]+\.(NS|BO)$/.test(symbol)) {
    json(response, 400, { error: 'Enter an NSE ticker (for example TCS or TCS.NS) or a BSE ticker ending in .BO.' })
    return true
  }
  if ((startDate || endDate) && (!isDate(startDate) || !isDate(endDate) || endDate! < startDate!)) {
    json(response, 400, { error: 'Provide startDate and endDate as YYYY-MM-DD, with startDate on or before endDate.' })
    return true
  }

  try {
    const upstream = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`)
    if (startDate && endDate) {
      upstream.searchParams.set('period1', String(Math.floor(Date.parse(`${startDate}T00:00:00Z`) / 1000)))
      upstream.searchParams.set('period2', String(Math.floor(Date.parse(`${endDate}T00:00:00Z`) / 1000) + 86_400))
    } else {
      upstream.searchParams.set('range', '2y')
    }
    upstream.searchParams.set('interval', '1d')
    upstream.searchParams.set('events', 'div,splits')
    const result = await fetch(upstream, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; DailyChartViewer/1.0)',
      },
    })
    if (!result.ok) {
      const status = result.status === 404 ? 404 : 502
      json(response, status, { error: result.status === 429
        ? 'The market data provider is rate limiting requests. Wait a moment, then try again.'
        : `Yahoo Finance could not provide daily history for ${symbol} (HTTP ${result.status}).` })
      return true
    }
    const payload = await result.json() as {
      chart?: { error?: { description?: string } | null; result?: Array<{
        meta: { exchangeName?: string; exchangeTimezoneName?: string }
        timestamp?: number[]
        indicators: { quote?: Array<{ open?: Array<number | null>; high?: Array<number | null>; low?: Array<number | null>; close?: Array<number | null>; volume?: Array<number | null> }> }
      }> }
    }
    const chart = payload.chart?.result?.[0]
    const quote = chart?.indicators.quote?.[0]
    if (!chart || !quote || !chart.timestamp) {
      json(response, 404, { error: payload.chart?.error?.description || `No daily candles were found for ${symbol}.` })
      return true
    }
    const timeZone = chart.meta.exchangeTimezoneName || 'Asia/Kolkata'
    const bars = chart.timestamp.flatMap((time, index) => {
      const open = quote.open?.[index]
      const high = quote.high?.[index]
      const low = quote.low?.[index]
      const close = quote.close?.[index]
      const volume = quote.volume?.[index]
      if ([open, high, low, close].some((value) => value === null || value === undefined || !Number.isFinite(value))) return []
      return [{ time: indiaDate(time, timeZone), open, high, low, close, volume: volume ?? 0 }]
    })
    if (!bars.length) {
      json(response, 404, { error: `No usable daily candles were found for ${symbol}.` })
      return true
    }
    json(response, 200, {
      symbol,
      exchange: symbol.endsWith('.BO') ? 'BSE' : 'NSE',
      source: 'Yahoo Finance',
      retrievedAt: new Date().toISOString(),
      lastBarAt: `${bars[bars.length - 1].time}T00:00:00+05:30`,
      bars,
    })
  } catch {
    json(response, 502, { error: 'Daily market data could not be reached. Check your connection and try again.' })
  }
  return true
}

function isDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const timestamp = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
}

function dailyMarketDataPlugin(): Plugin {
  const middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    void marketData(request, response).then((handled) => { if (!handled) next() })
  }
  return {
    name: 'daily-market-data',
    configureServer(server) { server.middlewares.use(middleware) },
    configurePreviewServer(server) { server.middlewares.use(middleware) },
  }
}

export default defineConfig({ plugins: [dailyMarketDataPlugin(), react()] })
