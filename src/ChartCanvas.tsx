import { useEffect, useRef } from 'react'
import { createChart, type IChartApi } from 'lightweight-charts'
import type { Bar } from './data'
import type { Point } from './indicators'
import { addDailySeries, dailyChartOptions } from './chartConfig'

type Props = {
  bars: Bar[]
  overlays: { ema10: Point[]; ema20: Point[]; ema50: Point[]; ema100: Point[] }
  onChartReady?: (chart: IChartApi | null) => void
}

export function ChartCanvas({ bars, overlays, onChartReady }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!hostRef.current || bars.length === 0) return
    const chart = createChart(hostRef.current, dailyChartOptions())
    onChartReady?.(chart)
    addDailySeries(chart, bars, overlays)
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, bars.length - 76), to: bars.length + 2 })

    return () => {
      chart.remove()
      onChartReady?.(null)
    }
  }, [bars, overlays, onChartReady])

  return <div className="chart-canvas" ref={hostRef} aria-label="Daily NSE candlestick chart with EMA 10, 20, 50 and 100" />
}
