import { useState, useRef, useEffect, useCallback } from "react";
import "./App.css";
import ThemeToggle from "./ThemeToggle";

const WS_URL = "ws://localhost:8000/ws/ask";
const API_BASE = "http://localhost:8000";

const STAGE_SEQUENCE = {
    classify: { label: "Understanding your question", order: 0 },
    doc: { label: "Retrieving from documents", order: 1 },
    db: { label: "Querying your data", order: 1 },
    math: { label: "Computing", order: 2 },
    general: { label: "Reasoning", order: 1 },
    suggestion: { label: "Preparing follow-ups", order: 3 },
};

const SCROLL_BOTTOM_THRESHOLD = 80; // px from bottom still counts as "at bottom"
const TEXTAREA_MAX_HEIGHT = 160; // px, ~7 lines before it scrolls internally

function answerKindMeta(intent) {
    if (intent === "doc") return { label: "From documents", dotClass: "bg-[var(--accent)]" };
    if (intent === "db") return { label: "Computed from data", dotClass: "bg-[var(--financial)]" };
    return { label: "General knowledge", dotClass: "bg-[var(--text-tertiary)]" };
}

export default function ChatApp({ initialSuggestion, theme, onToggleTheme }) {

    const [sessionId, setSessionId] = useState(() => crypto.randomUUID());
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState("");
    const [trace, setTrace] = useState([]);
    const [isStreaming, setIsStreaming] = useState(false);
    const [suggestedQueries, setSuggestedQueries] = useState([]);
    const [citation, setCitation] = useState(null);
    const [connectionError, setConnectionError] = useState(null);
    const [lastQuestion, setLastQuestion] = useState(null);
    const [wsDisconnected, setWsDisconnected] = useState(false);

    const [uploadedDocs, setUploadedDocs] = useState([]);
    const [uploadStatus, setUploadStatus] = useState("idle");
    const [uploadError, setUploadError] = useState(null);
    const [selectedDocTitle, setSelectedDocTitle] = useState(null);

    const [datasets, setDatasets] = useState([]);
    const [csvUploadStatus, setCsvUploadStatus] = useState("idle");
    const [csvUploadError, setCsvUploadError] = useState(null);
    const [selectedDataset, setSelectedDataset] = useState(null);

    const [showSettings, setShowSettings] = useState(false);
    const [llmConfig, setLlmConfig] = useState({});
    const [availableProviders, setAvailableProviders] = useState({});
    const [savingNode, setSavingNode] = useState(null);

    const [isAtBottom, setIsAtBottom] = useState(true);
    const [copiedIndex, setCopiedIndex] = useState(null);

    const wsRef = useRef(null);
    const chatEndRef = useRef(null);
    const messagesScrollRef = useRef(null);
    const fileInputRef = useRef(null);
    const csvInputRef = useRef(null);
    const textareaRef = useRef(null);
    const evidenceRef = useRef(null);
    const rootScrollRef = useRef(null);

    const scrollToBottom = useCallback((behavior = "smooth") => {
        chatEndRef.current?.scrollIntoView({ behavior });
    }, []);

    useEffect(() => {
        if (initialSuggestion) {
            sendQuestion(initialSuggestion);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Only auto-scroll when the user is already near the bottom, so reading
    // back through history isn't interrupted by new stream updates.
    useEffect(() => {
        if (isAtBottom) {
            scrollToBottom(messages.length <= 1 ? "auto" : "smooth");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messages, trace]);

    useEffect(() => {
        return () => wsRef.current?.close();
    }, []);

    useEffect(() => {
        fetch(`${API_BASE}/documents`)
            .then((res) => res.json())
            .then((data) => {
                setUploadedDocs(
                    (data.documents || []).map((d) => ({
                        doc_title: d.doc_title,
                        detected_doc_type: d.doc_type,
                        pages: d.pages,
                        chunks_indexed: d.chunks_indexed,
                    }))
                );
            })
            .catch(() => { });

        fetch(`${API_BASE}/datasets`)
            .then((res) => res.json())
            .then((data) => setDatasets(data.datasets || []))
            .catch(() => { });
    }, []);

    function handleMessagesScroll() {
        const el = messagesScrollRef.current;
        if (!el) return;
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        setIsAtBottom(distanceFromBottom < SCROLL_BOTTOM_THRESHOLD);
    }

    function openSettings() {
        setShowSettings(true);
        fetch(`${API_BASE}/llm-config`).then((r) => r.json()).then(setLlmConfig).catch(() => { });
        fetch(`${API_BASE}/llm-providers`).then((r) => r.json()).then(setAvailableProviders).catch(() => { });
    }

    async function handleProviderChange(node, provider) {
        const models = availableProviders[provider] || [];
        const model = models[0];
        if (!model) return;
        setSavingNode(node);
        try {
            const res = await fetch(`${API_BASE}/llm-config`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ node, provider, model }),
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            setLlmConfig(data.config);
        } catch (err) {
            console.error("Failed to update provider:", err);
        } finally {
            setSavingNode(null);
        }
    }

    function handleNewConversation() {
        wsRef.current?.close();
        setSessionId(crypto.randomUUID());
        setMessages([]);
        setInput("");
        setTrace([]);
        setSuggestedQueries([]);
        setCitation(null);
        setConnectionError(null);
        setLastQuestion(null);
        setWsDisconnected(false);
        setIsStreaming(false);
        setIsAtBottom(true);
    }

    function sendQuestion(question) {
        const text = question.trim();
        if (!text || isStreaming) return;

        setLastQuestion(text);
        setMessages((prev) => [...prev, { role: "user", content: text, ts: Date.now() }]);
        setInput("");
        resizeTextarea(true);
        setTrace([]);
        setSuggestedQueries([]);
        setConnectionError(null);
        setWsDisconnected(false);
        setIsStreaming(true);
        setIsAtBottom(true);

        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onopen = () => {
            ws.send(
                JSON.stringify({
                    question: text,
                    session_id: sessionId,
                    selected_doc_title: selectedDocTitle,
                    selected_dataset: selectedDataset,
                })
            );
        };

        ws.onmessage = (event) => {
            let data;
            try {
                data = JSON.parse(event.data);
            } catch {
                return;
            }

            if (data.type === "node_update") {
                setTrace((prev) => [...prev, data]);
            } else if (data.type === "final") {
                const isUncertain =
                    typeof data.answer === "string" &&
                    data.answer.toLowerCase().includes("couldn't find anything relevant");

                setMessages((prev) => [
                    ...prev,
                    {
                        role: "assistant",
                        content: data.answer,
                        persona: data.persona,
                        intent: data.intent,
                        page_number: data.page_number,
                        screenshot_path: data.screenshot_path,
                        uncertain: isUncertain,
                        ts: Date.now(),
                    },
                ]);
                setSuggestedQueries(data.suggested_queries || []);
                if (data.page_number != null || data.screenshot_path) {
                    setCitation({ page_number: data.page_number, screenshot_path: data.screenshot_path });
                } else {
                    setCitation(null);
                }
                setIsStreaming(false);
                ws.close();
            }
        };

        ws.onerror = () => {
            setConnectionError("Couldn't reach the backend. Check that the server is running.");
            setIsStreaming(false);
        };

        ws.onclose = () => {
            setIsStreaming((was) => {
                if (was) setWsDisconnected(true);
                return false;
            });
        };
    }

    function handleSubmit(e) {
        e.preventDefault();
        sendQuestion(input);
    }

    function handleInputKeyDown(e) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendQuestion(input);
        }
    }

    function resizeTextarea(reset = false) {
        const el = textareaRef.current;
        if (!el) return;
        if (reset) {
            el.style.height = "auto";
            return;
        }
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
    }

    function handleInputChange(e) {
        setInput(e.target.value);
        resizeTextarea();
    }

    function handleRetry() {
        if (lastQuestion) sendQuestion(lastQuestion);
    }

    function handleSuggestionClick(q) {
        sendQuestion(q);
    }

    function handleUploadClick() {
        fileInputRef.current?.click();
    }

    function handleDocClick(docTitle) {
        setSelectedDocTitle((prev) => (prev === docTitle ? null : docTitle));
    }

    function handleCsvUploadClick() {
        csvInputRef.current?.click();
    }

    function handleDatasetClick(tableName) {
        setSelectedDataset((prev) => (prev === tableName ? null : tableName));
    }

    function handleCitationOpen(payload) {
        setCitation(payload);
        // Bring the evidence panel into view — handles both the narrow-viewport
        // case (panel scrolled off horizontally) and a scrolled-away vertical case.
        evidenceRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "end" });
    }

    async function handleCopy(text, index) {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedIndex(index);
            setTimeout(() => setCopiedIndex((cur) => (cur === index ? null : cur)), 1500);
        } catch {
            // Clipboard API unavailable or blocked — fail silently, button stays as "Copy".
        }
    }

    async function handleFileSelected(e) {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;

        if (!file.name.toLowerCase().endsWith(".pdf")) {
            setUploadStatus("error");
            setUploadError("Only PDF files are supported.");
            return;
        }

        setUploadStatus("uploading");
        setUploadError(null);
        const formData = new FormData();
        formData.append("file", file);

        try {
            setUploadStatus("indexing");
            const res = await fetch(`${API_BASE}/upload`, { method: "POST", body: formData });
            const data = await res.json();
            if (!res.ok || data.error) throw new Error(data.error || `Upload failed (${res.status})`);

            setUploadedDocs((prev) => [
                ...prev.filter((d) => d.doc_title !== data.doc_title),
                {
                    doc_title: data.doc_title,
                    detected_doc_type: data.detected_doc_type,
                    pages: data.pages,
                    chunks_indexed: data.chunks_indexed,
                },
            ]);
            setUploadStatus("idle");
        } catch (err) {
            setUploadStatus("error");
            setUploadError(err.message || "Upload failed. Check the server and try again.");
        }
    }

    async function handleCsvFileSelected(e) {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;

        if (!file.name.toLowerCase().endsWith(".csv")) {
            setCsvUploadStatus("error");
            setCsvUploadError("Only CSV files are supported.");
            return;
        }

        setCsvUploadStatus("uploading");
        setCsvUploadError(null);
        const formData = new FormData();
        formData.append("file", file);

        try {
            setCsvUploadStatus("indexing");
            const res = await fetch(`${API_BASE}/upload-csv`, { method: "POST", body: formData });
            const data = await res.json();
            if (!res.ok || data.error) throw new Error(data.error || `Upload failed (${res.status})`);

            setDatasets((prev) => [
                ...prev.filter((d) => d.table_name !== data.table_name),
                {
                    table_name: data.table_name,
                    original_filename: file.name,
                    rows: data.rows,
                    date_column: data.date_column,
                    value_columns: data.value_columns,
                    category_column: data.category_column,
                },
            ]);
            setCsvUploadStatus("idle");
        } catch (err) {
            setCsvUploadStatus("error");
            setCsvUploadError(err.message || "Upload failed. Check the server and try again.");
        }
    }

    const emptyStateSuggestions = [];
    if (uploadedDocs[0]) emptyStateSuggestions.push(`What does ${uploadedDocs[0].doc_title} cover?`);
    if (datasets[0]) emptyStateSuggestions.push(`What's the trend in ${datasets[0].original_filename}?`);
    if (emptyStateSuggestions.length === 0) emptyStateSuggestions.push("Upload a document or dataset to get started");

    return (
        <div ref={rootScrollRef} className="h-screen w-screen flex text-[var(--text-primary)] overflow-x-auto" style={{ background: "var(--canvas)", fontFamily: "Inter, sans-serif" }}>
            <aside className="w-72 shrink-0 flex flex-col overflow-y-auto" style={{ background: "var(--surface-1)", borderRight: "1px solid var(--border-quiet)" }}>
                <div className="px-5 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                        <NexusMark />
                        <h1 className="text-lg tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600 }}>Nexus</h1>
                    </div>
                    <button
                        onClick={handleNewConversation}
                        title="Start a new conversation"
                        className="text-xs rounded-md px-2 py-1 transition-colors"
                        style={{ color: "var(--text-tertiary)", border: "1px solid var(--border-quiet)" }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; e.currentTarget.style.borderColor = "var(--accent)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; e.currentTarget.style.borderColor = "var(--border-quiet)"; }}
                    >
                        New chat
                    </button>
                </div>

                <SourceSection
                    title="Documents"
                    items={uploadedDocs.map((d) => ({
                        key: d.doc_title,
                        title: d.doc_title,
                        meta: `${d.detected_doc_type} · ${d.pages}p · ${d.chunks_indexed} chunks`,
                        colorVar: d.detected_doc_type === "legal" ? "var(--accent)" : d.detected_doc_type === "financial" ? "var(--financial)" : "var(--text-tertiary)",
                    }))}
                    selectedKey={selectedDocTitle}
                    onSelect={handleDocClick}
                    emptyText="No documents yet"
                />

                <UploadButton label="Upload document" status={uploadStatus} error={uploadError} onClick={handleUploadClick} />
                <input ref={fileInputRef} type="file" accept="application/pdf" onChange={handleFileSelected} className="hidden" />

                <SourceSection
                    title="Datasets"
                    items={datasets.map((ds) => ({
                        key: ds.table_name,
                        title: ds.original_filename,
                        meta: `${ds.rows} rows · ${ds.value_columns?.join(", ")}${ds.category_column ? ` · by ${ds.category_column}` : ""}`,
                        colorVar: "var(--financial)",
                    }))}
                    selectedKey={selectedDataset}
                    onSelect={handleDatasetClick}
                    emptyText="No datasets yet"
                />

                <UploadButton label="Upload CSV" status={csvUploadStatus} error={csvUploadError} onClick={handleCsvUploadClick} />
                <input ref={csvInputRef} type="file" accept=".csv" onChange={handleCsvFileSelected} className="hidden" />
            </aside>

            <main className="flex-1 flex flex-col min-w-0">
                <div className="px-6 py-4 flex items-center justify-between shrink-0" style={{ borderBottom: "1px solid var(--border-quiet)" }}>
                    <h2 className="text-sm" style={{ color: "var(--text-secondary)" }}>Ask about your documents and data</h2>
                    <div className="flex items-center gap-3">
                        <ThemeToggle theme={theme} onToggle={onToggleTheme} />

                        <button
                            onClick={openSettings}
                            className="text-xs rounded-md px-2.5 py-1.5 transition-colors"
                            style={{
                                color: "var(--text-secondary)",
                                border: "1px solid var(--border-quiet)",
                            }}
                            onMouseEnter={(e) =>
                                (e.currentTarget.style.color = "var(--text-primary)")
                            }
                            onMouseLeave={(e) =>
                                (e.currentTarget.style.color = "var(--text-secondary)")
                            }
                        >
                            Settings
                        </button>

                        <span
                            className="text-xs rounded px-1.5 py-0.5"
                            style={{
                                color: "var(--text-tertiary)",
                                background: "var(--surface-2)",
                                fontFamily: "'JetBrains Mono', monospace",
                            }}
                        >
                            {sessionId.slice(0, 8)}
                        </span>
                    </div>
                </div>

                <div className="flex-1 min-h-0 relative">
                    <div
                        ref={messagesScrollRef}
                        onScroll={handleMessagesScroll}
                        className="h-full overflow-y-auto px-6 py-5 space-y-5"
                    >
                        {(selectedDocTitle || selectedDataset) && (
                            <div className="text-xs rounded-md px-3 py-2 inline-flex items-center gap-2" style={{ background: "var(--accent-dim)", color: "var(--accent)" }}>
                                <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent)" }} />
                                Scoped to {selectedDocTitle || selectedDataset} — click again to search everything
                                <button
                                    onClick={() => { setSelectedDocTitle(null); setSelectedDataset(null); }}
                                    className="ml-1 underline decoration-dotted"
                                    style={{ color: "var(--accent)" }}
                                >
                                    Clear
                                </button>
                            </div>
                        )}

                        {messages.length === 0 && (
                            <div className="max-w-lg mt-8 space-y-3">
                                <p className="text-base" style={{ color: "var(--text-primary)" }}>Ask a question to get started</p>
                                <div className="space-y-2">
                                    {emptyStateSuggestions.map((s, i) => (
                                        <button
                                            key={i}
                                            onClick={() => sendQuestion(s)}
                                            className="block w-full text-left text-sm rounded-lg px-4 py-3 transition-all"
                                            style={{ background: "var(--surface-1)", border: "1px solid var(--border-quiet)", color: "var(--text-secondary)" }}
                                            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.boxShadow = "var(--shadow-sm)"; }}
                                            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-quiet)"; e.currentTarget.style.boxShadow = "none"; }}
                                        >
                                            {s}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {messages.map((m, i) => (
                            <MessageBubble
                                key={i}
                                message={m}
                                index={i}
                                onCitationClick={handleCitationOpen}
                                onCopy={handleCopy}
                                copied={copiedIndex === i}
                            />
                        ))}

                        {isStreaming && <ProgressStages trace={trace} />}

                        {wsDisconnected && !connectionError && (
                            <div className="max-w-md rounded-lg px-4 py-3 text-sm flex items-start justify-between gap-3" style={{ background: "var(--surface-1)", border: "1px solid var(--border-quiet)", color: "var(--text-secondary)" }}>
                                <span className="flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--error)" }} />
                                    Connection lost before a response came back.
                                </span>
                                <button onClick={handleRetry} className="shrink-0 text-xs rounded px-2 py-1" style={{ border: "1px solid var(--border-quiet)" }}>
                                    Retry
                                </button>
                            </div>
                        )}

                        {connectionError && (
                            <div className="max-w-md rounded-lg px-4 py-3 text-sm flex items-start justify-between gap-3" style={{ background: "#2a1414", border: "1px solid var(--error)", color: "var(--error)" }}>
                                <span>{connectionError}</span>
                                <button onClick={handleRetry} className="shrink-0 text-xs rounded px-2 py-1" style={{ border: "1px solid var(--error)" }}>
                                    Retry
                                </button>
                            </div>
                        )}

                        {suggestedQueries.length > 0 && !isStreaming && (
                            <div className="flex flex-wrap gap-2">
                                {suggestedQueries.map((q, i) => (
                                    <button
                                        key={i}
                                        onClick={() => handleSuggestionClick(q)}
                                        className="rounded-full px-3 py-1.5 text-xs transition-all animate-stagger inline-flex items-center gap-1.5"
                                        style={{ animationDelay: `${i * 60}ms`, border: "1px solid var(--border-quiet)", color: "var(--text-secondary)" }}
                                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.color = "var(--accent)"; e.currentTarget.style.background = "var(--accent-dim)"; }}
                                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-quiet)"; e.currentTarget.style.color = "var(--text-secondary)"; e.currentTarget.style.background = "transparent"; }}
                                    >
                                        <span style={{ color: "var(--text-tertiary)" }}>→</span>
                                        {q}
                                    </button>
                                ))}
                            </div>
                        )}

                        <div ref={chatEndRef} />
                    </div>

                    {!isAtBottom && (
                        <button
                            onClick={() => scrollToBottom("smooth")}
                            className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs rounded-full px-3 py-1.5 shadow-lg transition-colors flex items-center gap-1.5"
                            style={{ background: "var(--surface-2)", border: "1px solid var(--border-quiet)", color: "var(--text-secondary)", boxShadow: "var(--shadow-md)" }}
                            onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
                            onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border-quiet)")}
                        >
                            <span aria-hidden="true">↓</span> New messages
                        </button>
                    )}
                </div>

                <form onSubmit={handleSubmit} className="px-6 py-4 shrink-0" style={{ borderTop: "1px solid var(--border-quiet)" }}>
                    <div
                        className="flex gap-2 items-end rounded-xl px-4 py-3 transition-all"
                        style={{ background: "var(--surface-1)", border: "1px solid var(--border-quiet)" }}
                        onFocus={(e) => (e.currentTarget.style.boxShadow = "var(--shadow-glow)")}
                        onBlur={(e) => (e.currentTarget.style.boxShadow = "none")}
                    >
                        <textarea
                            ref={textareaRef}
                            value={input}
                            onChange={handleInputChange}
                            onKeyDown={handleInputKeyDown}
                            placeholder="Ask a question… (Enter to send, Shift+Enter for a new line)"
                            disabled={isStreaming}
                            rows={1}
                            className="flex-1 bg-transparent outline-none text-sm disabled:opacity-50 resize-none leading-6"
                            style={{ color: "var(--text-primary)", maxHeight: TEXTAREA_MAX_HEIGHT }}
                        />
                        <button
                            type="submit"
                            disabled={isStreaming || !input.trim()}
                            className="text-sm rounded-lg px-4 py-1.5 font-medium transition-all disabled:opacity-30 shrink-0"
                            style={{ background: "var(--accent)", color: "#fff" }}
                            onMouseEnter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.boxShadow = "var(--shadow-glow)"; }}
                            onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "none")}
                        >
                            Ask
                        </button>
                    </div>
                </form>
            </main>

            <aside ref={evidenceRef} className="w-96 shrink-0 flex flex-col overflow-y-auto" style={{ background: "var(--surface-1)", borderLeft: "1px solid var(--border-quiet)" }}>
                <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--border-quiet)" }}>
                    <h2 className="text-xs uppercase tracking-wider" style={{ color: "var(--text-tertiary)", fontFamily: "'JetBrains Mono', monospace" }}>
                        Evidence
                    </h2>
                </div>
                <div className="flex-1 px-5 py-4">
                    {!citation && (
                        <div className="rounded-lg px-4 py-6 text-center" style={{ border: "1px dashed var(--border-quiet)" }}>
                            <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
                                Evidence backing doc-grounded answers will appear here as they arrive.
                            </p>
                        </div>
                    )}
                    {citation && (
                        <div className="animate-stagger space-y-3">
                            {citation.screenshot_path ? (
                                <div
                                    className="relative rounded-lg overflow-hidden transition-transform"
                                    style={{ border: "1px solid var(--border-quiet)", boxShadow: "var(--shadow-md)" }}
                                >
                                    {citation.page_number != null && (
                                        <span
                                            className="absolute top-2 left-2 text-[10px] rounded-full px-2 py-0.5"
                                            style={{
                                                background: "rgba(10, 14, 20, 0.72)",
                                                color: "#fff",
                                                fontFamily: "'JetBrains Mono', monospace",
                                                backdropFilter: "blur(4px)",
                                            }}
                                        >
                                            Page {citation.page_number}
                                        </span>
                                    )}
                                    <img
                                        src={`${API_BASE}/images/${citation.screenshot_path.split(/[\\/]/).pop()}`}
                                        alt={`Page ${citation.page_number}`}
                                        className="w-full block"
                                    />
                                </div>
                            ) : (
                                citation.page_number != null && (
                                    <p className="text-xs" style={{ color: "var(--text-secondary)", fontFamily: "'JetBrains Mono', monospace" }}>
                                        Page {citation.page_number}
                                    </p>
                                )
                            )}
                        </div>
                    )}
                </div>
            </aside>

            {showSettings && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
                    <div className="w-[480px] max-h-[80vh] overflow-y-auto rounded-xl" style={{ background: "var(--surface-2)", border: "1px solid var(--border-quiet)", boxShadow: "var(--shadow-md)" }}>
                        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border-quiet)" }}>
                            <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600 }}>LLM provider settings</h2>
                            <button onClick={() => setShowSettings(false)} className="text-sm" style={{ color: "var(--text-tertiary)" }}>
                                Close
                            </button>
                        </div>
                        <div className="p-5 space-y-4">
                            {Object.keys(llmConfig).length === 0 && (
                                <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>Loading…</p>
                            )}
                            {Object.entries(llmConfig).map(([node, cfg]) => (
                                <div key={node} className="flex items-center justify-between rounded-lg px-3 py-2.5" style={{ background: "var(--surface-1)", border: "1px solid var(--border-quiet)" }}>
                                    <div>
                                        <p className="text-sm capitalize" style={{ color: "var(--text-primary)" }}>{node}</p>
                                        <p className="text-xs" style={{ color: "var(--text-tertiary)", fontFamily: "'JetBrains Mono', monospace" }}>{cfg.model}</p>
                                    </div>
                                    <select
                                        value={cfg.provider}
                                        onChange={(e) => handleProviderChange(node, e.target.value)}
                                        disabled={savingNode === node}
                                        className="text-sm rounded-md px-2 py-1.5 disabled:opacity-50"
                                        style={{ background: "var(--surface-2)", border: "1px solid var(--border-quiet)", color: "var(--text-primary)" }}
                                    >
                                        {Object.keys(availableProviders).map((p) => (
                                            <option key={p} value={p}>{p}</option>
                                        ))}
                                    </select>
                                </div>
                            ))}
                            <p className="text-xs pt-3" style={{ color: "var(--text-tertiary)", borderTop: "1px solid var(--border-quiet)" }}>
                                Only Groq is verified end-to-end. Gemini is supported by the architecture but untested here.
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

/* Small node-graph glyph standing in for "dynamic agent orchestration" —
   three connected nodes rather than a generic logotype square. */
function NexusMark() {
    return (
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
            <rect width="22" height="22" rx="6" fill="var(--accent-dim)" />
            <circle cx="6.5" cy="15.5" r="2" fill="var(--accent)" />
            <circle cx="15.5" cy="15.5" r="2" fill="var(--accent)" />
            <circle cx="11" cy="6.5" r="2" fill="var(--accent)" />
            <path d="M8 14.2L9.8 8.3M14 14.2L12.2 8.3" stroke="var(--accent)" strokeWidth="1" strokeLinecap="round" opacity="0.55" />
        </svg>
    );
}

function SourceSection({ title, items, selectedKey, onSelect, emptyText }) {
    return (
        <div className="px-5 py-3">
            <h3 className="text-xs uppercase tracking-wider mb-2" style={{ color: "var(--text-tertiary)", fontFamily: "'JetBrains Mono', monospace" }}>
                {title}
            </h3>
            <div className="space-y-1.5">
                {items.length === 0 && <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>{emptyText}</p>}
                {items.map((item) => {
                    const selected = selectedKey === item.key;
                    return (
                        <div
                            key={item.key}
                            onClick={() => onSelect(item.key)}
                            className="relative rounded-lg pl-4 pr-3 py-2 cursor-pointer transition-all overflow-hidden"
                            style={{
                                background: selected ? "var(--surface-2)" : "transparent",
                                border: `1px solid ${selected ? "var(--accent)" : "var(--border-quiet)"}`,
                                boxShadow: selected ? "var(--shadow-sm)" : "none",
                            }}
                            onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = "var(--surface-2)"; }}
                            onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = "transparent"; }}
                        >
                            <span className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: item.colorVar }} />
                            <p className="text-sm truncate" style={{ color: "var(--text-primary)" }} title={item.title}>{item.title}</p>
                            <p className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)", fontFamily: "'JetBrains Mono', monospace" }}>
                                {item.meta}
                            </p>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function UploadButton({ label, status, error, onClick }) {
    const isBusy = status === "uploading" || status === "indexing";
    const statusText = status === "uploading" ? "Uploading…" : status === "indexing" ? "Indexing…" : label;

    return (
        <div className="px-5 py-2 space-y-1.5">
            {status === "error" && <p className="text-xs" style={{ color: "var(--error)" }}>{error}</p>}
            <button
                onClick={onClick}
                disabled={isBusy}
                className="w-full rounded-lg py-2 text-sm transition-all disabled:opacity-60"
                style={{ border: "1px dashed var(--border-quiet)", color: "var(--text-secondary)" }}
                onMouseEnter={(e) => { if (!isBusy) { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.color = "var(--accent)"; } }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-quiet)"; e.currentTarget.style.color = "var(--text-secondary)"; }}
            >
                {statusText}
            </button>
        </div>
    );
}

function ProgressStages({ trace }) {
    const seenOrders = new Set(trace.map((t) => STAGE_SEQUENCE[t.node]?.order));
    const stages = [
        { order: 0, label: "Understanding your question" },
        { order: 1, label: "Retrieving" },
        { order: 2, label: "Reasoning" },
        { order: 3, label: "Finalizing" },
    ];

    return (
        <div className="max-w-md rounded-lg px-4 py-3.5" style={{ background: "var(--surface-1)", border: "1px solid var(--border-quiet)", boxShadow: "var(--shadow-sm)" }}>
            {stages.map((s, idx) => {
                const done = seenOrders.has(s.order) || [...seenOrders].some((o) => o > s.order);
                const active = !done && (s.order === 0 || [...seenOrders].some((o) => o === s.order - 1));
                const isLast = idx === stages.length - 1;
                return (
                    <div key={s.order} className="flex items-start gap-3">
                        <div className="flex flex-col items-center" style={{ width: 8 }}>
                            <span
                                className={`w-2 h-2 rounded-full shrink-0 ${active ? "animate-soft-pulse" : ""}`}
                                style={{ background: done ? "var(--success)" : active ? "var(--accent)" : "var(--border-quiet)" }}
                            />
                            {!isLast && (
                                <span
                                    className="w-px flex-1"
                                    style={{ minHeight: 16, background: done ? "var(--success)" : "var(--border-quiet)", opacity: done ? 0.5 : 1 }}
                                />
                            )}
                        </div>
                        <span
                            className="text-sm -mt-0.5 pb-2.5"
                            style={{ color: done ? "var(--text-secondary)" : active ? "var(--accent)" : "var(--text-tertiary)" }}
                        >
                            {s.label}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}

function formatTimestamp(ts) {
    if (!ts) return null;
    try {
        return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
        return null;
    }
}

function MessageBubble({ message, index, onCitationClick, onCopy, copied }) {
    const isUser = message.role === "user";
    const time = formatTimestamp(message.ts);

    if (isUser) {
        return (
            <div className="max-w-[70%] ml-auto animate-stagger group">
                <div className="flex items-center justify-end gap-2 mb-1">
                    <button
                        onClick={() => onCopy(message.content, index)}
                        className="text-xs opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        style={{ color: copied ? "var(--success)" : "var(--text-tertiary)" }}
                        title="Copy question"
                    >
                        {copied ? "Copied" : "Copy"}
                    </button>
                </div>
                <div className="rounded-xl px-4 py-2.5 text-sm whitespace-pre-wrap" style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}>
                    {message.content}
                </div>
                {time && (
                    <p className="text-[10px] mt-1 text-right" style={{ color: "var(--text-tertiary)", fontFamily: "'JetBrains Mono', monospace" }}>
                        {time}
                    </p>
                )}
            </div>
        );
    }

    const kind = answerKindMeta(message.intent);
    const hasCitation = message.page_number != null || message.screenshot_path;

    return (
        <div className="max-w-[75%] mr-auto animate-stagger group flex gap-2.5">
            <div
                className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center mt-0.5"
                style={{ background: "var(--accent-dim)", border: "1px solid var(--accent)" }}
                aria-hidden="true"
            >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent)" }} />
            </div>
            <div className="flex-1 min-w-0">
                <div className="rounded-xl px-4 py-3" style={{ background: "var(--surface-1)", border: "1px solid var(--border-quiet)" }}>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-2">
                            <span className={`w-1.5 h-1.5 rounded-full ${kind.dotClass}`} />
                            <span className="text-xs" style={{ color: "var(--text-tertiary)", fontFamily: "'JetBrains Mono', monospace" }}>
                                {kind.label}
                            </span>
                            {hasCitation && (
                                <button
                                    onClick={() => onCitationClick({ page_number: message.page_number, screenshot_path: message.screenshot_path })}
                                    className="text-xs rounded-full px-2 py-0.5 transition-colors"
                                    style={{ background: "var(--accent-dim)", color: "var(--accent)", fontFamily: "'JetBrains Mono', monospace" }}
                                    title="Show evidence for this answer"
                                >
                                    p.{message.page_number}
                                </button>
                            )}
                        </div>
                        <button
                            onClick={() => onCopy(message.content, index)}
                            className="text-xs opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                            style={{ color: copied ? "var(--success)" : "var(--text-tertiary)" }}
                            title="Copy answer"
                        >
                            {copied ? "Copied" : "Copy"}
                        </button>
                    </div>
                    <p className="text-sm whitespace-pre-wrap" style={{ color: message.uncertain ? "var(--text-secondary)" : "var(--text-primary)" }}>
                        {message.content}
                    </p>
                </div>
                {time && (
                    <p className="text-[10px] mt-1" style={{ color: "var(--text-tertiary)", fontFamily: "'JetBrains Mono', monospace" }}>
                        {time}
                    </p>
                )}
            </div>
        </div>
    );
}