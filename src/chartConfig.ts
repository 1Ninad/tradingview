import {
  CandlestickSeries,
  ColorType,
  createSeriesMarkers,
  LineSeries,
  TickMarkType,
  type IChartApi,
  type LineWidth,
  type Time,
  type SeriesMarker,
} from 'lightweight-charts'
import type { Bar } from './data'
import { crossoverMarkers, type Point } from './indicators'

export type TradeAnnotation = {
  date: string
  price: number
  label: 'BUY' | 'SELL'
}

export function dailyChartOptions(size?: { width: number; height: number; autoSize?: boolean }) {
  return {
    ...(size?.autoSize === false ? { width: size.width, height: size.height, autoSize: false } : { autoSize: true }),
    layout: {
      background: { type: ColorType.Solid, color: '#ffffff' },
      textColor: '#333333',
      fontFamily: 'Arial, Helvetica, sans-serif',
      fontSize: 12,
      attributionLogo: false,
    },
    grid: {
      vertLines: { visible: false },
      horzLines: { visible: false },
    },
    rightPriceScale: {
      autoScale: true,
      borderVisible: false,
      minimumWidth: 84,
      scaleMargins: { top: 0.18, bottom: 0.18 },
    },
    timeScale: {
      visible: true,
      borderVisible: false,
      timeVisible: false,
      rightOffset: 1,
      barSpacing: 23,
      minBarSpacing: 5,
      tickMarkFormatter: (time: Time, tickMarkType: TickMarkType) => {
        if (typeof time !== 'string') return ''
        const [year, month, day] = time.split('-').map(Number)
        const date = new Date(Date.UTC(year, month - 1, day))
        if (tickMarkType === TickMarkType.Month) return new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(date)
        if (tickMarkType === TickMarkType.Year) return String(year)
        return new Intl.DateTimeFormat('en-IN', { day: 'numeric', timeZone: 'UTC' }).format(date)
      },
    },
    crosshair: {
      vertLine: { color: '#999999', style: 2, labelVisible: true },
      horzLine: { color: '#999999', style: 2, labelVisible: false },
    },
    localization: {
      locale: 'en-IN',
      dateFormat: 'dd MMM yy',
      timeFormatter: (time: Time) => {
        if (typeof time !== 'string') return ''
        const [year, month, day] = time.split('-').map(Number)
        const date = new Date(Date.UTC(year, month - 1, day))
        const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(date)
        const monthName = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(date)
        return `${weekday} ${String(day).padStart(2, '0')} ${monthName} '${String(year).slice(-2)}`
      },
      priceFormatter: (price: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(price),
    },
    handleScroll: true,
    handleScale: true,
  }
}

export function addDailySeries(
  chart: IChartApi,
  bars: Bar[],
  overlays: { ema10: Point[]; ema20: Point[]; ema50: Point[]; ema100: Point[] },
  tradeAnnotations: TradeAnnotation[] = [],
) {
  const emaLineWidth = 1.5 as LineWidth
  // Add the EMA lines first so the candlesticks render above them, as in the reference chart.
  chart.addSeries(LineSeries, { color: '#111111', lineWidth: emaLineWidth, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false }).setData(overlays.ema10)
  chart.addSeries(LineSeries, { color: '#3333ff', lineWidth: emaLineWidth, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false }).setData(overlays.ema20)
  chart.addSeries(LineSeries, { color: '#34b820', lineWidth: emaLineWidth, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false }).setData(overlays.ema50)
  // Red matches the fourth ribbon line in the supplied reference image.
  chart.addSeries(LineSeries, { color: '#ed252b', lineWidth: emaLineWidth, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false }).setData(overlays.ema100)

  const candles = chart.addSeries(CandlestickSeries, {
    upColor: '#ffffff',
    downColor: '#f23645',
    borderVisible: true,
    borderUpColor: '#111111',
    borderDownColor: '#111111',
    wickUpColor: '#111111',
    wickDownColor: '#111111',
    lastValueVisible: true,
    priceLineVisible: false,
    priceFormat: { type: 'price', precision: pricePrecision(bars), minMove: pricePrecision(bars) === 0 ? 1 : 0.05 },
  })
  candles.setData(bars)
  const markers: SeriesMarker<Time>[] = [
    ...crossoverMarkers(bars),
  ]
  createSeriesMarkers(candles, markers, { zOrder: 'aboveSeries' })

  for (const annotation of tradeAnnotations) {
    const endDate = bars.at(-1)?.time
    if (!endDate) continue
    const lineData: { time: Time; value: number }[] = [{ time: annotation.date, value: annotation.price }]
    if (String(endDate) !== annotation.date) lineData.push({ time: endDate, value: annotation.price })
    chart.addSeries(LineSeries, {
      color: annotation.label === 'BUY' ? '#4baf50' : '#f03746',
      lineWidth: 2,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    }).setData(lineData)
  }
  return candles
}

function pricePrecision(bars: Bar[]) {
  const recent = bars.slice(-100)
  return recent.every((bar) => [bar.open, bar.high, bar.low, bar.close].every(Number.isInteger)) ? 0 : 2
}
