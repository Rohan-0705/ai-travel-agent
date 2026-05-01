import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import Itinerary from "./components/Itinerary";
import SavedTrips from "./components/SavedTrips";
import AgentPlan from "./components/AgentPlan";
import MemoryPanel from "./components/MemoryPanel";
import "./App.css";

const isLocalHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL
  || (isLocalHost ? `http://${window.location.hostname}:5000` : "https://travel-ai-backend-tluf.onrender.com");

const socket = io(BACKEND_URL, {
  transports: ["polling", "websocket"]
});

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getStoredId(key, prefix) {
  let id = localStorage.getItem(key);
  if (!id) {
    id = createId(prefix);
    localStorage.setItem(key, id);
  }
  return id;
}

const CLIENT_ID = getStoredId("travel_client_id", "client");

function getInitialSessionId() {
  return getStoredId("travel_session_id", "session");
}

function tryParseItinerary(content) {
  if (typeof content !== "string") return "";

  try {
    const parsed = JSON.parse(content);
    return parsed.summary ? `Plan ready: ${parsed.summary}` : content;
  } catch {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");

    if (start !== -1 && end > start) {
      try {
        const parsed = JSON.parse(content.slice(start, end + 1));
        if (parsed.summary) return `Plan ready: ${parsed.summary}`;
      } catch {
        // Fall through to the raw JSON guard below.
      }
    }

    if (/\"(?:days|dayExpense|stayPlan|cost)\"/.test(content) || content.includes("dayExpense")) {
      return "Plan ready. Open the trip plan below.";
    }

    return content;
  }
}

function getLastItinerary(history) {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const item = history[i];
    if (item.role !== "assistant") continue;

    try {
      const parsed = JSON.parse(item.content);
      if (parsed?.summary || parsed?.days?.length) return parsed;
    } catch {
      const content = item.content || "";
      const start = content.indexOf("{");
      const end = content.lastIndexOf("}");

      if (start !== -1 && end > start) {
        try {
          const parsed = JSON.parse(content.slice(start, end + 1));
          if (parsed?.summary || parsed?.days?.length) return parsed;
        } catch {
          // Ignore non-JSON assistant messages.
        }
      }
    }
  }

  return null;
}

function formatConversationDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function ConversationHistory({ conversations, activeSessionId, loading, onNewChat, onSelect, onClose }) {
  return (
    <aside className="conversation-sidebar">
      <div className="conversation-header">
        <div>
          <h3>Conversation History</h3>
          <span>{conversations.length} chats</span>
        </div>
        <button className="close-btn" onClick={onClose} aria-label="Close history">x</button>
      </div>

      <button className="new-chat-panel-btn" onClick={onNewChat}>+ New Chat</button>

      {loading && <p className="conversation-empty">Loading chats...</p>}

      {!loading && conversations.length === 0 && (
        <p className="conversation-empty">No old chats yet. Start a new trip plan.</p>
      )}

      <div className="conversation-list">
        {conversations.map((chat) => (
          <button
            key={chat.sessionId}
            className={`conversation-item ${chat.sessionId === activeSessionId ? "active" : ""}`}
            onClick={() => onSelect(chat.sessionId)}
          >
            <span className="conversation-title">{chat.title || "New chat"}</span>
            <span className="conversation-preview">{chat.preview || "No messages yet"}</span>
            <span className="conversation-meta">
              {formatConversationDate(chat.updatedAt)} · {chat.messageCount || 0} messages
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}

export default function App() {
  const [sessionId, setSessionId] = useState(getInitialSessionId);
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
  const [agentDone, setAgentDone] = useState(false);
  const [memory, setMemory] = useState(null);
  const [showMemory, setShowMemory] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [showHistory, setShowHistory] = useState(true);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const activeSessionRef = useRef(sessionId);
  const bottomRef = useRef(null);
  const recognitionRef = useRef(null);
  const composerRef = useRef(null);

  useEffect(() => {
    activeSessionRef.current = sessionId;
    localStorage.setItem("travel_session_id", sessionId);
  }, [sessionId]);

  const fetchConversations = useCallback(async (targetSessionId = activeSessionRef.current) => {
    setIsHistoryLoading(true);
    try {
      const params = new URLSearchParams({ currentSessionId: targetSessionId });
      const res = await fetch(`${BACKEND_URL}/api/conversations/${CLIENT_ID}?${params.toString()}`);
      if (!res.ok) throw new Error("conversation fetch failed");
      const data = await res.json();
      setConversations(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to fetch conversations:", err);
      setConversations([]);
    } finally {
      setIsHistoryLoading(false);
    }
  }, []);

  const fetchSavedTrips = useCallback(async (targetSessionId = activeSessionRef.current) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/saved-trips/${targetSessionId}`);
      if (!res.ok) throw new Error("fetch failed");
      const data = await res.json();
      setSavedTrips(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to fetch saved trips:", err);
      setSavedTrips([]);
    }
  }, []);

  const requestSessionData = useCallback((targetSessionId) => {
    socket.emit("get_history", { sessionId: targetSessionId, clientId: CLIENT_ID });
    socket.emit("get_memory", { sessionId: targetSessionId });
    fetchSavedTrips(targetSessionId);
    fetchConversations(targetSessionId);
  }, [fetchConversations, fetchSavedTrips]);

  const speakText = useCallback((text) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-IN";
    utterance.rate = 1;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => requestSessionData(sessionId), 0);
    return () => window.clearTimeout(timer);
  }, [sessionId, requestSessionData]);

  useEffect(() => {
    const handleHistory = (payload) => {
      const history = Array.isArray(payload) ? payload : payload?.history || [];
      const payloadSessionId = Array.isArray(payload) ? activeSessionRef.current : payload?.sessionId;

      if (payloadSessionId && payloadSessionId !== activeSessionRef.current) return;

      const mapped = history.map((item) => ({
        role: item.role,
        text: item.role === "assistant" ? tryParseItinerary(item.content) : item.content,
        isHistory: true
      }));

      setMessages(mapped);
      setItinerary(getLastItinerary(history));
      setPlaces([]);
      setIsSaved(false);
      fetchConversations(activeSessionRef.current);
    };

    const handleMemory = (data) => setMemory(data && data.sessionId ? data : null);
    const handleStatus = (msg) => setStatus(msg);
    const handlePlaces = (data) => setPlaces(data);

    const handleAgentPlan = (plan) => {
      setAgentPlan(plan);
      setAgentDone(false);
      setToolLog([]);
    };

    const handleToolResult = ({ tool, result }) => {
      setToolLog((prev) => [...prev, { tool, result, ts: Date.now() }]);
    };

    const handleItinerary = (data) => {
      setItinerary(data);
      setIsSaved(false);
      setAgentDone(true);
      setMessages((prev) => prev.filter((message) => !message.streaming));
      if (data.summary) speakText(data.summary.slice(0, 200));
    };

    const handleReplyChunk = (chunk) => {
      setStatus("");
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && last?.streaming) {
          return [...prev.slice(0, -1), { ...last, text: last.text + chunk }];
        }
        return [...prev, { role: "assistant", text: chunk, streaming: true }];
      });
    };

    const handleReplyDone = () => {
      setStatus("");
      setIsLoading(false);
      setMessages((prev) => {
        const updated = [...prev];
        const lastIdx = updated.map((message) => message.streaming).lastIndexOf(true);
        if (lastIdx !== -1) updated[lastIdx] = { ...updated[lastIdx], streaming: false };
        return updated;
      });
      socket.emit("get_memory", { sessionId: activeSessionRef.current });
      fetchConversations(activeSessionRef.current);
    };

    const handleConnectError = () => {
      setIsLoading(false);
      setStatus("Connection lost. Please try again.");
    };

    socket.on("history", handleHistory);
    socket.on("memory", handleMemory);
    socket.on("status", handleStatus);
    socket.on("places", handlePlaces);
    socket.on("agent_plan", handleAgentPlan);
    socket.on("tool_result", handleToolResult);
    socket.on("itinerary", handleItinerary);
    socket.on("reply_chunk", handleReplyChunk);
    socket.on("reply_done", handleReplyDone);
    socket.on("connect_error", handleConnectError);

    return () => {
      socket.off("history", handleHistory);
      socket.off("memory", handleMemory);
      socket.off("status", handleStatus);
      socket.off("places", handlePlaces);
      socket.off("agent_plan", handleAgentPlan);
      socket.off("tool_result", handleToolResult);
      socket.off("itinerary", handleItinerary);
      socket.off("reply_chunk", handleReplyChunk);
      socket.off("reply_done", handleReplyDone);
      socket.off("connect_error", handleConnectError);
    };
  }, [fetchConversations, speakText]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status, itinerary]);

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
          sessionId,
          city: itinerary.city || "Unknown",
          days: itinerary.days?.length || 0,
          summary: itinerary.summary,
          itinerary,
          places
        })
      });
      if (!res.ok) throw new Error("Save failed: " + res.status);
      setIsSaved(true);
      await fetchSavedTrips(sessionId);
      socket.emit("get_memory", { sessionId });
    } catch (err) {
      console.error("Failed to save trip:", err);
      alert("Could not save trip.");
    }
  }

  async function deleteTrip(id) {
    try {
      await fetch(`${BACKEND_URL}/api/saved-trips/${id}`, { method: "DELETE" });
      await fetchSavedTrips(sessionId);
    } catch (err) {
      console.error("Failed to delete trip:", err);
    }
  }

  async function clearMemory() {
    try {
      await fetch(`${BACKEND_URL}/api/memory/${sessionId}`, { method: "DELETE" });
      setMemory(null);
    } catch (err) {
      console.error("Failed to clear memory:", err);
    }
  }

  function loadTrip(trip) {
    setItinerary(trip.itinerary);
    setPlaces(trip.places || []);
    setIsSaved(true);
    setShowSaved(false);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  }

  function startNewChat() {
    if (isLoading) return;
    const nextSessionId = createId("session");
    setInput("");
    setMessages([]);
    setStatus("");
    setPlaces([]);
    setItinerary(null);
    setIsSaved(false);
    setAgentPlan(null);
    setAgentDone(false);
    setToolLog([]);
    setIsLoading(false);
    setMemory(null);
    setSavedTrips([]);
    setShowSaved(false);
    setShowMemory(false);
    setSessionId(nextSessionId);
    if (window.innerWidth <= 720) setShowHistory(false);
  }

  function openConversation(nextSessionId) {
    if (!nextSessionId || nextSessionId === sessionId || isLoading) return;
    setInput("");
    setMessages([]);
    setStatus("");
    setPlaces([]);
    setItinerary(null);
    setIsSaved(false);
    setAgentPlan(null);
    setAgentDone(false);
    setToolLog([]);
    setIsLoading(false);
    setMemory(null);
    setSavedTrips([]);
    setShowSaved(false);
    setShowMemory(false);
    setSessionId(nextSessionId);
    if (window.innerWidth <= 720) setShowHistory(false);
  }

  function sendMessage() {
    const text = input.trim();
    if (!text || isLoading) return;
    setMessages((prev) => [...prev, { role: "user", text }]);
    setInput("");
    if (composerRef.current) composerRef.current.style.height = "";
    setItinerary(null);
    setPlaces([]);
    setIsSaved(false);
    setAgentPlan(null);
    setAgentDone(false);
    setToolLog([]);
    setIsLoading(true);
    setStatus("Understanding your request...");
    socket.emit("message", { msg: text, sessionId, clientId: CLIENT_ID });
  }

  function startListening() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Voice not supported in this browser");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-IN";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onresult = (event) => setInput(event.results[0][0].transcript);
    recognitionRef.current = recognition;
    recognition.start();
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setIsListening(false);
  }

  function stopSpeaking() {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }

  return (
    <div className="app">
      <header className="header">
        <div className="brand-row">
          <button className="history-toggle-btn" onClick={() => setShowHistory((value) => !value)}>
            History
          </button>
          <span className="brand-title">AI Travel Agent</span>
        </div>

        <div className="header-actions">
          <button className="new-chat-btn" onClick={startNewChat} disabled={isLoading}>New Chat</button>
          {isSpeaking && (
            <button className="stop-speak-btn" onClick={stopSpeaking}>Stop</button>
          )}
          {memory && (
            <button className="memory-btn" onClick={() => setShowMemory((value) => !value)} title="Your travel memory">
              Memory {memory.pastTrips?.length > 0 && <span className="badge">{memory.pastTrips.length}</span>}
            </button>
          )}
          <button
            className="saved-toggle-btn"
            onClick={() => { setShowSaved((value) => !value); fetchSavedTrips(sessionId); }}
          >
            Saved {savedTrips.length > 0 && <span className="badge">{savedTrips.length}</span>}
          </button>
        </div>
      </header>

      <div className="main-layout">
        {showHistory && (
          <ConversationHistory
            conversations={conversations}
            activeSessionId={sessionId}
            loading={isHistoryLoading}
            onNewChat={startNewChat}
            onSelect={openConversation}
            onClose={() => setShowHistory(false)}
          />
        )}

        <main className="chat-area">
          {messages.length === 0 && !isLoading && !itinerary && (
            <div className="empty-chat">
              <h2>Where should we plan next?</h2>
              <p>Start a new trip, or open an old conversation from History to resume it.</p>
            </div>
          )}

          {messages.map((message, index) => (
            <div key={`${message.role}-${index}`} className={`bubble ${message.role}`}>
              <span className="bubble-icon">{message.role === "user" ? "You" : "AI"}</span>
              <p>{message.text}{message.streaming && <span className="cursor">|</span>}</p>
            </div>
          ))}

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
        </main>

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
          {isListening ? "Stop" : "Mic"}
        </button>
        <textarea
          ref={composerRef}
          className="composer-input"
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            event.target.style.height = "auto";
            event.target.style.height = `${Math.min(event.target.scrollHeight, 120)}px`;
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              sendMessage();
            }
          }}
          placeholder='Try: "Plan a 3-day trip to Goa"'
          disabled={isLoading}
          rows={1}
        />
        <button
          className={`send-btn ${isLoading ? "loading" : ""}`}
          onClick={sendMessage}
          disabled={isLoading}
        >
          {isLoading ? "Wait" : "Send"}
        </button>
      </div>
    </div>
  );
}
