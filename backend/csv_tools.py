import re
import pandas as pd
from sqlalchemy import create_engine
import os
from dotenv import load_dotenv

load_dotenv()
engine = create_engine(os.getenv("DATABASE_URL"), pool_pre_ping=True, pool_recycle=300)

_VALID_NAME = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")

def _sanitize_name(name: str) -> str:
    """Turns an arbitrary filename/column name into a safe SQL identifier."""
    cleaned = re.sub(r"[^a-zA-Z0-9_]", "_", name.strip().lower())
    if not cleaned or not cleaned[0].isalpha():
        cleaned = "t_" + cleaned
    return cleaned[:63]  # Postgres identifier length limit


def detect_schema(df: pd.DataFrame) -> dict:
    """
    Best-effort auto-detection of a CSV's shape:
    - date_column: first column where >80% of values parse as dates
    - category_column: a low-cardinality text column (e.g. ticker, region, product) — optional
    - value_columns: numeric columns, excluding whatever was picked as date/category
    Returns None for date_column/category_column if nothing qualifies — caller
    should reject the file if date_column is None, since every query type
    (price on date, range, series) depends on having a date axis.
    """
    date_column = None
    for col in df.columns:
        try:
            parsed = pd.to_datetime(df[col], errors="coerce")
            success_rate = parsed.notna().mean()
            if success_rate > 0.8:
                date_column = col
                break
        except Exception:
            continue

    category_column = None
    for col in df.columns:
        if col == date_column:
            continue
        if df[col].dtype == object:
            nunique = df[col].nunique()
            if 1 <= nunique <= 50:  # low-cardinality = plausible category/ticker
                category_column = col
                break

    value_columns = [
        col for col in df.columns
        if col not in (date_column, category_column)
        and pd.api.types.is_numeric_dtype(df[col])
    ]

    return {
        "date_column": date_column,
        "category_column": category_column,
        "value_columns": value_columns
    }


def ingest_csv(file_path: str, original_filename: str) -> dict:
    """
    Reads a CSV, auto-detects its schema, loads it into a new Postgres table,
    and returns the detected schema + table name so it can be registered in
    the datasets manifest. Raises ValueError if no usable date column or
    value column is found — a CSV without either can't support the existing
    query types (price-on-date, range, series).
    """
    df = pd.read_csv(file_path)
    schema = detect_schema(df)

    if not schema["date_column"]:
        raise ValueError("Couldn't find a date column in this CSV. A recognizable date column is required.")
    if not schema["value_columns"]:
        raise ValueError("Couldn't find any numeric value column in this CSV.")

    table_name = _sanitize_name(original_filename.rsplit(".", 1)[0])

    # Normalize column names in the dataframe itself to sanitized versions,
    # and update schema to match, so downstream SQL never touches raw
    # (possibly unsafe/weird) original column names.
    rename_map = {col: _sanitize_name(col) for col in df.columns}
    df = df.rename(columns=rename_map)
    schema = {
        "date_column": rename_map[schema["date_column"]],
        "category_column": rename_map[schema["category_column"]] if schema["category_column"] else None,
        "value_columns": [rename_map[c] for c in schema["value_columns"]]
    }

    df[schema["date_column"]] = pd.to_datetime(df[schema["date_column"]], errors="coerce")
    df.to_sql(table_name, engine, if_exists="replace", index=False)

    return {
        "table_name": table_name,
        "rows": len(df),
        **schema
    }