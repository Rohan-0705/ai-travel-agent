# ✈️ AI Travel Agent — MERN + Agentic AI

A real-time AI travel planning agent built with the MERN stack. It uses agentic reasoning to call tools, stream responses via WebSockets, and generate structured day-wise itineraries for Indian destinations.

---

## 🧠 System Design

```
User → React Chat UI → WebSocket (Socket.io) → Node/Express Backend
                                                        ↓
                                              Agent Controller Loop
                                                        ↓
                                             LLM (GPT-4o-mini via OpenRouter)
                                                        ↓
                                              Tool Calls Layer
                                            ↙       ↓        ↘
                                    Weather API  Places API  Cost Estimator
                                            ↘       ↓        ↙
                                              Structured Response
                                                        ↓
                                        Stream chunks → React UI
                                                        ↓
                                               MongoDB (chat history)
```

---

## ⚙️ Agentic Behavior

The AI is **NOT** just answering — it follows a strict 4-step reasoning loop:

| Step | Action |
|------|--------|
| 1 | `getWeather(city)` — fetches real-time weather |
| 2 | `getPlaces(city)` — fetches top attractions with coordinate validation |
| 3 | `estimateCost(city, days)` — calculates server-side budget breakdown |
| 4 | Generates structured final plan using tool results |

---

## 🧩 Features

- 🤖 **Agentic AI loop** — LLM decides which tools to call and in what order
- ⚡ **Real-time streaming** — response streams token-by-token via WebSockets
- 🌤️ **Weather tool** — live weather via OpenWeatherMap API
- 📍 **Places tool** — top attractions via OpenTripMap with coordinate bounds validation
- 💰 **Cost estimator** — server-calculated budget (hotel + food + transport)
- 🗺️ **Interactive map** — Leaflet map with place markers inside the itinerary card
- 🎙️ **Voice input** — Web Speech API (works in Chrome)
- 🔊 **Voice output** — Speech Synthesis reads the trip summary aloud
- 🧠 **MongoDB chat history** — persists across sessions
- 🔒 **Session persistence** — localStorage session ID survives page refresh

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React (Vite), Socket.io-client, Leaflet |
| Backend | Node.js, Express, Socket.io |
| Database | MongoDB (Mongoose) |
| AI | OpenRouter → GPT-4o-mini |
| APIs | OpenWeatherMap, OpenTripMap |

---

## 📁 Project Structure

```
AI-TRAVEL-AGENT/
├── client/                     # React frontend (Vite)
│   └── src/
│       ├── components/
│       │   ├── Itinerary.jsx   # Trip plan card with map
│       │   └── Map.jsx         # Leaflet map component
│       ├── App.jsx             # Main chat UI + socket logic
│       ├── App.css             # Styles
│       └── main.jsx
│
└── server/                     # Node.js backend
    ├── index.js                # Server, agent loop, tools, socket
    ├── .env                    # API keys (not committed)
    └── package.json
```

---

## 🚀 Getting Started

### 1. Clone the repo

```bash
git clone https://github.com/yourusername/ai-travel-agent.git
cd ai-travel-agent
```

### 2. Set up environment variables

```bash
cd server
cp .env.example .env
# Fill in your API keys in .env
```

### 3. Install dependencies

```bash
# Server
cd server
npm install

# Client
cd ../client
npm install
```

### 4. Run the project

```bash
# Terminal 1 — Start backend
cd server
node index.js

# Terminal 2 — Start frontend
cd client
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

---

## 🔑 Environment Variables

See `.env.example` for all required keys.

| Variable | Description | Get it from |
|----------|-------------|-------------|
| `MONGO_URI` | MongoDB connection string | [mongodb.com](https://mongodb.com) |
| `OPENROUTER_API_KEY` | LLM API key | [openrouter.ai](https://openrouter.ai) |
| `WEATHER_API_KEY` | Weather + Geo API | [openweathermap.org](https://openweathermap.org) |
| `PLACES_API_KEY` | Places of interest API | [opentripmap.com](https://opentripmap.com) |

---

## 💬 Example Queries

```
"Plan a 3-day trip to Goa"
"Karad for 2 days"
"4 day trip to Manali"
"Plan a trip to Jaipur for 5 days"
```

---

## 🔌 Tool Interface

```js
// Tools available to the agent
getWeather(city)          // → { temp, description, humidity }
getPlaces(city)           // → [{ name, lat, lon }]
estimateCost(city, days)  // → { perDay, total, breakdown }
```

---

## 🧠 Master Prompt (Core of Agent Behavior)

```
You are an AI travel agent for INDIA only.
Follow this EXACT 4-step sequence:

STEP 1 → Call getWeather
STEP 2 → Call getPlaces
STEP 3 → Call estimateCost
STEP 4 → Generate final structured plan

RULES:
- Output ONLY valid JSON
- All places MUST be in the destination city
- Use EXACTLY the cost numbers provided
- Generate Morning / Afternoon / Evening for each day
```

---

## 🎤 Interview Explanation

> *"I built an agentic AI system that dynamically decides which tools to call, executes them in sequence, validates the results server-side, and streams a structured response to the UI in real time using WebSockets. The cost data is always server-controlled — the LLM never handles numbers. Place coordinates are validated against city bounding boxes to prevent hallucinated locations."*

---

## 🚀 Possible Extensions

- [ ] Multi-agent system (planner agent + budget agent)
- [ ] Saved trips / bookmarks (MongoDB)
- [ ] Multi-city comparison ("Goa vs Manali")
- [ ] Real SSE streaming instead of word-by-word simulation
- [ ] Booking integrations (hotels, flights)
- [ ] User preference memory

---

## 📄 License

MIT