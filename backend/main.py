import os
import re
import shutil
import fitz  # pymupdf
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from graph import compiled_graph
from ingest import ingest_document
from llm_registry import generate, get_config, update_node_provider
from memory_store import add_turn
from manifest_store import list_documents
from csv_tools import ingest_csv
from dataset_manifest import add_dataset, list_datasets
from fastapi import WebSocket, WebSocketDisconnect
from typing import Optional

UPLOAD_DIR = "uploaded_pdfs"
IMAGE_DIR = "page_images"
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(IMAGE_DIR, exist_ok=True)

# NOTE: llama-3.3-70b-versatile was deprecated by Groq (see graph.py /
# llm_config.json history) — updated to match the model actually in use.
AVAILABLE_MODELS = {
    "groq": ["openai/gpt-oss-120b"],
    "gemini": ["gemini-2.5-flash-lite"]
}


def clean_answer_text(text: str) -> str:
    """
    Strips common markdown syntax from LLM output before it reaches the
    frontend. The chat UI renders plain text (whitespace-pre-wrap), not
    markdown, so leaving ** or * in place shows literal asterisks to the
    user instead of bold/italic. Keeps the underlying words, just removes
    the formatting characters around them.
    """
    if not isinstance(text, str):
        return text
    text = re.sub(r"\*\*(.*?)\*\*", r"\1", text)   # **bold** -> bold
    text = re.sub(r"\*(.*?)\*", r"\1", text)        # *italic* -> italic
    text = re.sub(r"__(.*?)__", r"\1", text)        # __bold__ -> bold
    text = re.sub(r"`(.*?)`", r"\1", text)           # `code` -> code
    text = re.sub(r"^#+\s*", "", text, flags=re.MULTILINE)  # strip # headers
    return text


def _detect_doc_type(pdf_path: str) -> str:
    doc = fitz.open(pdf_path)
    sample_text = ""
    for page in doc[:2]:
        sample_text += page.get_text()
        if len(sample_text) > 2000:
            break
    sample_text = sample_text[:2000].strip()

    if not sample_text:
        return "general"

    prompt = f"""Classify this document excerpt as "legal", "financial", or "general".
"legal" = contracts, NDAs, agreements, compliance, clauses.
"financial" = financial reports, stock/market data, accounting, IFRS, earnings.
"general" = anything else (project docs, articles, misc content).

EXCERPT:
{sample_text}

Respond with ONLY one word: legal, financial, or general"""

    result = generate("doc_classify", prompt).strip().lower()
    if "legal" in result:
        return "legal"
    elif "financial" in result:
        return "financial"
    return "general"


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/images", StaticFiles(directory=IMAGE_DIR), name="images")


class AskRequest(BaseModel):
    question: str
    session_id: str = "default"
    selected_doc_title: Optional[str] = None
    selected_dataset: Optional[str] = None


class ProviderUpdateRequest(BaseModel):
    node: str
    provider: str
    model: str


@app.post("/ask")
def ask(request: AskRequest):
    result = compiled_graph.invoke({
        "question": request.question,
        "session_id": request.session_id,
        "selected_doc_title": request.selected_doc_title,
        "selected_dataset": request.selected_dataset
    })

    cleaned_answer = clean_answer_text(result.get("answer", ""))
    add_turn(request.session_id, request.question, cleaned_answer)

    return {
        "question": request.question,
        "session_id": request.session_id,
        "intent": result.get("intent"),
        "persona": result.get("persona"),
        "answer": cleaned_answer,
        "page_number": result.get("page_number"),
        "screenshot_path": result.get("screenshot_path"),
        "suggested_queries": result.get("suggested_queries", [])
    }


@app.post("/upload")
async def upload_document(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        return {"error": "Only PDF files are supported."}

    save_path = os.path.join(UPLOAD_DIR, file.filename)
    with open(save_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    detected_type = _detect_doc_type(save_path)
    result = ingest_document(pdf_path=save_path, doc_type=detected_type)

    return {
        "message": "Document indexed successfully.",
        "doc_title": result["doc_title"],
        "detected_doc_type": result["doc_type"],
        "pages": result["pages"],
        "chunks_indexed": result["chunks_indexed"]
    }


@app.post("/upload-csv")
async def upload_csv(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".csv"):
        return {"error": "Only CSV files are supported."}

    save_path = os.path.join(UPLOAD_DIR, file.filename)
    with open(save_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    try:
        result = ingest_csv(save_path, file.filename)
    except ValueError as e:
        return {"error": str(e)}

    add_dataset(
        table_name=result["table_name"],
        original_filename=file.filename,
        rows=result["rows"],
        date_column=result["date_column"],
        value_columns=result["value_columns"],
        category_column=result["category_column"]
    )

    return {
        "message": "Dataset indexed successfully.",
        "table_name": result["table_name"],
        "rows": result["rows"],
        "date_column": result["date_column"],
        "value_columns": result["value_columns"],
        "category_column": result["category_column"]
    }


@app.get("/documents")
def get_documents():
    return {"documents": list_documents()}


@app.get("/datasets")
def get_datasets():
    return {"datasets": list_datasets()}


@app.get("/llm-config")
def get_llm_config():
    return get_config()


@app.get("/llm-providers")
def get_available_providers():
    return AVAILABLE_MODELS


@app.post("/llm-config")
def set_llm_config(request: ProviderUpdateRequest):
    try:
        updated = update_node_provider(request.node, request.provider, request.model)
        return {"message": "Updated.", "config": updated}
    except ValueError as e:
        return {"error": str(e)}


@app.websocket("/ws/ask")
async def ws_ask(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_json()
            question = data.get("question", "")
            session_id = data.get("session_id", "default")
            selected_doc_title = data.get("selected_doc_title")
            selected_dataset = data.get("selected_dataset")

            final_state = {}

            for step in compiled_graph.stream({
                "question": question,
                "session_id": session_id,
                "selected_doc_title": selected_doc_title,
                "selected_dataset": selected_dataset
            }):
                node_name = list(step.keys())[0]
                node_state = step[node_name]
                final_state.update(node_state)

                await websocket.send_json({
                    "type": "node_update",
                    "node": node_name,
                    "status": "completed"
                })

            cleaned_answer = clean_answer_text(final_state.get("answer", ""))
            add_turn(session_id, question, cleaned_answer)

            await websocket.send_json({
                "type": "final",
                "question": question,
                "session_id": session_id,
                "intent": final_state.get("intent"),
                "persona": final_state.get("persona"),
                "answer": cleaned_answer,
                "page_number": final_state.get("page_number"),
                "screenshot_path": final_state.get("screenshot_path"),
                "suggested_queries": final_state.get("suggested_queries", [])
            })
    except WebSocketDisconnect:
        pass

@app.get("/health")
def health():
    return {"status": "ok"}