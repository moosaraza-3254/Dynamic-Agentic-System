import json
import os

MANIFEST_PATH = "documents_manifest.json"

def _load():
    if not os.path.exists(MANIFEST_PATH):
        return []
    with open(MANIFEST_PATH, "r") as f:
        return json.load(f)

def _save(docs):
    with open(MANIFEST_PATH, "w") as f:
        json.dump(docs, f, indent=2)

def add_document(doc_title: str, doc_type: str, pages: int, chunks_indexed: int):
    docs = _load()
    # Replace existing entry for the same title (re-ingestion overwrites), else append
    docs = [d for d in docs if d["doc_title"] != doc_title]
    docs.append({
        "doc_title": doc_title,
        "doc_type": doc_type,
        "pages": pages,
        "chunks_indexed": chunks_indexed
    })
    _save(docs)

def list_documents():
    return _load()