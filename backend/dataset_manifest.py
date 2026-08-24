import json
import os

MANIFEST_PATH = "datasets_manifest.json"

def _load():
    if not os.path.exists(MANIFEST_PATH):
        return []
    with open(MANIFEST_PATH, "r") as f:
        return json.load(f)

def _save(datasets):
    with open(MANIFEST_PATH, "w") as f:
        json.dump(datasets, f, indent=2)

def add_dataset(table_name: str, original_filename: str, rows: int,
                 date_column: str, value_columns: list, category_column: str = None):
    datasets = _load()
    datasets = [d for d in datasets if d["table_name"] != table_name]
    datasets.append({
        "table_name": table_name,
        "original_filename": original_filename,
        "rows": rows,
        "date_column": date_column,
        "value_columns": value_columns,
        "category_column": category_column
    })
    _save(datasets)

def list_datasets():
    return _load()

def get_dataset(table_name: str):
    for d in _load():
        if d["table_name"] == table_name:
            return d
    return None