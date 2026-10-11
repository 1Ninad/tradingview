import type { CandlestickData, Time } from 'lightweight-charts'

export type Bar = CandlestickData<Time> & { volume: number }
