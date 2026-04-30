import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import mongoose from "mongoose";


dotenv.config();

const app = express();
app.use(cors({
  origin: [
    "http://localhost:5173",
    "https://ai-travel-agent-three.vercel.app"
  ],
  credentials: true
}));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:5173",
      "https://ai-travel-agent-three.vercel.app"
    ],
    methods: ["GET", "POST"]
  }
});


const chatSchema = new mongoose.Schema({
  sessionId: String,
  role: String,
  content: String,
  timestamp: { type: Date, default: Date.now }
});
const Chat = mongoose.model("Chat", chatSchema);

const savedTripSchema = new mongoose.Schema({
  sessionId: String,
  city: String,
  days: Number,
  summary: String,
  itinerary: Object,
  places: Array,
  savedAt: { type: Date, default: Date.now }
});
const SavedTrip = mongoose.model("SavedTrip", savedTripSchema);

// ─── NEW: User Memory Schema ───────────────────────────────
const userMemorySchema = new mongoose.Schema({
  sessionId: { type: String, unique: true },
  preferredCities: [String],
  travelStyle: String,   // "budget" | "mid-range" | "luxury"
  interests: [String], // ["beaches", "forts", "food", ...]
  pastTrips: [String], // cities visited
  lastUpdated: { type: Date, default: Date.now }
});
const UserMemory = mongoose.model("UserMemory", userMemorySchema);

// ─── REST API ──────────────────────────────────────────────
app.get("/api/saved-trips/:sessionId", async (req, res) => {
  try {
    const trips = await SavedTrip.find({ sessionId: req.params.sessionId }).sort({ savedAt: -1 });
    res.json(trips);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/saved-trips", async (req, res) => {
  try {
    const { sessionId, city, days, summary, itinerary, places } = req.body;
    const trip = await SavedTrip.create({ sessionId, city, days, summary, itinerary, places });

    // ── Auto-update user memory when a trip is saved ──
    await updateMemoryFromTrip(sessionId, city, itinerary);

    res.json(trip);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete("/api/saved-trips/:id", async (req, res) => {
  try {
    await SavedTrip.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── NEW: Memory API ───────────────────────────────────────
app.get("/api/memory/:sessionId", async (req, res) => {
  try {
    const memory = await UserMemory.findOne({ sessionId: req.params.sessionId });
    res.json(memory || {});
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete("/api/memory/:sessionId", async (req, res) => {
  try {
    await UserMemory.deleteOne({ sessionId: req.params.sessionId });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Memory Helper ─────────────────────────────────────────
async function updateMemoryFromTrip(sessionId, city, itinerary) {
  try {
    const existing = await UserMemory.findOne({ sessionId }) || { preferredCities: [], pastTrips: [], interests: [] };

    const updatedCities = [...new Set([...(existing.preferredCities || []), city])].slice(-10);
    const updatedPast = [...new Set([...(existing.pastTrips || []), city])].slice(-20);

    // Infer interests from tips/plan text
    const text = JSON.stringify(itinerary).toLowerCase();
    const detected = [];
    if (text.includes("beach") || text.includes("coast")) detected.push("beaches");
    if (text.includes("fort") || text.includes("palace") || text.includes("histor")) detected.push("history");
    if (text.includes("food") || text.includes("restaurant") || text.includes("cuisine")) detected.push("food");
    if (text.includes("trek") || text.includes("hike") || text.includes("mountain")) detected.push("adventure");
    if (text.includes("temple") || text.includes("shrine") || text.includes("spiritual")) detected.push("spiritual");
    if (text.includes("market") || text.includes("shop") || text.includes("bazaar")) detected.push("shopping");

    const updatedInterests = [...new Set([...(existing.interests || []), ...detected])].slice(-10);

    await UserMemory.findOneAndUpdate(
      { sessionId },
      { preferredCities: updatedCities, pastTrips: updatedPast, interests: updatedInterests, lastUpdated: new Date() },
      { upsert: true, new: true }
    );
  } catch (err) {
    console.error("Memory update failed:", err.message);
  }
}

async function getMemory(sessionId) {
  try {
    return await UserMemory.findOne({ sessionId }) || null;
  } catch { return null; }
}

// ─── City Extractor ────────────────────────────────────────
function extractCity(text) {
  const lower = text.toLowerCase();

  const multiWordCities = [
    "north goa", "south goa", "new delhi", "old delhi",
    "kuala lumpur", "hong kong"
  ];
  for (const city of multiWordCities) {
    if (lower.includes(city)) return city;
  }

  const stopWords = new Set([
    "plan", "trip", "for", "a", "an", "the", "my", "to", "in",
    "days", "day", "week", "want", "me", "next", "visit", "going",
    "travelling", "traveling", "i", "please", "can", "you", "help",
    "give", "me", "make", "create", "suggest", "build", "night", "nights"
  ]);

  const words = lower.trim().split(/\s+/);
  const cityWord = words.find(w => !stopWords.has(w) && isNaN(w) && w.length > 1);
  return cityWord || "goa";
}

// ─── Weather Tool ──────────────────────────────────────────
async function getWeather(city) {
  try {
    const apiCity = city.replace(/^(north|south|east|west)\s+/i, "").trim();
    const res = await axios.get("https://api.openweathermap.org/data/2.5/weather", {
      params: { q: `${apiCity},IN`, appid: process.env.WEATHER_API_KEY, units: "metric" }
    });
    return {
      temp: res.data.main.temp,
      description: res.data.weather[0].description,
      humidity: res.data.main.humidity,
      city: res.data.name
    };
  } catch (err) {
    console.error("Weather error:", err.message);
    return { temp: 30, description: "Sunny", humidity: 70, city };
  }
}

// ─── Fallback Places ───────────────────────────────────────
const fallbackPlacesMap = {
  "sangli": ["Sangli Fort", "Ganapati Temple Sangli", "Datta Mandir", "Sangli Market", "Narsinhwadi Temple"],
  "satara": ["Ajinkyatara Fort", "Kaas Plateau", "Sajjangad Fort", "Thoseghar Waterfalls", "Chalkewadi Windmills"],
  "karad": ["Koyna Dam", "Rayreshwar Temple", "Pritisangam Karad", "Shree Rameshwar Temple"],
  "solapur": ["Solapur Fort", "Bhuleshwar Temple", "Siddheshwar Temple", "Hipparga Lake"],
  "kolhapur": ["Mahalakshmi Temple Kolhapur", "Rankala Lake", "New Palace Museum Kolhapur", "Panhala Fort", "Shalini Palace"],
  "amravati": ["Ambadevi Temple", "Chhatri Talav", "Shri Krishna Museum", "Wan Wildlife Sanctuary"],
  "akola": ["Akola Fort", "Narnala Fort", "Rajura Lake", "Shri Swami Samarth Mandir Akola"],
  "latur": ["Udgir Fort", "Ausa Fort", "Kharosa Caves"],
  "osmanabad": ["Naldurg Fort", "Tuljapur Bhavani Temple", "Dharur Fort"],
  "nanded": ["Hazur Sahib Gurudwara", "Nanded Fort", "Kandhar Fort", "Shri Shivaji Maharaj Udyan"],
  "jalgaon": ["Muktainagar Temple", "Jamner Fort", "Yawal Wildlife Sanctuary"],
  "dhule": ["Laling Fort", "Songir Fort", "Dhule Museum"],
  "ahmednagar": ["Ahmednagar Fort", "Salabat Khan's Tomb", "Meherabad Samadhi", "Bhandardara Dam"],
  "ratnagiri": ["Ratnadurg Fort", "Thibaw Palace", "Ganpatipule Beach", "Jaigad Fort"],
  "sindhudurg": ["Sindhudurg Fort", "Tarkarli Beach", "Malvan Marine Sanctuary"],
  "raigad": ["Raigad Fort", "Karnala Bird Sanctuary", "Kashid Beach"],
  "palghar": ["Vasai Fort", "Kelwa Beach", "Dahanu Beach", "Shirgaon Fort"],
  "thane": ["Upvan Lake Thane", "Yeoor Hills", "Kopineshwar Temple", "Tikuji-ni-Wadi"],
  "mumbai": ["Gateway of India", "Marine Drive", "Elephanta Caves", "Chhatrapati Shivaji Maharaj Terminus", "Juhu Beach", "Colaba Causeway", "Bandra-Worli Sea Link"],
  "pune": ["Shaniwarwada Fort", "Aga Khan Palace", "Sinhagad Fort", "Dagdusheth Ganpati Temple", "Osho Ashram"],
  "nagpur": ["Deekshabhoomi", "Futala Lake", "Sitabuldi Fort", "Ambazari Lake", "Dragon Palace Temple"],
  "nashik": ["Trimbakeshwar Temple", "Sula Vineyards", "Pandavleni Caves", "Ramkund", "Dugarwadi Waterfall"],
  "aurangabad": ["Ajanta Caves", "Ellora Caves", "Bibi Ka Maqbara", "Daulatabad Fort", "Aurangabad Caves"],
  "lonavala": ["Bhushi Dam", "Lohagad Fort", "Tiger's Leap", "Karla Caves", "Rajmachi Fort"],
  "mahabaleshwar": ["Venna Lake", "Arthur's Seat", "Elephant's Head Point", "Mapro Garden", "Pratapgad Fort"],
};

function getFallbackPlaces(city) {
  const key = city.toLowerCase().trim();
  if (fallbackPlacesMap[key]) return fallbackPlacesMap[key].map(name => ({ name, lat: 0, lon: 0, rate: 3 }));
  for (const [k, names] of Object.entries(fallbackPlacesMap)) {
    if (key.includes(k) || k.includes(key)) return names.map(name => ({ name, lat: 0, lon: 0, rate: 3 }));
  }
  return [
    { name: `${city} Fort`, lat: 0, lon: 0, rate: 3 },
    { name: `${city} Temple`, lat: 0, lon: 0, rate: 3 },
    { name: `${city} Lake`, lat: 0, lon: 0, rate: 3 },
    { name: `${city} Market`, lat: 0, lon: 0, rate: 3 },
    { name: `${city} Park`, lat: 0, lon: 0, rate: 3 },
  ];
}

// ─── Places Tool ──────────────────────────────────────────
async function getPlaces(city) {
  console.log(`Fetching places for: ${city}`);

  const curated = getFallbackPlaces(city);
  const isGenericFallback = curated.every(p =>
    (p.name.includes("Fort") || p.name.includes("Temple") || p.name.includes("Lake")) && p.name.startsWith(city)
  );

  if (!isGenericFallback) {
    console.log(`Using curated places for ${city}:`, curated.map(p => p.name).join(", "));
    return curated;
  }

  try {
    const apiCity = city.replace(/^(north|south|east|west)\s+/i, "").trim();
    const geo = await axios.get("https://api.openweathermap.org/geo/1.0/direct", {
      params: { q: `${apiCity},IN`, limit: 1, appid: process.env.WEATHER_API_KEY }
    });

    if (!geo.data?.length) return curated;

    const { lat, lon } = geo.data[0];

    const res = await axios.get("https://api.opentripmap.com/0.1/en/places/radius", {
      params: {
        radius: 15000, lon, lat, limit: 50,
        kinds: "historic,cultural,architecture,natural,beaches,amusements,interesting_places",
        rate: 3,
        apikey: process.env.PLACES_API_KEY
      }
    });

    if (!res.data?.features?.length) return curated;

    const blacklist = ["church", "chapel", "cathedral", "basilica", "parish", "mosque", "masjid", "dargah", "cemetery", "graveyard", "burial", "shop", "store", "mall", "hotel", "lodge", "hostel", "resort", "school", "college", "university", "hospital", "atm", "bank", "office", "police"];

    const places = res.data.features
      .filter(p => p.properties.name && p.properties.rate >= 3)
      .map(p => ({ name: p.properties.name, lat: p.geometry.coordinates[1], lon: p.geometry.coordinates[0], rate: p.properties.rate }))
      .filter(p => p.name.length > 3 && !blacklist.some(b => p.name.toLowerCase().includes(b)))
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 6);

    if (places.length >= 2) return places;

    const retry = res.data.features
      .filter(p => p.properties.name && p.properties.rate >= 1)
      .map(p => ({ name: p.properties.name, lat: p.geometry.coordinates[1], lon: p.geometry.coordinates[0], rate: p.properties.rate }))
      .filter(p => p.name.length > 3 && !blacklist.some(b => p.name.toLowerCase().includes(b)))
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 6);

    return retry.length > 0 ? retry : curated;

  } catch (err) {
    console.error("OpenTripMap error:", err.message);
    return curated;
  }
}

// ─── Cost Estimator ────────────────────────────────────────
function estimateCost(city, days) {
  const costs = {
    "mumbai": { hotel: 3500, food: 1200, transport: 800 }, "delhi": { hotel: 3000, food: 1000, transport: 700 },
    "new delhi": { hotel: 3000, food: 1000, transport: 700 }, "bangalore": { hotel: 3200, food: 1100, transport: 700 },
    "bengaluru": { hotel: 3200, food: 1100, transport: 700 }, "hyderabad": { hotel: 2800, food: 900, transport: 600 },
    "chennai": { hotel: 2800, food: 950, transport: 600 }, "kolkata": { hotel: 2500, food: 850, transport: 550 },
    "goa": { hotel: 2500, food: 800, transport: 600 }, "north goa": { hotel: 2500, food: 800, transport: 600 },
    "south goa": { hotel: 3000, food: 900, transport: 650 }, "jaipur": { hotel: 2000, food: 700, transport: 500 },
    "agra": { hotel: 2200, food: 750, transport: 500 }, "varanasi": { hotel: 2000, food: 700, transport: 450 },
    "udaipur": { hotel: 2500, food: 800, transport: 550 }, "jodhpur": { hotel: 2000, food: 700, transport: 500 },
    "amritsar": { hotel: 1800, food: 700, transport: 450 }, "pune": { hotel: 2200, food: 750, transport: 500 },
    "kerala": { hotel: 2800, food: 900, transport: 650 }, "manali": { hotel: 2200, food: 700, transport: 800 },
    "shimla": { hotel: 2000, food: 650, transport: 700 }, "darjeeling": { hotel: 1800, food: 650, transport: 500 },
    "ooty": { hotel: 2000, food: 700, transport: 500 }, "mussoorie": { hotel: 2200, food: 700, transport: 600 },
    "rishikesh": { hotel: 1800, food: 650, transport: 400 }, "haridwar": { hotel: 1600, food: 600, transport: 400 },
    "leh": { hotel: 2500, food: 800, transport: 900 }, "ladakh": { hotel: 2500, food: 800, transport: 900 },
    "nashik": { hotel: 1800, food: 650, transport: 400 }, "aurangabad": { hotel: 1800, food: 650, transport: 450 },
    "mahabaleshwar": { hotel: 2500, food: 750, transport: 550 }, "lonavala": { hotel: 2200, food: 700, transport: 450 },
    "karad": { hotel: 1500, food: 600, transport: 400 }, "kolhapur": { hotel: 1600, food: 650, transport: 400 },
    "satara": { hotel: 1500, food: 600, transport: 380 }, "sangli": { hotel: 1500, food: 600, transport: 380 },
    "solapur": { hotel: 1500, food: 600, transport: 380 }, "nagpur": { hotel: 1800, food: 700, transport: 450 },
    "amravati": { hotel: 1400, food: 550, transport: 350 }, "akola": { hotel: 1400, food: 550, transport: 350 },
    "latur": { hotel: 1400, food: 550, transport: 350 }, "osmanabad": { hotel: 1300, food: 500, transport: 320 },
    "nanded": { hotel: 1500, food: 580, transport: 360 }, "jalgaon": { hotel: 1500, food: 580, transport: 360 },
    "dhule": { hotel: 1400, food: 550, transport: 340 }, "ahmednagar": { hotel: 1500, food: 580, transport: 360 },
    "ratnagiri": { hotel: 1800, food: 650, transport: 450 }, "sindhudurg": { hotel: 2000, food: 700, transport: 500 },
    "raigad": { hotel: 1800, food: 650, transport: 450 }, "palghar": { hotel: 1600, food: 600, transport: 400 },
    "thane": { hotel: 2000, food: 700, transport: 500 },
    "default": { hotel: 1800, food: 650, transport: 450 }
  };

  const key = city.toLowerCase().trim();
  let rate = costs[key];
  if (!rate) {
    for (const [k, v] of Object.entries(costs)) {
      if (k === "default") continue;
      if (key.includes(k) || k.includes(key)) { rate = v; break; }
    }
  }
  rate = rate || costs["default"];

  const perDay = rate.hotel + rate.food + rate.transport;
  return {
    perDay,
    total: perDay * days,
    breakdown: { hotel: rate.hotel * days, food: rate.food * days, transport: rate.transport * days },
    note: `Estimated budget in INR for a mid-range solo traveler (${days} days)`
  };
}

// ─── NEW: Planner Agent — decides what tools to call ───────
async function runPlannerAgent(msg, city, days, memory) {
  const memoryContext = memory
    ? `User memory: They have visited ${(memory.pastTrips || []).join(", ") || "no cities yet"}. 
       Their interests include: ${(memory.interests || []).join(", ") || "general sightseeing"}.
       Travel style: ${memory.travelStyle || "mid-range"}.`
    : "No memory available for this user yet.";

  const response = await axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      model: "openai/gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are the PLANNER AGENT in a multi-agent travel AI system.
Your only job is to analyze the user's request and produce a JSON execution plan.
Output ONLY valid JSON. No prose. No markdown.

${memoryContext}

Available tools: getWeather, getPlaces, estimateCost
Available agents: itinerary_agent (builds day-by-day plan), cost_agent (refines budget)

Output this structure:
{
  "intent": "<what the user wants in one sentence>",
  "city": "${city}",
  "days": ${days},
  "tools_needed": ["getWeather", "getPlaces", "estimateCost"],
  "agent_sequence": ["itinerary_agent", "cost_agent"],
  "personalization": "<one sentence about how to personalize based on memory>",
  "reasoning": "<2-3 sentences explaining your plan>"

Rules for place selection:

-If city is Goa:
- Beaches are MANDATORY
- Include: Baga Beach, Calangute Beach, Anjuna Beach, Vagator Beach
- Include markets and nightlife
- Maximum 1 fort in entire trip
- DO NOT include museums unless user asks

PRIORITY ORDER:
1. Famous attractions
2. Local experiences
}`
        },
        { role: "user", content: msg }
      ],
      response_format: { type: "json_object" },
      max_tokens: 500
    },
    { headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" } }
  );

  try { return JSON.parse(response.data.choices[0].message.content); }
  catch { return { intent: `Plan ${days}-day trip to ${city}`, city, days, tools_needed: ["getWeather", "getPlaces", "estimateCost"], reasoning: "Standard trip planning flow." }; }
}

// ─── NEW: Cost Agent — refines and validates budget ────────
async function runCostAgent(city, days, weather, places, memory) {
  const baseData = estimateCost(city, days);
  const style = memory?.travelStyle || "mid-range";

  // Adjust multiplier by travel style
  const multiplier = style === "budget" ? 0.7 : style === "luxury" ? 1.8 : 1.0;

  return {
    ...baseData,
    perDay: Math.round(baseData.perDay * multiplier),
    total: Math.round(baseData.total * multiplier),
    breakdown: {
      hotel: Math.round(baseData.breakdown.hotel * multiplier),
      food: Math.round(baseData.breakdown.food * multiplier),
      transport: Math.round(baseData.breakdown.transport * multiplier),
    },
    note: `Estimated budget in INR for a ${style} solo traveler (${days} days)`,
    travelStyle: style
  };
}

// ─── Socket ────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.on("get_history", async ({ sessionId }) => {
    const history = await Chat.find({ sessionId }).sort({ timestamp: 1 });
    socket.emit("history", history);
  });

  // ─── NEW: Get memory for a session ──────────────────────
  socket.on("get_memory", async ({ sessionId }) => {
    const memory = await getMemory(sessionId);
    socket.emit("memory", memory);
  });

  socket.on("message", async ({ msg, sessionId }) => {
    // const userMessage = data.message || data;

    // const daysMatch = userMessage.match(/(\d+)\s*day/i);
    // const extractedDaysFromPrompt = daysMatch ? parseInt(daysMatch[1]) : 1;
    console.log("User:", msg);
    await Chat.create({ sessionId, role: "user", content: msg });

    try {
      const city = extractCity(msg);
      const daysMatch = msg.match(/(\d+)\s*(?:day|days|night|nights)/i);
      const days = daysMatch ? parseInt(daysMatch[1]) : 3;
      console.log(`City="${city}" Days=${days}`);

      // Load user memory
      const memory = await getMemory(sessionId);

      const emitStatus = (m) => socket.emit("status", m);

      function streamText(text) {
        const words = (text || "").split(" ");
        return new Promise((resolve) => {
          let i = 0;
          const iv = setInterval(() => {
            if (i < words.length) { socket.emit("reply_chunk", words[i++] + " "); }
            else { clearInterval(iv); resolve(); }
          }, 40);
        });
      }

      // ── STEP 0: Planner Agent decides the execution plan ──
      emitStatus("🧠 Planner Agent is analyzing your request...");
      const plan = await runPlannerAgent(msg, city, days, memory);
      console.log("Planner output:", JSON.stringify(plan));
      socket.emit("agent_plan", plan);  // Send plan to UI for display
      emitStatus(`🗺️ Plan: ${plan.reasoning || "Standard trip planning flow."}`);

      await new Promise(r => setTimeout(r, 500));

      // ── STEP 1: Weather Tool ──
      emitStatus(`🌤️ Checking weather in ${city}...`);
      const weatherData = await getWeather(city);
      socket.emit("tool_result", { tool: "getWeather", result: weatherData });

      // ── STEP 2: Places Tool ──
      emitStatus(`📍 Finding top attractions in ${city}...`);
      const placesData = await getPlaces(city);
      socket.emit("places", placesData);
      socket.emit("tool_result", { tool: "getPlaces", result: placesData });

      // ── STEP 3: Cost Agent refines budget ──
      emitStatus(`💰 Cost Agent calculating ${memory?.travelStyle || "mid-range"} budget...`);
      const costData = await runCostAgent(city, days, weatherData, placesData, memory);
      socket.emit("tool_result", { tool: "estimateCost", result: costData });

      await new Promise(r => setTimeout(r, 300));

      // ── STEP 4: Itinerary Agent builds the final plan ──
      emitStatus(`✍️ Itinerary Agent building your ${days}-day plan...`);

      const placesListStr = placesData.length > 0 ? placesData.map(p => p.name).join(", ") : null;
      const personalizationNote = plan.personalization || "";

      const messages = [
        {
          role: "system",
          content: `
You are the ITINERARY AGENT in a multi-agent travel AI system.
You have already received data from the Planner Agent, Weather Tool, Places Tool, and Cost Agent.
Your job is to generate the FINAL structured travel plan.

CONTEXT:
- Destination: ${city}, India
- Duration: ${days} days
- Weather: ${weatherData.temp}°C, ${weatherData.description}, humidity ${weatherData.humidity}%
- Top attractions: ${placesListStr || `iconic spots in ${city}`}
- Budget style: ${costData.travelStyle || "mid-range"}
- Personalization: ${personalizationNote || "None"}

Output ONLY a valid JSON object (no markdown, no backticks):
{
  "type": "final",
  "city": "${city}",
  "summary": "<2-3 sentences about ${city} — character, best season, traveler type. Mention the ${weatherData.description} weather.>",
  "days": [
    {
      "day": 1,
      "plan": "Morning (9AM): <real attraction> — <what it is, history, what to do, time to spend>. Transport from hotel by <mode> (Rs <cost>, <duration>). Breakfast at <actual local restaurant> — try <specific dish> (Rs <price>). Afternoon (1PM): <second attraction> — <details, activities>. Auto/cab from previous stop (Rs <cost>, <duration>). Lunch at <real restaurant> — <dish> (Rs <price>). Evening (6PM): <evening spot>. Dinner at <restaurant> — <dish> (Rs <price>)."
    }
  ],
  "tips": [
    "<tip 1 specific to ${city}>",
    "<tip 2 specific to ${city}>",
    "<tip 3 specific to ${city}>",
    "<tip 4 specific to ${city}>",
    "<tip 5 specific to ${city}>"
  ],
  "cost": {
    "perDay": ${costData.perDay},
    "total": ${costData.total},
    "breakdown": {
      "hotel": ${costData.breakdown.hotel},
      "food": ${costData.breakdown.food},
      "transport": ${costData.breakdown.transport}
    },
    "note": "${costData.note}"
  },
  "weather": {
    "temp": ${weatherData.temp},
    "description": "${weatherData.description}",
    "humidity": ${weatherData.humidity}
  }
}

STRICT RULES:
1. Output ONLY valid JSON — no markdown, no backticks, no prose.
2. Every place MUST be a real tourist attraction IN ${city}, India.
3. NEVER suggest churches, chapels, mosques, cemeteries. Focus on beaches, forts, monuments, markets, gardens, museums, lakes.
4. Use EXACTLY these cost numbers: perDay=${costData.perDay}, total=${costData.total}.
5. Generate EXACTLY ${days} day objects — no more, no less.
6. Each day plan MUST have Morning/Afternoon/Evening with exact times and at least 120 words.
7. Tips must be specific to ${city} — real restaurant names, real transport costs, real seasonal advice.
8. All places MUST be in ${city} ONLY.
`
        },
        { role: "user", content: `Generate the complete ${days}-day itinerary for ${city}.` }
      ];

      const response = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        { model: "openai/gpt-4o-mini", messages, response_format: { type: "json_object" }, max_tokens: 4000 },
        { headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" } }
      );

      const raw = response.data.choices[0].message.content;
      let parsed;
      try { parsed = JSON.parse(raw); }
      catch {
        socket.emit("reply_chunk", "Could not generate the plan. Please try again.");
        socket.emit("reply_done");
        return;
      }

      // Always override cost with server-computed values
      parsed.cost = costData;
      parsed.city = city;

      if (!parsed.days?.length) {
        parsed.days = Array.from({ length: days }, (_, k) => ({ day: k + 1, plan: `Explore ${city} — Day ${k + 1}` }));
      }

      await streamText(parsed.summary || `Your ${days}-day trip to ${city} is ready!`);
      socket.emit("reply_chunk", "\n\n");
      for (const day of parsed.days) {
        await streamText(`Day ${day.day}: ${day.plan}`);
        socket.emit("reply_chunk", "\n\n");
      }

      socket.emit("itinerary", parsed);
      await Chat.create({ sessionId, role: "assistant", content: JSON.stringify(parsed) });
      socket.emit("reply_done");

    } catch (err) {
      console.error("ERROR:", err.message);
      socket.emit("reply_chunk", "An error occurred. Please try again.");
      socket.emit("reply_done");
    }
  });

  socket.on("disconnect", () => console.log("Disconnected:", socket.id));
});

mongoose.set("bufferCommands", false);

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB connected");

    const PORT = process.env.PORT || 5000;

    server.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error("❌ MongoDB connection failed:", err.message);
  });