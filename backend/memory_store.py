from collections import defaultdict

# In-memory only — resets when the server restarts. Fine for FYP demo scope;
# a production version would use Redis or a DB table keyed by session_id.
MAX_TURNS = 5

_sessions = defaultdict(list)

def get_history(session_id: str) -> list:
    return _sessions[session_id]

def add_turn(session_id: str, question: str, answer: str):
    _sessions[session_id].append({"question": question, "answer": answer})
    _sessions[session_id] = _sessions[session_id][-MAX_TURNS:]

def format_history_for_prompt(session_id: str) -> str:
    history = get_history(session_id)
    if not history:
        return ""
    lines = [f"Q: {turn['question']}\nA: {turn['answer']}" for turn in history]
    return "PREVIOUS CONVERSATION:\n" + "\n\n".join(lines) + "\n\n"