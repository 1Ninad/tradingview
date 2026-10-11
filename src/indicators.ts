import type { Bar } from './data'
import type { LineData, SeriesMarker, Time } from 'lightweight-charts'

export type Point = LineData<Time>

export function ema(bars: Bar[], length: number): Point[] {
  const output: Point[] = []
  const alpha = 2 / (length + 1)
  let value = 0
  bars.forEach((bar, index) => {
    value = index === 0 ? bar.close : (bar.close - value) * alpha + value
    if (index >= length - 1) output.push({ time: bar.time, value })
  })
  return output
}

export function paintCandles(bars: Bar[]): Bar[] {
  return bars.map((bar, index) => {
    let color: string | undefined
    if (index > 0) {
      const previous = bars[index - 1]
      const range = Math.max(bar.high - bar.low, Number.EPSILON)
      const gainPercent = (bar.close / previous.close - 1) * 100
      const bodyPercent = Math.abs(bar.close - bar.open) / range * 100
      const openingDropPercent = Math.max(bar.open - bar.low, 0) / range * 100
      const hasGoodBody = bodyPercent >= 60
      const validDailyShape = range > 0 && (hasGoodBody || openingDropPercent < 5)
      if (validDailyShape && gainPercent >= 8) color = '#000066'
      else if (validDailyShape && gainPercent >= 3) color = '#3333ff'
    }
    return {
      ...bar,
      color,
      borderColor: '#111111',
      wickColor: '#111111',
    }
  })
}

export function crossoverMarkers(bars: Bar[]): SeriesMarker<Time>[] {
  const fast10 = ema(bars, 10)
  const fast20 = ema(bars, 20)
  const slow50 = ema(bars, 50)
  const byTime = <T extends Point>(points: T[]) => new Map(points.map((point) => [point.time, point.value]))
  const e10 = byTime(fast10)
  const e20 = byTime(fast20)
  const e50 = byTime(slow50)
  const markers: SeriesMarker<Time>[] = []
  bars.forEach((bar, index) => {
    const p10 = e10.get(bar.time)
    const p20 = e20.get(bar.time)
    const p50 = e50.get(bar.time)
    const previousBar = bars[index - 1]
    if (!previousBar || p10 === undefined || p20 === undefined || p50 === undefined) return
    const wasFastAbove20 = (e10.get(previousBar.time) ?? -Infinity) > (e20.get(previousBar.time) ?? Infinity)
    const was20Above50 = (e20.get(previousBar.time) ?? -Infinity) > (e50.get(previousBar.time) ?? Infinity)
    if (p10 > p20 && !wasFastAbove20) markers.push({ time: bar.time, position: 'atPriceMiddle', price: p10, color: '#000000', shape: 'circle', size: 1 })
    if (p20 > p50 && !was20Above50) markers.push({ time: bar.time, position: 'atPriceMiddle', price: p20, color: '#3333ff', shape: 'circle', size: 1 })
  })
  return markers
}

function movingAverage(values: number[], length: number): number | null {
  if (values.length < length) return null
  return values.slice(-length).reduce((sum, value) => sum + value, 0) / length
}

export function getTurnover(bars: Bar[]) {
  const typicalPrices = bars.map((bar) => (bar.high + bar.low + bar.close) / 3)
  const volumes = bars.map((bar) => bar.volume)
  const at50Price = movingAverage(typicalPrices, 50)
  const at50Volume = movingAverage(volumes, 50)
  const at20Price = movingAverage(typicalPrices, 20)
  const at20Volume = movingAverage(volumes, 20)
  const last = bars.at(-1)
  return {
    at50: at50Price !== null && at50Volume !== null ? at50Price * at50Volume / 10_000_000 : null,
    at20: at20Price !== null && at20Volume !== null ? at20Price * at20Volume / 10_000_000 : null,
    last: last ? last.close * last.volume / 10_000_000 : null,
  }
}

export function lastBullishCrossBars(bars: Bar[]): number | null {
  const points = [ema(bars, 10), ema(bars, 20), ema(bars, 50), ema(bars, 200)]
  const maps = points.map((series) => new Map(series.map((point) => [point.time, point.value])))
  let latestCross = -1
  bars.forEach((bar, index) => {
    const previous = bars[index - 1]
    if (!previous) return
    const crossed = [[0, 1], [1, 2], [2, 3]].some(([fastIndex, slowIndex]) => {
      const fast = maps[fastIndex]
      const slow = maps[slowIndex]
      const currentFast = fast?.get(bar.time)
      const currentSlow = slow?.get(bar.time)
      const previousFast = fast?.get(previous.time)
      const previousSlow = slow?.get(previous.time)
      return currentFast !== undefined && currentSlow !== undefined && previousFast !== undefined && previousSlow !== undefined
        && currentFast > currentSlow && previousFast <= previousSlow
    })
    if (crossed) latestCross = index
  })
  return latestCross < 0 ? null : bars.length - 1 - latestCross
}
