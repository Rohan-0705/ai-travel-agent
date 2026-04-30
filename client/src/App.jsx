import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import Itinerary from "./components/Itinerary";
import SavedTrips from "./components/SavedTrips";
import AgentPlan from "./components/AgentPlan";
import MemoryPanel from "./components/MemoryPanel";
import "./App.css";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "https://travel-ai-backend-tluf.onrender.com";

const socket = io(BACKEND_URL, {
  transports: ["websocket", "polling"]
});


function getSessionId() {
  let id = localStorage.getItem("travel_session_id");
  if (!id) { id = "session_" + Date.now(); localStorage.setItem("travel_session_id", id); }
  return id;
}
const SESSION_ID = getSessionId();

export default function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("");
  const [places, setPlaces] = useState([]);
  const [itinerary, setItinerary] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [savedTrips, setSavedTrips] = useState([]);
  const [showSaved, setShowSaved] = useState(false);
  const [agentPlan, setAgentPlan] = useState(null);
  const [toolLog, setToolLog] = useState([]);
  const [agentDone, setAgentDone] = useState(false);  // NEW: controls AgentPlan collapse
  const [memory, setMemory] = useState(null);
  const [showMemory, setShowMemory] = useState(false);
  const bottomRef = useRef(null);
  const recognitionRef = useRef(null);

  useEffect(() => {
    socket.emit("get_history", { sessionId: SESSION_ID });
    socket.emit("get_memory", { sessionId: SESSION_ID });
    fetchSavedTrips();

    socket.on("history", (history) => {
      const mapped = history.map(h => ({
        role: h.role,
        text: h.role === "assistant" ? tryParseItinerary(h.content) : h.content,
        isHistory: true
      }));
      setMessages(mapped);
    });

    socket.on("memory", (data) => setMemory(data && data.sessionId ? data : null));
    socket.on("status", (msg) => setStatus(msg));
    socket.on("places", (data) => setPlaces(data));

    socket.on("agent_plan", (plan) => {
      setAgentPlan(plan);
      setAgentDone(false);
      setToolLog([]);
    });

    socket.on("tool_result", ({ tool, result }) => {
      setToolLog(prev => [...prev, { tool, result, ts: Date.now() }]);
    });

    socket.on("itinerary", (data) => {
      setItinerary(data);
      setIsSaved(false);
      setAgentDone(true);   // triggers AgentPlan collapse animation
      setMessages(prev => prev.filter(m => !m.streaming));
      if (data.summary) speakText(data.summary.slice(0, 200));
    });

    socket.on("reply_chunk", (chunk) => {
      setStatus("");
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && last?.streaming) {
          return [...prev.slice(0, -1), { ...last, text: last.text + chunk }];
        }
        return [...prev, { role: "assistant", text: chunk, streaming: true }];
      });
    });

    socket.on("reply_done", () => {
      setStatus("");
      setIsLoading(false);
      setMessages(prev => {
        const updated = [...prev];
        const lastIdx = updated.map(m => m.streaming).lastIndexOf(true);
        if (lastIdx !== -1) updated[lastIdx] = { ...updated[lastIdx], streaming: false };
        return updated;
      });
      socket.emit("get_memory", { sessionId: SESSION_ID });
    });

    socket.on("connect_error", () => {
      setIsLoading(false);
      setStatus("⚠️ Connection lost. Please try again.");
    });

    return () => {
      socket.off("history"); socket.off("memory"); socket.off("status");
      socket.off("places"); socket.off("agent_plan"); socket.off("tool_result");
      socket.off("itinerary"); socket.off("reply_chunk"); socket.off("reply_done");
      socket.off("connect_error");
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status, itinerary]);

  // ── Saved Trips ──────────────────────────────────────────
  async function fetchSavedTrips() {
    try {
      const res = await fetch(`${BACKEND_URL}/api/saved-trips/${SESSION_ID}`);
      if (!res.ok) throw new Error("fetch failed");
      const data = await res.json();
      setSavedTrips(Array.isArray(data) ? data : []);
    } catch (err) { console.error("Failed to fetch saved trips:", err); setSavedTrips([]); }
  }

  async function saveTrip() {
    if (!itinerary) return;

    if (isSaved) {
      alert("Trip already saved!");
      return;
    }
    try {
      const res = await fetch(`${BACKEND_URL}/api/saved-trips`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: SESSION_ID,
          city: itinerary.city || "Unknown",
          days: itinerary.days?.length || 0,
          summary: itinerary.summary,
          itinerary,
          places
        })
      });
      if (!res.ok) throw new Error("Save failed: " + res.status);
      setIsSaved(true);
      await fetchSavedTrips();
      socket.emit("get_memory", { sessionId: SESSION_ID });
    } catch (err) { console.error("Failed to save trip:", err); alert("Could not save trip."); }
  }

  async function deleteTrip(id) {
    try {
      await fetch(`${BACKEND_URL}/api/saved-trips/${id}`, { method: "DELETE" });
      await fetchSavedTrips();
    } catch (err) { console.error("Failed to delete trip:", err); }
  }

  async function clearMemory() {
    try {
      await fetch(`${BACKEND_URL}/api/memory/${SESSION_ID}`, { method: "DELETE" });
      setMemory(null);
    } catch (err) { console.error("Failed to clear memory:", err); }
  }

  function loadTrip(trip) {
    setItinerary(trip.itinerary);
    setPlaces(trip.places || []);
    setIsSaved(true);
    setShowSaved(false);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  }

  function tryParseItinerary(content) {
    try {
      const p = JSON.parse(content);
      return p.summary ? `📋 ${p.summary}` : content;
    } catch { return content; }
  }

  function sendMessage() {
    const text = input.trim();
    if (!text || isLoading) return;
    setMessages(prev => [...prev, { role: "user", text }]);
    setInput("");
    setItinerary(null);
    setPlaces([]);
    setIsSaved(false);
    setAgentPlan(null);
    setAgentDone(false);
    setToolLog([]);
    setIsLoading(true);
    setStatus("🧠 Understanding your request...");
    socket.emit("message", { msg: text, sessionId: SESSION_ID });
  }

  // ── Voice ────────────────────────────────────────────────
  function startListening() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("Voice not supported in this browser"); return; }
    const r = new SR();
    r.lang = "en-IN"; r.continuous = false; r.interimResults = false;
    r.onstart = () => setIsListening(true);
    r.onend = () => setIsListening(false);
    r.onresult = (e) => setInput(e.results[0][0].transcript);
    recognitionRef.current = r;
    r.start();
  }
  function stopListening() { recognitionRef.current?.stop(); setIsListening(false); }

  function speakText(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-IN"; u.rate = 1;
    u.onstart = () => setIsSpeaking(true);
    u.onend = () => setIsSpeaking(false);
    window.speechSynthesis.speak(u);
  }
  function stopSpeaking() { window.speechSynthesis.cancel(); setIsSpeaking(false); }

  return (
    <div className="app">
      <header className="header">
        <span>✈️ AI Travel Agent</span>
        <div className="header-actions">
          {isSpeaking && (
            <button className="stop-speak-btn" onClick={stopSpeaking}>🔇 Stop</button>
          )}
          {memory && (
            <button className="memory-btn" onClick={() => setShowMemory(s => !s)} title="Your travel memory">
              🧠 Memory {memory.pastTrips?.length > 0 && <span className="badge">{memory.pastTrips.length}</span>}
            </button>
          )}
          <button
            className="saved-toggle-btn"
            onClick={() => { setShowSaved(s => !s); fetchSavedTrips(); }}
          >
            🔖 Saved {savedTrips.length > 0 && <span className="badge">{savedTrips.length}</span>}
          </button>
        </div>
      </header>

      <div className="main-layout">
        <div className="chat-area">
          {messages.map((m, i) => (
            <div key={i} className={`bubble ${m.role}`}>
              <span className="bubble-icon">{m.role === "user" ? "🧑" : "🤖"}</span>
              <p>{m.text}{m.streaming && <span className="cursor">▋</span>}</p>
            </div>
          ))}

          {/* AgentPlan — visible while loading, collapses when done */}
          {agentPlan && isLoading && (
            <AgentPlan plan={agentPlan} toolLog={toolLog} done={agentDone} />
          )}

          {status && <div className="status-pill">{status}</div>}

          {itinerary && (
            <Itinerary
              data={itinerary}
              places={places}
              onSave={saveTrip}
              isSaved={isSaved}
            />
          )}

          <div ref={bottomRef} />
        </div>

        {showMemory && memory && (
          <MemoryPanel memory={memory} onClear={clearMemory} onClose={() => setShowMemory(false)} />
        )}

        {showSaved && (
          <SavedTrips
            trips={savedTrips}
            onLoad={loadTrip}
            onDelete={deleteTrip}
            onClose={() => setShowSaved(false)}
          />
        )}
      </div>

      <div className="input-bar">
        <button
          className={`mic-btn ${isListening ? "listening" : ""}`}
          onClick={isListening ? stopListening : startListening}
          disabled={isLoading}
          title="Voice input"
        >
          {isListening ? "🔴" : "🎙️"}
        </button>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && sendMessage()}
          placeholder='Try: "Plan a 3-day trip to Goa"'
          disabled={isLoading}
        />
        <button
          className={`send-btn ${isLoading ? "loading" : ""}`}
          onClick={sendMessage}
          disabled={isLoading}
        >
          {isLoading ? "⏳" : "Send ➤"}
        </button>
      </div>
    </div>
  );
}