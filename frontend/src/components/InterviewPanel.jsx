import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { Sparkles, Send, Wand2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Conversational AI interview that collects the inputs needed to generate a document.
 * Calls /api/interview/* endpoints. When the AI marks the interview as complete,
 * the parent is given the conversation id so it can finalize and generate the doc.
 */
export default function InterviewPanel({ docType, industry, onComplete }) {
  const [convo, setConvo] = useState(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [starting, setStarting] = useState(true);
  const scrollRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        setStarting(true);
        const c = await api.interviewStart(docType, industry);
        setConvo(c);
      } catch (e) {
        toast.error("Could not start the interview");
      } finally {
        setStarting(false);
      }
    })();
    // eslint-disable-next-line
  }, [docType, industry]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [convo]);

  const send = async () => {
    if (!input.trim() || !convo || sending) return;
    const text = input.trim();
    setInput("");
    // optimistic
    setConvo((c) => ({ ...c, messages: [...c.messages, { role: "user", content: text }] }));
    setSending(true);
    try {
      const updated = await api.interviewMessage(convo.id, text);
      setConvo(updated);
    } catch (e) {
      toast.error("AI failed to respond. Retry.");
    } finally {
      setSending(false);
    }
  };

  const state = convo?.state || {};
  const score = state.completeness_score ?? 0;
  const isComplete = state.is_complete;

  return (
    <div className="nb-card p-5 md:p-6" data-testid="interview-panel">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="label-eyebrow">AI Interview</div>
          <h3 className="text-lg font-bold" style={{ fontFamily: "Outfit" }}>
            Let&apos;s gather the requirements
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="nb-chip" data-testid="interview-completeness">{score}% ready</span>
          {isComplete && <span className="nb-chip" style={{ background: "var(--mint)" }}>Ready</span>}
        </div>
      </div>

      {starting && <div className="h-40 rounded-md shimmer" />}

      {convo && (
        <>
          <div
            ref={scrollRef}
            className="border-2 border-[var(--ink)] rounded-lg p-3 bg-[var(--paper)] max-h-80 overflow-y-auto space-y-3"
            data-testid="interview-thread"
          >
            {convo.messages.map((m, i) => (
              <div
                key={i}
                className={`max-w-[88%] rounded-lg border-2 border-[var(--ink)] px-3 py-2 text-sm leading-relaxed ${
                  m.role === "user" ? "ml-auto bg-[var(--primary)]" : "bg-[var(--surface)]"
                }`}
              >
                {m.content}
              </div>
            ))}
            {sending && (
              <div className="max-w-[60%] rounded-lg border-2 border-dashed border-[var(--ink)] px-3 py-2 text-xs text-[var(--muted)] shimmer">
                Thinking…
              </div>
            )}
          </div>

          {/* missing & suggestions */}
          {(state.missing_fields?.length || state.suggestions?.length) && (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              {state.missing_fields?.length > 0 && (
                <div className="border-2 border-[var(--ink)] rounded-lg p-3 bg-[var(--surface)]">
                  <div className="label-eyebrow mb-1">Still missing</div>
                  <ul className="list-disc ml-4 space-y-0.5">
                    {state.missing_fields.map((m, i) => <li key={i}>{m}</li>)}
                  </ul>
                </div>
              )}
              {state.suggestions?.length > 0 && (
                <div className="border-2 border-[var(--ink)] rounded-lg p-3 bg-[var(--surface)]">
                  <div className="label-eyebrow mb-1">Suggestions</div>
                  <ul className="list-disc ml-4 space-y-0.5">
                    {state.suggestions.map((m, i) => <li key={i}>{m}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* input + actions */}
          <div className="mt-4">
            <div className="flex gap-2">
              <textarea
                className="nb-input flex-1 min-h-[60px]"
                placeholder="Type your answer…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
                }}
                disabled={sending}
                data-testid="interview-input"
              />
              <button
                className="nb-btn !px-4"
                onClick={send}
                disabled={sending || !input.trim()}
                data-testid="interview-send-btn"
                aria-label="Send"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 mt-3">
              <button
                className="nb-btn"
                disabled={!isComplete && score < 50}
                onClick={() => onComplete?.(convo)}
                data-testid="finish-interview-btn"
              >
                <Sparkles className="w-4 h-4" />
                {isComplete ? "Generate document" : `Generate (${score}% ready)`}
              </button>
              <span className="text-xs text-[var(--muted)]">
                <Wand2 className="w-3 h-3 inline" /> Cmd/Ctrl + Enter to send
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
