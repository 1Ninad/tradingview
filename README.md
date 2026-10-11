# Daily Indian Stock Chart Viewer

This app shows daily price charts for Indian stocks. It can save a clean chart image.

The chart includes candles, four moving averages, crossover dots, and turnover values. The app uses daily data only.

## Start the app

1. Install Node.js.
2. Open a terminal in this folder.
3. Run `npm install`.
4. Run `npm run dev`.
5. Open the local address shown in the terminal.

## View a stock

Enter a stock symbol, such as `RELIANCE`, `TCS`, or `PTCIL`. Select the refresh button to load its daily chart.

The app adds `.NS` for NSE stocks. Add `.BO` to a symbol to select BSE.

Point to a candle to see its date. Use the `A` button on the right price scale to fit prices to the chart.

Select **Download PNG** to save the chart image. The image contains the chart, price details, and turnover values. It does not contain app controls.

## Create an image for a trade

1. Select **Trade image**.
2. Enter the buy date and price.
3. Enter the sell date and price when available.
4. Select **Download trade PNG**.

Enter a buy date and price. You can leave the sell date and price empty. Both dates must be trading days with available data. Enter prices as numbers. Do not enter the rupee symbol.

The image shows a green buy line and a red sell line. Each line starts at its trade candle and includes its price label. Date arrows point to the trade candles.

The image includes 20 earlier trading candles when that history exists. It ends five trading candles after the sell date when those candles exist. Otherwise, it ends at the latest available candle. If you omit the sell date, the image ends at the latest available candle.

## Data notes

The app requests daily stock data from Yahoo Finance. The source is unofficial. Data can be delayed, incomplete, or unavailable. The app does not create missing candles.

The app is for chart images. It does not place trades or provide exchange-certified data.

## Extend trade images

The app can create a trade image from a symbol and buy and sell details. The image uses the same daily chart as the app. It calculates the chart range from the trade dates.

The current app does not read profit and loss statements. A future version could read a monthly statement, identify each stock and its entry and exit details, then create one annotated image per trade.

## More information

- [TradingView Lightweight Charts](https://www.tradingview.com/lightweight-charts/)
- [Yahoo Finance data delays](https://help.yahoo.com/kb/finance/article-exchanges-data-delays-sln2310.html)
- [NSE real-time data](https://www.nseindia.com/static/market-data/real-time-data-subscription)
