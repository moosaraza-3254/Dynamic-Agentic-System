import os
import fitz  # pymupdf
import pytesseract
from PIL import Image
from dotenv import load_dotenv
from google import genai
from google.genai import types
from pinecone import Pinecone

pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

load_dotenv()

gemini_client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))
index = pc.Index("dynamic-agentic-system")

# ---- Defaults for manual/CLI usage (python ingest.py). The /upload API
# endpoint in main.py calls ingest_document() directly with its own
# pdf_path/doc_type instead of using these. ----
PDF_PATH = "legal_sample.pdf"
DOC_TYPE = "legal"
IMAGE_DIR = "page_images"

# ---- Chunking config ----
CHUNK_SIZE = 800      # characters per chunk
CHUNK_OVERLAP = 150   # characters shared between consecutive chunks

def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP):
    """Sliding-window chunking with overlap. Stays within a single page's text."""
    if len(text) <= chunk_size:
        return [text]

    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunks.append(text[start:end])
        start += chunk_size - overlap  # step forward, leaving overlap behind
    return chunks

def embed_text(text: str):
    result = gemini_client.models.embed_content(
        model="gemini-embedding-001",
        contents=text,
        config=types.EmbedContentConfig(
            task_type="RETRIEVAL_DOCUMENT",
            output_dimensionality=768
        )
    )
    return result.embeddings[0].values

def ingest_document(pdf_path: str = PDF_PATH, doc_type: str = DOC_TYPE, image_dir: str = IMAGE_DIR) -> dict:
    """
    Reusable ingestion entrypoint — chunk, embed, and upsert a single PDF into
    Pinecone. Used both by this script's __main__ block (manual, hardcoded
    PDF_PATH/DOC_TYPE) and by main.py's /upload endpoint (dynamic, per-request
    pdf_path/doc_type from an uploaded file). Same logic either way — nothing
    about the actual chunking/embedding/upsert changed, just parameterized.
    """
    doc = fitz.open(pdf_path)
    doc_title = os.path.basename(pdf_path)
    vectors_to_upsert = []

    for page_num, page in enumerate(doc, start=1):
        text = page.get_text().strip()

        pix = page.get_pixmap(dpi=150)
        image_path = f"{image_dir}/{doc_title}_page_{page_num}.png"
        pix.save(image_path)

        if not text:
            print(f"Page {page_num}: no text layer, running OCR...")
            text = pytesseract.image_to_string(Image.open(image_path)).strip()

        if not text:
            print(f"Page {page_num}: still empty after OCR, skipping")
            continue

        # ---- Split page text into overlapping chunks ----
        page_chunks = chunk_text(text)

        for chunk_idx, chunk in enumerate(page_chunks):
            embedding = embed_text(chunk)

            vectors_to_upsert.append({
                "id": f"{doc_title}-page{page_num}-chunk{chunk_idx}",
                "values": embedding,
                "metadata": {
                    "text": chunk,
                    "page_number": page_num,
                    "doc_title": doc_title,
                    "doc_type": doc_type,
                    "screenshot_path": image_path
                }
            })

        print(f"Page {page_num}: {len(page_chunks)} chunk(s) embedded and queued")

    index.upsert(vectors=vectors_to_upsert)
    print(f"\n✅ Done. Upserted {len(vectors_to_upsert)} chunks from '{doc_title}' to Pinecone.")

    from manifest_store import add_document
    add_document(doc_title, doc_type, len(doc), len(vectors_to_upsert))

    return {
        "doc_title": doc_title,
        "doc_type": doc_type,
        "pages": len(doc),
        "chunks_indexed": len(vectors_to_upsert)
    }

if __name__ == "__main__":
    ingest_document()