import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv
import pandas as pd

load_dotenv()
import re

_VALID_TABLE_NAME = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")

def _validate_table(table: str) -> str:
    if not _VALID_TABLE_NAME.match(table):
        raise ValueError(f"Invalid table name: {table!r}")
    return table
engine = create_engine(
    os.getenv("DATABASE_URL"),
    pool_pre_ping=True,   # tests each connection before use, reconnects if Neon dropped it
    pool_recycle=300      # recycle connections every 5 min so they never go stale enough to be closed server-side
)

def get_price_on_date(date: str, ticker: str = "MSFT"):
    query = text("SELECT date, close_price FROM stock_prices WHERE ticker = :ticker AND date = :date")
    with engine.connect() as conn:
        result = conn.execute(query, {"ticker": ticker, "date": date}).fetchone()
    if result:
        return {"date": str(result[0]), "close_price": result[1]}
    return None

def get_average_price(start_date: str, end_date: str, ticker: str = "MSFT"):
    query = text("""
        SELECT close_price FROM stock_prices
        WHERE ticker = :ticker AND date BETWEEN :start AND :end
    """)
    with engine.connect() as conn:
        df = pd.read_sql(query, conn, params={"ticker": ticker, "start": start_date, "end": end_date})
    if df.empty:
        return None
    return {
        "average_price": float(round(df["close_price"].mean(), 2)),
        "start_date": start_date,
        "end_date": end_date,
        "num_days": len(df)
    }

def get_price_range(start_date: str, end_date: str, ticker: str = "MSFT"):
    query = text("""
        SELECT date, close_price FROM stock_prices
        WHERE ticker = :ticker AND date BETWEEN :start AND :end
        ORDER BY date
    """)
    with engine.connect() as conn:
        df = pd.read_sql(query, conn, params={"ticker": ticker, "start": start_date, "end": end_date})
    if df.empty:
        return None
    return {
        "min_price": float(round(df["close_price"].min(), 2)),
        "max_price": float(round(df["close_price"].max(), 2)),
        "start_date": start_date,
        "end_date": end_date
    }
def get_price_series(start_date: str, end_date: str, ticker: str = "MSFT"):
    """Returns raw date+price rows for Math Node to compute on."""
    query = text("""
        SELECT date, close_price FROM stock_prices
        WHERE ticker = :ticker AND date BETWEEN :start AND :end
        ORDER BY date
    """)
    with engine.connect() as conn:
        df = pd.read_sql(query, conn, params={"ticker": ticker, "start": start_date, "end": end_date})
    return {
        "dates": [str(d) for d in df["date"].tolist()],
        "prices": df["close_price"].tolist()
    }
def get_value_on_date(table: str, date_column: str, value_column: str, date: str,
                       category_column: str = None, category_value: str = None):
    table = _validate_table(table)
    date_column = _validate_table(date_column)
    value_column = _validate_table(value_column)
    cat_clause = ""
    params = {"date": date}
    if category_column and category_value:
        category_column = _validate_table(category_column)
        cat_clause = f"AND {category_column} = :category_value"
        params["category_value"] = category_value

    query = text(f"SELECT {date_column}, {value_column} FROM {table} WHERE {date_column} = :date {cat_clause}")
    with engine.connect() as conn:
        result = conn.execute(query, params).fetchone()
    if result:
        return {"date": str(result[0]), "value": float(result[1])}
    return None


def get_value_series(table: str, date_column: str, value_column: str, start_date: str, end_date: str,
                      category_column: str = None, category_value: str = None):
    table = _validate_table(table)
    date_column = _validate_table(date_column)
    value_column = _validate_table(value_column)
    cat_clause = ""
    params = {"start": start_date, "end": end_date}
    if category_column and category_value:
        category_column = _validate_table(category_column)
        cat_clause = f"AND {category_column} = :category_value"
        params["category_value"] = category_value

    query = text(f"""
        SELECT {date_column}, {value_column} FROM {table}
        WHERE {date_column} BETWEEN :start AND :end {cat_clause}
        ORDER BY {date_column}
    """)
    with engine.connect() as conn:
        df = pd.read_sql(query, conn, params=params)
    return {
        "dates": [str(d) for d in df[date_column].tolist()],
        "values": df[value_column].tolist()
    }