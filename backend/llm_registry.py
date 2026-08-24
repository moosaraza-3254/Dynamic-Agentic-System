"""
llm_registry.py

Config-driven LLM provider selection. Each LangGraph node (classify, doc, db,
general) looks up which provider/model to use for generation via
llm_config.json instead of calling groq_client / gemini_client directly.

This does NOT touch embeddings — those stay pinned to Gemini
(gemini-embedding-001, 768-dim) because the existing Pinecone index was built
with that model/dimension. Swapping the embedding model would require
re-ingesting every document. See project handoff notes, Section 2/7.

Usage in graph.py:
    from llm_registry import generate
    answer_text = generate("doc", prompt)   # "doc" = node name, looked up in llm_config.json
"""

import os
import json
from groq import Groq
from google import genai
from dotenv import load_dotenv

load_dotenv()

_CONFIG_PATH = os.path.join(os.path.dirname(__file__), "llm_config.json")

with open(_CONFIG_PATH, "r") as f:
    _NODE_CONFIG = json.load(f)

# Lazy-initialized clients, keyed by provider name. We don't construct a
# client until a node actually asks for that provider, so a missing/blank
# API key for a provider you're not using won't blow up startup.
_clients = {}


def _get_groq_client() -> Groq:
    if "groq" not in _clients:
        _clients["groq"] = Groq(api_key=os.getenv("GROQ_API_KEY"))
    return _clients["groq"]


def _get_gemini_client() -> genai.Client:
    if "gemini" not in _clients:
        _clients["gemini"] = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
    return _clients["gemini"]


def _call_groq(prompt: str, model: str) -> str:
    client = _get_groq_client()
    response = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        reasoning_format="hidden"   # NEW: strips chain-of-thought, returns only the final answer
    )
    return response.choices[0].message.content

def _call_gemini(prompt: str, model: str) -> str:
    client = _get_gemini_client()
    response = client.models.generate_content(model=model, contents=prompt)
    return response.text


_PROVIDER_FUNCS = {
    "groq": _call_groq,
    "gemini": _call_gemini,
}


def generate(node_name: str, prompt: str) -> str:
    """
    Generate text for a given graph node, using whichever provider/model
    llm_config.json specifies for that node.

    node_name: one of "classify", "doc", "db", "general" (matches keys in
    llm_config.json). Raises a clear error if the node isn't configured,
    rather than silently falling back, so misconfiguration is caught early.
    """
    if node_name not in _NODE_CONFIG:
        raise ValueError(
            f"No LLM config found for node '{node_name}'. "
            f"Add an entry to llm_config.json. Configured nodes: {list(_NODE_CONFIG.keys())}"
        )

    node_cfg = _NODE_CONFIG[node_name]
    provider = node_cfg["provider"]
    model = node_cfg["model"]

    if provider not in _PROVIDER_FUNCS:
        raise ValueError(f"Unknown provider '{provider}' for node '{node_name}'. "
                          f"Supported providers: {list(_PROVIDER_FUNCS.keys())}")

    return _PROVIDER_FUNCS[provider](prompt, model)
def get_config() -> dict:
    """Returns the current in-memory config (reflects any live updates made via update_node_provider)."""
    return _NODE_CONFIG


def update_node_provider(node_name: str, provider: str, model: str) -> dict:
    """
    Updates both the in-memory config (so it takes effect immediately, no
    restart needed) and persists to llm_config.json (so it survives a
    restart too). Validates the node exists before writing.
    """
    if node_name not in _NODE_CONFIG:
        raise ValueError(f"Unknown node: {node_name}")
    if provider not in _PROVIDER_FUNCS:
        raise ValueError(f"Unknown provider: {provider}. Supported: {list(_PROVIDER_FUNCS.keys())}")

    _NODE_CONFIG[node_name] = {"provider": provider, "model": model}

    with open(_CONFIG_PATH, "w") as f:
        json.dump(_NODE_CONFIG, f, indent=2)

    return _NODE_CONFIG