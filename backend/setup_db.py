import os
import pandas as pd
import numpy as np
from sqlalchemy import create_engine
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL)

def generate_stock_data():
    np.random.seed(42)
    dates = pd.date_range(start="2024-01-01", end="2024-12-31", freq="B")  # business days only
    price = 370.0  # MSFT starting price approx
    prices = []
    for _ in dates:
        price += np.random.normal(0, 3)  # random daily walk
        prices.append(round(price, 2))

    df = pd.DataFrame({
        "date": dates,
        "ticker": "MSFT",
        "close_price": prices
    })
    return df

def load_to_postgres(df):
    df.to_sql("stock_prices", engine, if_exists="replace", index=False)
    print(f"✅ Loaded {len(df)} rows into 'stock_prices' table.")

if __name__ == "__main__":
    df = generate_stock_data()
    load_to_postgres(df)
    print(df.head())