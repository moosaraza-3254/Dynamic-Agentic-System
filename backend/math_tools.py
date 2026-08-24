import pandas as pd

def moving_average(prices: list, window: int = None):
    """Simple moving average over a list of prices. If window is None, averages all given prices."""
    series = pd.Series(prices)
    if window is None:
        window = len(prices)
    return float(round(series.rolling(window=window, min_periods=1).mean().iloc[-1], 2))

def percent_change(start_price: float, end_price: float):
    """% change from start to end price."""
    if start_price == 0:
        return None
    change = ((end_price - start_price) / start_price) * 100
    return float(round(change, 2))

def threshold_cross_dates(dates: list, prices: list, threshold: float):
    """Find dates where price crossed above/below a threshold."""
    crossings = []
    for i in range(1, len(prices)):
        prev, curr = prices[i - 1], prices[i]
        if (prev < threshold <= curr) or (prev > threshold >= curr):
            crossings.append(str(dates[i]))
    return crossings