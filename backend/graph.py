import os
import json
from google import genai
from google.genai import types
from dotenv import load_dotenv
from langgraph.graph import StateGraph, END
from typing import TypedDict, Optional
from pinecone import Pinecone
from db_tools import get_price_on_date, get_price_series
from math_tools import moving_average, percent_change
from personas import PERSONAS, select_persona_for_doc, select_persona_for_db
from llm_registry import generate  # config-driven provider selection, see llm_registry.py / llm_config.json
from memory_store import format_history_for_prompt
from dataset_manifest import get_dataset
from db_tools import get_value_on_date, get_value_series

load_dotenv()

# Embeddings stay pinned to Gemini directly (NOT routed through the registry).
# The Pinecone index was built with gemini-embedding-001 at 768 dims — swapping
# embedding providers would require re-ingesting every document. Generation
# (chat completions) is what the registry makes swappable; embeddings are not.
gemini_client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))
pinecone_index = pc.Index("dynamic-agentic-system")

# Minimum Pinecone cosine similarity for a retrieved chunk to be treated as a
# real match. Below this, doc_node assumes the question isn't actually about
# an indexed document (even if classify_intent routed it here) and falls back
# instead of forcing an answer from a weak/irrelevant match.
#
# 0.5 is a placeholder starting point, not a tuned value. Before relying on
# this in a demo: log real match["score"] values for a batch of test
# questions (some that should hit a document, some that shouldn't, e.g.
# "what is a lawyer") and set this to sit between the two clusters you observe.
DOC_MATCH_SCORE_THRESHOLD = 0.5


class GraphState(TypedDict):
    question: str
    session_id: str
    selected_doc_title: Optional[str]
    selected_dataset: Optional[str]
    intent: Optional[str]
    persona: Optional[str]
    answer: Optional[str]
    page_number: Optional[int]
    screenshot_path: Optional[str]
    suggested_queries: Optional[list]


def classify_intent(state: GraphState) -> GraphState:

    history = format_history_for_prompt(state.get("session_id", "default"))
    scoped_doc = state.get("selected_doc_title")
    scope_note = (
        f'\nNOTE: The user has scoped this conversation to a specific document: "{scoped_doc}". '
        f'If the question could plausibly relate to that document\'s subject matter, even if phrased '
        f'generically (e.g. "what do you know about NDA" while scoped to an NDA document), prefer "doc" '
        f'over "general" — the user is very likely asking about that document.\n'
        if scoped_doc else ""
    )

    prompt = f"""{history}Classify this question as "doc", "db", or "general". If the question
refers back to the previous conversation (e.g. "what about April?"), use that
context to understand what it's really asking.
{scope_note}
"doc" = the question could plausibly be answered by looking up specific content in
one of the indexed documents — including questions about consequences, terms,
obligations, or figures a document defines — even if the question doesn't
explicitly name the document. The test is "would answering this correctly require
citing a specific document," not whether the phrasing says 'what does X say'.
"db" = questions about stock prices, averages, moving averages, specific dates,
numbers, % change.
"general" = greetings, thanks, small talk, questions about what the assistant
can do, OR clearly generic dictionary-style definitions (e.g. "what is a
lawyer", "what is IFRS") that have an obvious, universal answer independent
of any document. If a term is capitalized/named like a specific system
component (e.g. "the Router Node", "the Persona Selector") rather than a
common word, assume it could be defined by an indexed document and prefer
"doc" — being wrong by citing a document is safer than confidently answering
generically about something the documents actually define.

Examples:
Q: "What does the NDA say about confidentiality duration?" -> doc
Q: "What happens if confidential information is disclosed?" -> doc (asks about consequences a specific agreement defines, even without naming the document)
Q: "What is a lawyer?" -> general (asks for a dictionary-style definition, not tied to any specific document's content)
Q: "What does the Router Node do?" -> doc (capitalized/named component that sounds like it could be defined by a specific system's architecture document — the safer assumption is it refers to a specific document's definition, not a generic dictionary term)
Q: "What personas does this system support?" -> doc
Q: "What is IFRS?" -> general (dictionary-style definition; only "doc" if asking what THIS report specifically says about IFRS)
Q: "What are the penalties for breaching this agreement?" -> doc (asks what consequences a specific document specifies)
Q: "What was MSFT's average price in March?" -> db
Q: "Hey, what can you do?" -> general

Question: {state['question']}

Respond with ONLY one word: doc, db, or general"""

    result_text = generate("classify", prompt).strip().lower()

    # Exact match first — reasoning models can echo words like "general" while
    # reasoning even when their final answer is "doc". Reasoning output should
    # already be stripped by reasoning_format="hidden" in llm_registry.py's
    # _call_groq, but exact-match-first is a cheap safety net regardless of
    # which model/provider ends up behind "classify".
    if result_text == "db":
        intent = "db"
    elif result_text == "general":
        intent = "general"
    elif result_text == "doc":
        intent = "doc"
    else:
        # Unexpected/extra text — fall back to substring matching, most
        # specific label first.
        if "db" in result_text:
            intent = "db"
        elif "general" in result_text:
            intent = "general"
        else:
            intent = "doc"

    return {**state, "intent": intent}


def general_node(state: GraphState) -> GraphState:
    system_prompt = PERSONAS["general_assistant"]
    history = format_history_for_prompt(state.get("session_id", "default"))
    prompt = f"""{system_prompt}

{history}Respond naturally and briefly to this message, using the previous conversation
for context if relevant (e.g. remembering the person's name if they told you). If asked
what you can do, mention you can answer questions about uploaded documents (legal/financial)
and stock market data, with citations.

MESSAGE: {state['question']}
RESPONSE:"""

    answer_text = generate("general", prompt)
    return {
        **state,
        "persona": "general_assistant",
        "answer": answer_text,
        "page_number": None,
        "screenshot_path": None
    }


def route_decision(state: GraphState) -> str:
    return state["intent"]


def _no_document_match_response(state: GraphState) -> GraphState:
    """
    Fallback used when doc_node is reached but no retrieved chunk clears
    DOC_MATCH_SCORE_THRESHOLD. Deliberately does NOT silently hand the
    question to a general-knowledge answer under a document persona (e.g.
    legal_advisor) — that would produce an uncited, unsourced-looking answer
    dressed up with a persona implying it came from a document. Instead this
    says plainly that nothing relevant was found in the indexed documents,
    and lets general conversation happen through general_node/re-asking.
    """
    return {
        **state,
        "persona": "general_assistant",
        "answer": (
            "I couldn't find anything relevant to that in the indexed documents. "
            "If this is a general question rather than one about a specific document, "
            "feel free to ask again and I can answer directly — or ask about the stock data instead."
        ),
        "page_number": None,
        "screenshot_path": None
    }


def _rewrite_query_for_retrieval(question: str, session_id: str) -> str:
    """
    Vague follow-ups like "what page was that on?" carry no real semantic
    content on their own — embedding them directly retrieves whatever's
    nearest in vector space by accident, which can land in a completely
    unrelated document (observed: NDA follow-up retrieved from the financial
    PDF instead). This rewrites the question into a standalone query using
    conversation history BEFORE embedding, so retrieval — not just generation —
    is history-aware.

    Skipped entirely when there's no history (turn 1 of any session), so this
    adds zero extra cost to the common single-turn case.
    """
    history = format_history_for_prompt(session_id)
    if not history:
        return question  # nothing to resolve against, use as-is

    prompt = f"""{history}Rewrite the LATEST question below into a standalone question
that makes sense without the previous conversation, using the previous
conversation to fill in what "that", "it", "those", etc. refer to.

If the latest question is already standalone and doesn't depend on the
previous conversation, return it UNCHANGED.

LATEST QUESTION: {question}

Respond with ONLY the rewritten (or unchanged) question, nothing else."""

    rewritten = generate("rewrite", prompt).strip().strip('"')
    return rewritten if rewritten else question

   
_NO_INFO_PHRASES = [
    "do not contain", "does not contain", "doesn't contain",
    "do not mention", "does not mention", "doesn't mention",
    "do not describe", "does not describe", "doesn't describe",
    "no information regarding", "no information about",
    "not mentioned in", "not covered in", "not addressed in",
    "excerpts do not", "excerpt does not",
    "cannot find", "can't find", "unable to find",
    "does not provide", "do not provide",
]

def _answer_indicates_no_info(answer_text: str) -> bool:
    lowered = answer_text.lower()
    return any(phrase in lowered for phrase in _NO_INFO_PHRASES)


def doc_node(state: GraphState) -> GraphState:
    def embed_query(text: str):
        result = gemini_client.models.embed_content(
            model="gemini-embedding-001",
            contents=text,
            config=types.EmbedContentConfig(task_type="RETRIEVAL_QUERY", output_dimensionality=768)
        )
        return result.embeddings[0].values

    retrieval_query = _rewrite_query_for_retrieval(state["question"], state.get("session_id", "default"))
    query_vector = embed_query(retrieval_query)
    query_filter = None
    if state.get("selected_doc_title"):
        query_filter = {"doc_title": {"$eq": state["selected_doc_title"]}}

    results = pinecone_index.query(
        vector=query_vector,
        top_k=3,
        include_metadata=True,
        filter=query_filter
    )

    if not results["matches"]:
        return _no_document_match_response(state)

    matches = results["matches"]
    top_match_score = matches[0]["score"]

    # Score-floor check. Pinecone always returns top_k results by relative
    # similarity even if nothing in the index is actually relevant — it has
    # no built-in concept of "no good match". Without this check, a weakly-
    # related top match (e.g. "lawyer" partially matching an NDA via shared
    # legal vocabulary) gets treated as a real hit.
    if top_match_score < DOC_MATCH_SCORE_THRESHOLD:
        return _no_document_match_response(state)

    top_match = matches[0]["metadata"]
    persona = select_persona_for_doc(top_match.get("doc_type", "general"))
    system_prompt = PERSONAS[persona]

    combined_excerpts = "\n\n---\n\n".join(
        f"(Page {m['metadata']['page_number']}): {m['metadata']['text']}"
        for m in matches
    )

    history = format_history_for_prompt(state.get("session_id", "default"))
    prompt = f"""{system_prompt}

Answer using ONLY the document excerpts below. If they don't contain the answer, say so.

{combined_excerpts}

QUESTION: {state['question']}

Respond with ONLY a JSON object in this exact form, no markdown fences, no extra text:
{{"answer": "<your full answer text, can still reference page numbers in the prose>", "cited_page": <the single page number your answer is PRIMARILY drawn from, as an integer>}}"""

    raw = generate("doc", prompt)
    cleaned = raw.strip().replace("```json", "").replace("```", "").strip()

    # Build a lookup so we can find the *actual* match the model says it used,
    # not just blindly trust matches[0]. Falls back gracefully if parsing
    # fails or the cited page isn't one of the retrieved chunks (e.g. model
    # hallucinated a page number) — same top_match fallback as before, so
    # this can never leave page_number/screenshot_path unset.
    matches_by_page = {m["metadata"]["page_number"]: m["metadata"] for m in matches}

    try:
        parsed = json.loads(cleaned)
        answer_text = parsed["answer"]
        cited_page = parsed.get("cited_page")
        cited_match = matches_by_page.get(cited_page)
    except (json.JSONDecodeError, KeyError, TypeError):
        answer_text = raw  # fall back to raw text so we never lose the answer itself
        cited_match = None

    citation_source = cited_match if cited_match else top_match

    # If the model's own answer says it couldn't find the info, don't show a
    # citation card — showing "evidence" next to an answer that admits it
    # found nothing is misleading and undermines trust in citations that ARE
    # real. Keep the honest answer text, just drop the page/screenshot.
    if _answer_indicates_no_info(answer_text):
        return {
            **state,
            "persona": persona,
            "answer": answer_text,
            "page_number": None,
            "screenshot_path": None
        }

    return {
        **state,
        "persona": persona,
        "answer": answer_text,
        "page_number": citation_source["page_number"],
        "screenshot_path": citation_source.get("screenshot_path")
    }


def db_node(state: GraphState) -> GraphState:
    state = {**state, "persona": select_persona_for_db()}
    selected_dataset = state.get("selected_dataset")

    if selected_dataset:
        # Dynamic path: query whichever CSV-backed dataset the user selected,
        # using its auto-detected schema instead of hardcoded MSFT columns.
        dataset = get_dataset(selected_dataset)
        if not dataset:
            return {**state, "answer": f"Dataset '{selected_dataset}' not found.", "page_number": None, "screenshot_path": None}

        history = format_history_for_prompt(state.get("session_id", "default"))
        value_cols_str = ", ".join(dataset["value_columns"])
        category_hint = f'The category column is "{dataset["category_column"]}".' if dataset["category_column"] else "There is no category column — queries apply to all rows."

        prompt = f"""{history}This dataset has a date column and these value column(s): {value_cols_str}.
{category_hint}

NOTE: This dataset is a fixed historical snapshot, not a live/real-time feed.
If the question asks for the "current," "latest," "today's," "right now," or
otherwise implies real-time data, return {{"type": "no_live_data"}} instead of
guessing a date.

Extract parameters from this question as JSON:
For a value on a specific date, return: {{"type": "value_on_date", "date": "YYYY-MM-DD", "value_column": "<one of the value columns>", "category_value": "<category filter if mentioned, else null>"}}
For a range/average/trend question, return: {{"type": "series", "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD", "value_column": "<one of the value columns>", "operation": "moving_average" or "percent_change", "category_value": "<category filter if mentioned, else null>"}}
If the question does NOT give you enough information (no date, no date range),
return: {{"type": "unclear"}}

Question: {state['question']}

Respond with ONLY JSON, no markdown."""

        raw_response = generate("db", prompt)
        raw = raw_response.strip().replace("```json", "").replace("```", "").strip()

        try:
            params = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return {**state, "answer": "Couldn't parse the dataset query.", "page_number": None, "screenshot_path": None}

        value_column = params.get("value_column") or dataset["value_columns"][0]
        category_value = params.get("category_value")
        query_type = params.get("type")

        if query_type == "no_live_data":
            return {
                **state,
                "answer": f"I don't have real-time data for {dataset['table_name']} — it's a historical snapshot. Ask me about a specific date or date range instead.",
                "page_number": None,
                "screenshot_path": None
            }

        if query_type == "value_on_date":
            date = params.get("date")
            if not date:
                return {**state, "answer": f"I need a specific date to look up {value_column}. Could you give me one?", "page_number": None, "screenshot_path": None}
            result = get_value_on_date(
                table=dataset["table_name"],
                date_column=dataset["date_column"],
                value_column=value_column,
                date=date,
                category_column=dataset["category_column"],
                category_value=category_value
            )
            answer = f"{value_column} on {result['date']} was {result['value']}." if result else "No data found for that date."
            return {**state, "answer": answer, "page_number": None, "screenshot_path": None}

        start_date = params.get("start_date")
        end_date = params.get("end_date")
        if query_type != "series" or not start_date or not end_date:
            return {
                **state,
                "answer": f"I have {dataset['table_name']} data, but need a specific date or date range to answer that.",
                "page_number": None,
                "screenshot_path": None
            }

        series = get_value_series(
            table=dataset["table_name"],
            date_column=dataset["date_column"],
            value_column=value_column,
            start_date=start_date,
            end_date=end_date,
            category_column=dataset["category_column"],
            category_value=category_value
        )
        return {
            **state,
            "answer": json.dumps({
                "series": series,
                "operation": params.get("operation", "moving_average"),
                "start_date": start_date,
                "end_date": end_date,
                "value_column": value_column,
                "generic": True  # tells math_node this used the {dates, values} shape, not {dates, prices}
            })
        }

    # Original path: no dataset selected, falls back to the hardcoded
    # stock_prices/MSFT flow.
    history = format_history_for_prompt(state.get("session_id", "default"))
    prompt = f"""{history}Extract parameters from this stock question as JSON. If the question
refers back to the previous conversation, use that context (e.g. same date range,
same ticker) to fill in missing details.

NOTE: This dataset is historical MSFT data only, not a live/real-time feed. If
the question asks for the "current," "latest," "today's," "right now," or
otherwise implies real-time data, return {{"type": "no_live_data"}} instead of
guessing a date.

For any average/moving average/% change/trend question, return:
{{"type": "series", "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD", "operation": "moving_average" or "percent_change"}}
For a single date price, return: {{"type": "price_on_date", "date": "YYYY-MM-DD"}}
If the question does NOT give you enough information, return: {{"type": "unclear"}}
Assume year 2024 if not specified. Respond with ONLY JSON, no markdown.

Question: {state['question']}"""

    raw_response = generate("db", prompt)
    raw = raw_response.strip().replace("```json", "").replace("```", "").strip()

    try:
        params = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {**state, "answer": "Couldn't parse the stock query.", "page_number": None, "screenshot_path": None}

    query_type = params.get("type")

    if query_type == "no_live_data":
        return {
            **state,
            "answer": "I don't have real-time stock prices — my MSFT data is historical, through 2024. Ask me about a specific date and I can tell you the price then.",
            "page_number": None,
            "screenshot_path": None
        }

    if query_type == "price_on_date":
        date = params.get("date")
        if not date:
            return {**state, "answer": "I need a specific date to look up MSFT's price. Could you give me one?", "page_number": None, "screenshot_path": None}
        result = get_price_on_date(date)
        answer = f"MSFT closed at ${result['close_price']} on {result['date']}." if result else "No data found."
        return {**state, "answer": answer, "page_number": None, "screenshot_path": None}

    start_date = params.get("start_date")
    end_date = params.get("end_date")
    if query_type != "series" or not start_date or not end_date:
        return {
            **state,
            "answer": "I have MSFT stock price data, but need a specific date or date range to answer that — e.g. \"MSFT price on 2024-03-15\" or \"MSFT average in March 2024.\"",
            "page_number": None,
            "screenshot_path": None
        }

    series = get_price_series(start_date, end_date)
    return {
        **state,
        "answer": json.dumps({
            "series": series,
            "operation": params.get("operation", "moving_average"),
            "start_date": start_date,
            "end_date": end_date
        })
    }


def math_node(state: GraphState) -> GraphState:
    try:
        payload = json.loads(state["answer"])
    except (json.JSONDecodeError, TypeError):
        return state

    is_generic = payload.get("generic", False)
    series = payload["series"]
    operation = payload["operation"]

    values = series["values"] if is_generic else series["prices"]
    value_label = payload.get("value_column", "MSFT") if is_generic else "MSFT"

    if not values:
        return {**state, "answer": "No data found for that range."}

    if operation == "percent_change":
        result = percent_change(values[0], values[-1])
        answer = f"{value_label} changed by {result}% from {payload['start_date']} to {payload['end_date']}."
    else:
        result = moving_average(values)
        answer = f"The moving average of {value_label} from {payload['start_date']} to {payload['end_date']} was {result} over {len(values)} data points."

    return {**state, "answer": answer}


def suggestion_node(state: GraphState) -> GraphState:
    """
    Runs after any path (doc/db+math/general) completes. Generates 1-2 relevant
    follow-up questions based on the actual question + answer just produced —
    deliberately placed AFTER the answer exists (not parallel to Router, despite
    the original diagram showing it that way), since a follow-up suggestion needs
    to know what was actually answered to be useful rather than generic.
    """
    prompt = f"""Based on this question and answer, suggest exactly 2 short, natural
follow-up questions the user might want to ask next. Keep each under 12 words.

QUESTION: {state['question']}
ANSWER: {state['answer']}

Respond with ONLY the 2 questions, one per line, no numbering, no extra text."""

    raw = generate("suggestion", prompt)
    suggestions = [line.strip("-•* ").strip() for line in raw.strip().split("\n") if line.strip()]
    suggestions = suggestions[:2]  # safety cap in case the LLM gives more

    return {**state, "suggested_queries": suggestions}


def build_graph():
    graph = StateGraph(GraphState)
    graph.add_node("classify", classify_intent)
    graph.add_node("doc", doc_node)
    graph.add_node("db", db_node)
    graph.add_node("math", math_node)
    graph.add_node("general", general_node)
    graph.add_node("suggestion", suggestion_node)

    graph.set_entry_point("classify")
    graph.add_conditional_edges("classify", route_decision, {"doc": "doc", "db": "db", "general": "general"})
    graph.add_edge("doc", "suggestion")
    graph.add_edge("db", "math")
    graph.add_edge("math", "suggestion")
    graph.add_edge("general", "suggestion")
    graph.add_edge("suggestion", END)

    return graph.compile()


compiled_graph = build_graph()