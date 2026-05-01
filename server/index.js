import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import mongoose from "mongoose";

dotenv.config();

const configuredOpenRouterModel = process.env.OPENROUTER_MODEL || "";
const OPENROUTER_MODEL = configuredOpenRouterModel.startsWith("sk-")
  ? "openrouter/free"
  : (configuredOpenRouterModel || "openrouter/free");

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://ai-travel-agent-three.vercel.app"
];

const configuredOrigins = [
  process.env.CLIENT_URL,
  process.env.FRONTEND_URL,
  process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "",
  ...(process.env.CLIENT_URLS || "").split(",")
]
  .filter(Boolean)
  .map((origin) => origin.trim())
  .filter(Boolean);

const ALLOWED_ORIGINS = [...new Set([...DEFAULT_ALLOWED_ORIGINS, ...configuredOrigins])];

async function createJsonResponse({ instructions, input, maxOutputTokens }) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is missing. Add your OpenRouter API key to server/.env.");
  }

  const response = await axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      model: OPENROUTER_MODEL,
      messages: [
        {
          role: "user",
          content: `${instructions}\n\nUser request:\n${input}\n\nReturn valid JSON only. Do not use markdown or backticks.`
        }
      ],
      max_tokens: maxOutputTokens
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:5173",
        "X-Title": "AI Travel Agent"
      }
    }
  );

  return response.data.choices?.[0]?.message?.content || "";
}

function parseJsonResponse(raw) {
  if (!raw) throw new Error("Empty model response");

  try {
    return JSON.parse(raw);
  } catch {
    const cleaned = raw
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/i, "")
      .trim();

    try {
      return JSON.parse(cleaned);
    } catch {
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      if (start === -1 || end === -1 || end <= start) {
        throw new Error("Model did not return JSON");
      }
      return JSON.parse(cleaned.slice(start, end + 1));
    }
  }
}

const app = express();
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "AI Travel Agent backend",
    health: "/health",
    socket: "/socket.io"
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGINS, methods: ["GET", "POST"] }
});

const chatSchema = new mongoose.Schema({
  sessionId: String,
  clientId: String,
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

const userMemorySchema = new mongoose.Schema({
  sessionId: { type: String, unique: true },
  preferredCities: [String],
  travelStyle: String,
  interests: [String],
  pastTrips: [String],
  lastUpdated: { type: Date, default: Date.now }
});
const UserMemory = mongoose.model("UserMemory", userMemorySchema);

function getMessagePreview(message) {
  const content = message.content || "";
  if (message.role !== "assistant") return content;

  try {
    const parsed = JSON.parse(content);
    if (parsed?.summary) return `Plan ready: ${parsed.summary}`;
  } catch {
    if (content.includes("dayExpense") || content.includes("\"days\"")) {
      return "Plan ready. Open the trip plan to continue.";
    }
  }

  return content;
}

function buildConversationSummary(messages) {
  const grouped = new Map();

  for (const message of messages) {
    const sessionId = message.sessionId;
    if (!sessionId) continue;

    if (!grouped.has(sessionId)) {
      grouped.set(sessionId, {
        sessionId,
        title: "New chat",
        preview: "",
        createdAt: message.timestamp,
        updatedAt: message.timestamp,
        messageCount: 0
      });
    }

    const item = grouped.get(sessionId);
    item.messageCount += 1;
    item.updatedAt = message.timestamp;
    item.preview = getMessagePreview(message);

    if (item.title === "New chat" && message.role === "user" && message.content) {
      item.title = message.content.trim().slice(0, 52);
    }
  }

  return [...grouped.values()].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

async function attachClientToSession(sessionId, clientId) {
  if (!sessionId || !clientId) return;

  await Chat.updateMany(
    {
      sessionId,
      $or: [
        { clientId: { $exists: false } },
        { clientId: null },
        { clientId: "" }
      ]
    },
    { $set: { clientId } }
  );
}

app.get("/api/conversations/:clientId", async (req, res) => {
  try {
    const { clientId } = req.params;
    const { currentSessionId } = req.query;

    if (currentSessionId) {
      await attachClientToSession(currentSessionId, clientId);
    }

    const filters = [{ clientId }];
    if (currentSessionId) filters.push({ sessionId: currentSessionId });

    const messages = await Chat.find({ $or: filters })
      .sort({ timestamp: 1 })
      .limit(1500)
      .lean();

    res.json(buildConversationSummary(messages));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/saved-trips/:sessionId", async (req, res) => {
  try {
    const trips = await SavedTrip.find({ sessionId: req.params.sessionId }).sort({ savedAt: -1 });
    res.json(trips);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/saved-trips", async (req, res) => {
  try {
    const { sessionId, city, days, summary, itinerary, places } = req.body;
    const trip = await SavedTrip.create({ sessionId, city, days, summary, itinerary, places });
    await updateMemoryFromTrip(sessionId, city, itinerary);
    res.json(trip);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/saved-trips/:id", async (req, res) => {
  try {
    await SavedTrip.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/memory/:sessionId", async (req, res) => {
  try {
    const memory = await UserMemory.findOne({ sessionId: req.params.sessionId });
    res.json(memory || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/memory/:sessionId", async (req, res) => {
  try {
    await UserMemory.deleteOne({ sessionId: req.params.sessionId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function updateMemoryFromTrip(sessionId, city, itinerary) {
  try {
    const existing = await UserMemory.findOne({ sessionId }) || {
      preferredCities: [],
      pastTrips: [],
      interests: []
    };

    const updatedCities = [...new Set([...(existing.preferredCities || []), city])].slice(-10);
    const updatedPast = [...new Set([...(existing.pastTrips || []), city])].slice(-20);
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
      {
        preferredCities: updatedCities,
        pastTrips: updatedPast,
        interests: updatedInterests,
        lastUpdated: new Date()
      },
      { upsert: true, new: true }
    );
  } catch (err) {
    console.error("Memory update failed:", err.message);
  }
}

async function getMemory(sessionId) {
  try {
    return await UserMemory.findOne({ sessionId }) || null;
  } catch {
    return null;
  }
}

function summarizeChatMessage(message) {
  if (message.role === "assistant") {
    try {
      const parsed = JSON.parse(message.content);
      if (parsed.summary) return `assistant: ${parsed.summary}`;
    } catch {
      // Keep plain assistant messages as-is.
    }
  }

  return `${message.role}: ${(message.content || "").slice(0, 320)}`;
}

async function getConversationContext(sessionId) {
  try {
    const history = await Chat.find({ sessionId }).sort({ timestamp: -1 }).limit(8).lean();
    const chronological = history.reverse();
    let city = null;
    let days = null;

    for (const message of chronological) {
      if (message.role !== "assistant") continue;

      try {
        const parsed = JSON.parse(message.content);
        if (parsed.city) city = parsed.city;
        if (parsed.requestedDays) days = parsed.requestedDays;
        if (parsed.days?.length) days = parsed.days.length;
      } catch {
        // Ignore non-JSON assistant messages.
      }
    }

    return {
      city,
      days,
      text: chronological.map(summarizeChatMessage).join("\n")
    };
  } catch {
    return { city: null, days: null, text: "" };
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const KNOWN_CITIES = [
  "north goa", "south goa", "new delhi", "old delhi",
  "mumbai", "pune", "goa", "delhi", "jaipur", "agra", "manali", "shimla",
  "kolhapur", "satara", "sangli", "karad", "solapur", "nagpur", "nashik",
  "aurangabad", "lonavala", "mahabaleshwar", "bangalore", "bengaluru",
  "hyderabad", "chennai", "kolkata", "varanasi", "udaipur", "jodhpur",
  "amritsar", "ooty", "rishikesh", "haridwar", "leh", "ladakh", "thane",
  "ratnagiri"
];

function extractCity(text, fallbackCity = "goa") {
  const lower = text.toLowerCase();

  for (const city of KNOWN_CITIES) {
    if (new RegExp(`\\b${escapeRegExp(city)}\\b`).test(lower)) return city;
  }

  const stopWords = new Set([
    "plan", "plam", "trip", "for", "a", "an", "the", "my", "to", "in",
    "days", "day", "week", "want", "me", "next", "visit", "going",
    "travelling", "traveling", "i", "please", "can", "you", "help",
    "give", "make", "create", "suggest", "build", "night", "nights",
    "add", "more", "extra", "same", "continue", "resume", "extend",
    "modify", "change", "that", "it", "this", "with", "from", "into",
    "old", "chat"
  ]);

  const words = lower.trim().split(/\s+/);
  const cityWord = words.find((word) =>
    !stopWords.has(word) && !/^\d+(-\w+)?$/.test(word) && word.length > 1
  );
  return cityWord || fallbackCity;
}

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
    return { temp: 30, description: "sunny", humidity: 70, city };
  }
}

const fallbackPlacesMap = {
  mumbai: ["Gateway of India", "Marine Drive", "Elephanta Caves", "Chhatrapati Shivaji Maharaj Terminus", "Juhu Beach", "Colaba Causeway", "Bandra-Worli Sea Link"],
  pune: ["Shaniwarwada Fort", "Aga Khan Palace", "Sinhagad Fort", "Dagdusheth Ganpati Temple", "Osho Ashram"],
  goa: ["Baga Beach", "Calangute Beach", "Anjuna Beach", "Vagator Beach", "Fort Aguada", "Mapusa Market", "Dona Paula"],
  "north goa": ["Baga Beach", "Calangute Beach", "Anjuna Beach", "Vagator Beach", "Fort Aguada", "Mapusa Market"],
  "south goa": ["Palolem Beach", "Colva Beach", "Agonda Beach", "Cabo de Rama Fort", "Margao Market"],
  delhi: ["Red Fort", "India Gate", "Qutub Minar", "Humayun's Tomb", "Lotus Temple", "Chandni Chowk"],
  "new delhi": ["India Gate", "Qutub Minar", "Humayun's Tomb", "Lotus Temple", "Akshardham Temple"],
  jaipur: ["Amber Fort", "Hawa Mahal", "City Palace Jaipur", "Jantar Mantar", "Johri Bazaar"],
  agra: ["Taj Mahal", "Agra Fort", "Mehtab Bagh", "Itmad-ud-Daulah", "Kinari Bazaar"],
  manali: ["Hadimba Temple", "Solang Valley", "Old Manali", "Manu Temple", "Mall Road Manali"],
  karad: ["Koyna Dam", "Rayreshwar Temple", "Pritisangam Karad", "Shree Rameshwar Temple"],
  satara: ["Ajinkyatara Fort", "Kaas Plateau", "Sajjangad Fort", "Thoseghar Waterfalls", "Chalkewadi Windmills"],
  sangli: ["Sangli Fort", "Ganapati Temple Sangli", "Datta Mandir", "Sangli Market", "Narsinhwadi Temple"],
  solapur: ["Solapur Fort", "Bhuleshwar Temple", "Siddheshwar Temple", "Hipparga Lake"],
  kolhapur: ["Mahalakshmi Temple Kolhapur", "Rankala Lake", "New Palace Museum Kolhapur", "Panhala Fort"],
  nagpur: ["Deekshabhoomi", "Futala Lake", "Sitabuldi Fort", "Ambazari Lake", "Dragon Palace Temple"],
  nashik: ["Trimbakeshwar Temple", "Sula Vineyards", "Pandavleni Caves", "Ramkund", "Dugarwadi Waterfall"],
  aurangabad: ["Ajanta Caves", "Ellora Caves", "Bibi Ka Maqbara", "Daulatabad Fort", "Aurangabad Caves"],
  lonavala: ["Bhushi Dam", "Lohagad Fort", "Tiger's Leap", "Karla Caves", "Rajmachi Fort"],
  mahabaleshwar: ["Venna Lake", "Arthur's Seat", "Elephant's Head Point", "Mapro Garden", "Pratapgad Fort"]
};

function getFallbackPlaces(city) {
  const key = city.toLowerCase().trim();
  if (fallbackPlacesMap[key]) {
    return fallbackPlacesMap[key].map((name) => ({ name, lat: 0, lon: 0, rate: 3 }));
  }

  for (const [placeKey, names] of Object.entries(fallbackPlacesMap)) {
    if (key.includes(placeKey) || placeKey.includes(key)) {
      return names.map((name) => ({ name, lat: 0, lon: 0, rate: 3 }));
    }
  }

  return ["Fort", "Temple", "Lake", "Market", "Park"].map((kind) => ({
    name: `${city} ${kind}`,
    lat: 0,
    lon: 0,
    rate: 3
  }));
}

async function getPlaces(city) {
  console.log(`Fetching places for: ${city}`);
  const curated = getFallbackPlaces(city);
  const isGenericFallback = curated.every((place) => place.name.startsWith(city));
  if (!isGenericFallback) return curated;

  try {
    const apiCity = city.replace(/^(north|south|east|west)\s+/i, "").trim();
    const geo = await axios.get("https://api.openweathermap.org/geo/1.0/direct", {
      params: { q: `${apiCity},IN`, limit: 1, appid: process.env.WEATHER_API_KEY }
    });

    if (!geo.data?.length) return curated;
    const { lat, lon } = geo.data[0];

    const res = await axios.get("https://api.opentripmap.com/0.1/en/places/radius", {
      params: {
        radius: 15000,
        lon,
        lat,
        limit: 50,
        kinds: "historic,cultural,architecture,natural,beaches,amusements,interesting_places",
        rate: 3,
        apikey: process.env.PLACES_API_KEY
      }
    });

    if (!res.data?.features?.length) return curated;

    const blacklist = ["church", "chapel", "cathedral", "basilica", "parish", "mosque", "masjid", "dargah", "cemetery", "graveyard", "burial", "shop", "store", "mall", "hotel", "lodge", "hostel", "resort", "school", "college", "university", "hospital", "atm", "bank", "office", "police"];
    const places = res.data.features
      .filter((place) => place.properties.name && place.properties.rate >= 1)
      .map((place) => ({
        name: place.properties.name,
        lat: place.geometry.coordinates[1],
        lon: place.geometry.coordinates[0],
        rate: place.properties.rate
      }))
      .filter((place) => place.name.length > 3 && !blacklist.some((word) => place.name.toLowerCase().includes(word)))
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 6);

    return places.length > 0 ? places : curated;
  } catch (err) {
    console.error("OpenTripMap error:", err.message);
    return curated;
  }
}

function estimateCost(city, days) {
  const costs = {
    mumbai: { hotel: 3500, food: 1200, transport: 800 },
    thane: { hotel: 2600, food: 900, transport: 350 },
    delhi: { hotel: 3000, food: 1000, transport: 700 },
    "new delhi": { hotel: 3000, food: 1000, transport: 700 },
    "old delhi": { hotel: 2600, food: 850, transport: 300 },
    bangalore: { hotel: 3200, food: 1100, transport: 700 },
    bengaluru: { hotel: 3200, food: 1100, transport: 700 },
    hyderabad: { hotel: 2800, food: 900, transport: 600 },
    chennai: { hotel: 2800, food: 950, transport: 600 },
    kolkata: { hotel: 2500, food: 850, transport: 550 },
    goa: { hotel: 2500, food: 800, transport: 600 },
    "north goa": { hotel: 2500, food: 800, transport: 600 },
    "south goa": { hotel: 3000, food: 900, transport: 650 },
    jaipur: { hotel: 2000, food: 700, transport: 500 },
    agra: { hotel: 2200, food: 750, transport: 500 },
    pune: { hotel: 2200, food: 750, transport: 500 },
    manali: { hotel: 2200, food: 700, transport: 800 },
    shimla: { hotel: 2400, food: 750, transport: 600 },
    karad: { hotel: 1500, food: 600, transport: 150 },
    kolhapur: { hotel: 1600, food: 650, transport: 400 },
    satara: { hotel: 1500, food: 600, transport: 180 },
    sangli: { hotel: 1500, food: 600, transport: 180 },
    solapur: { hotel: 1500, food: 600, transport: 200 },
    nagpur: { hotel: 1800, food: 700, transport: 450 },
    nashik: { hotel: 1800, food: 650, transport: 400 },
    aurangabad: { hotel: 1800, food: 650, transport: 450 },
    mahabaleshwar: { hotel: 2500, food: 750, transport: 550 },
    lonavala: { hotel: 2200, food: 700, transport: 450 },
    varanasi: { hotel: 2200, food: 650, transport: 350 },
    udaipur: { hotel: 2600, food: 750, transport: 400 },
    jodhpur: { hotel: 2300, food: 700, transport: 380 },
    amritsar: { hotel: 2200, food: 650, transport: 350 },
    ooty: { hotel: 2600, food: 750, transport: 500 },
    rishikesh: { hotel: 2100, food: 650, transport: 350 },
    haridwar: { hotel: 1900, food: 600, transport: 300 },
    leh: { hotel: 3200, food: 900, transport: 950 },
    ladakh: { hotel: 3200, food: 900, transport: 950 },
    ratnagiri: { hotel: 1700, food: 600, transport: 250 },
    default: { hotel: 1800, food: 650, transport: 450 }
  };

  const key = city.toLowerCase().trim();
  let rate = costs[key];
  if (!rate) {
    for (const [costKey, value] of Object.entries(costs)) {
      if (costKey !== "default" && (key.includes(costKey) || costKey.includes(key))) {
        rate = value;
        break;
      }
    }
  }

  rate = rate || costs.default;
  const transportPerDay = getDailyTransportEstimate(city, days);
  const perDay = rate.hotel + rate.food + transportPerDay;
  return {
    perDay,
    total: perDay * days,
    transportPerDay,
    requestedDays: days,
    breakdown: {
      hotel: rate.hotel * days,
      food: rate.food * days,
      transport: transportPerDay * days
    },
    note: `Estimated budget in INR for a mid-range solo traveler (${days} days). Local transport uses city-specific fare profiles.`
  };
}

async function runPlannerAgent(msg, city, days, memory, conversation) {
  const memoryContext = memory
    ? `User memory: visited ${(memory.pastTrips || []).join(", ") || "no cities yet"}; interests ${(memory.interests || []).join(", ") || "general sightseeing"}; style ${memory.travelStyle || "mid-range"}.`
    : "No memory available for this user yet.";
  const conversationContext = conversation?.text
    ? `Conversation so far:\n${conversation.text}`
    : "No earlier messages in this chat.";

  try {
    const raw = await createJsonResponse({
      maxOutputTokens: 600,
      input: `Analyze this user request as JSON: ${msg}`,
      instructions: `You are the PLANNER AGENT. Output ONLY valid JSON.
${memoryContext}
${conversationContext}
Return exactly this JSON shape:
{"intent":"...","city":"${city}","days":${days},"tools_needed":["getWeather","getPlaces","estimateCost"],"agent_sequence":["itinerary_agent","cost_agent"],"personalization":"...","reasoning":"..."}`
    });

    return parseJsonResponse(raw);
  } catch (err) {
    console.warn("Planner Agent fallback:", err.response?.data || err.message);
    return {
      intent: `Plan ${days}-day trip to ${city}`,
      city,
      days,
      tools_needed: ["getWeather", "getPlaces", "estimateCost"],
      agent_sequence: ["itinerary_agent", "cost_agent"],
      personalization: "Using local fallback planning.",
      reasoning: "Local fallback planning flow because the AI planner was unavailable."
    };
  }
}

async function runCostAgent(city, days, weather, places, memory) {
  const baseData = estimateCost(city, days);
  const style = memory?.travelStyle || "mid-range";
  const multiplier = style === "budget" ? 0.7 : style === "luxury" ? 1.8 : 1.0;

  return {
    ...baseData,
    perDay: Math.round(baseData.perDay * multiplier),
    total: Math.round(baseData.total * multiplier),
    transportPerDay: Math.round(baseData.transportPerDay * multiplier),
    breakdown: {
      hotel: Math.round(baseData.breakdown.hotel * multiplier),
      food: Math.round(baseData.breakdown.food * multiplier),
      transport: Math.round(baseData.breakdown.transport * multiplier)
    },
    note: `Estimated budget in INR for a ${style} solo traveler (${days} days)`,
    travelStyle: style
  };
}

const FOOD_BY_CITY = {
  mumbai: [
    { place: "Kyani & Co.", dish: "Irani cafe snacks, akuri, and chai", cost: 250 },
    { place: "Cannon Pav Bhaji near CST", dish: "pav bhaji", cost: 180 },
    { place: "Bademiya Colaba", dish: "kebab roll or chicken tikka", cost: 450 },
    { place: "Cafe Mondegar Colaba", dish: "sandwiches and cold coffee", cost: 500 },
    { place: "Elco Pani Puri Centre Bandra", dish: "chaat and pani puri", cost: 250 },
    { place: "Prithvi Cafe Juhu", dish: "paratha, pasta, and coffee", cost: 500 }
  ],
  goa: [
    { place: "Infantaria Calangute", dish: "Goan snacks and poi", cost: 350 },
    { place: "Vinayak Family Restaurant", dish: "fish thali", cost: 450 },
    { place: "Britto's Baga", dish: "seafood dinner", cost: 700 },
    { place: "Cafe Bodega Panjim", dish: "sandwiches and coffee", cost: 500 },
    { place: "Martin's Corner Betalbatim", dish: "Goan curry and rice", cost: 650 }
  ],
  pune: [
    { place: "Vaishali FC Road", dish: "South Indian meal and filter coffee", cost: 250 },
    { place: "Sujata Mastani", dish: "mango mastani", cost: 180 },
    { place: "Shabree", dish: "Maharashtrian thali", cost: 450 },
    { place: "Goodluck Cafe", dish: "bun maska, keema, and chai", cost: 300 },
    { place: "German Bakery Koregaon Park", dish: "snacks and coffee", cost: 450 }
  ],
  default: [
    { place: "a popular local lunch restaurant", dish: "local thali", cost: 400 },
    { place: "a safe dinner spot near your stay", dish: "regional dinner", cost: 500 },
    { place: "a busy market-side snack shop", dish: "local snacks or chaat", cost: 250 },
    { place: "a family restaurant near your stay", dish: "veg/non-veg thali", cost: 450 }
  ]
};

const STAY_BY_CITY = {
  mumbai: [
    {
      area: "Colaba/Fort",
      hotel: "a mid-range hotel near CST, Fort, or Colaba",
      nightly: 3500,
      bestFor: "Gateway of India, CST, Marine Drive, Colaba, and ferry starts"
    },
    {
      area: "Bandra/Khar",
      hotel: "a mid-range hotel near Bandra or Khar station",
      nightly: 3500,
      bestFor: "Bandra, Juhu, cafes, nightlife, and shorter airport-side travel"
    }
  ],
  goa: [
    {
      area: "Calangute/Baga",
      hotel: "a mid-range beach-side hotel near Calangute or Baga",
      nightly: 2500,
      bestFor: "North Goa beaches, Fort Aguada, markets, and nightlife"
    },
    {
      area: "Panjim/Miramar",
      hotel: "a mid-range hotel near Panjim or Miramar",
      nightly: 2800,
      bestFor: "Old Goa, Fontainhas, casinos, and easy city transfers"
    }
  ],
  "north goa": [
    {
      area: "Calangute/Baga",
      hotel: "a mid-range beach-side hotel near Calangute or Baga",
      nightly: 2500,
      bestFor: "North Goa beaches, Fort Aguada, markets, and nightlife"
    },
    {
      area: "Anjuna/Vagator",
      hotel: "a mid-range stay near Anjuna or Vagator",
      nightly: 2700,
      bestFor: "Anjuna, Vagator, Chapora, sunset points, and cafes"
    }
  ],
  "south goa": [
    {
      area: "Colva/Benaulim",
      hotel: "a mid-range hotel near Colva or Benaulim",
      nightly: 3000,
      bestFor: "Colva, Benaulim, Margao, and relaxed beach time"
    },
    {
      area: "Palolem/Agonda",
      hotel: "a mid-range stay near Palolem or Agonda",
      nightly: 3200,
      bestFor: "quiet beaches, kayaking, and slow evenings"
    }
  ],
  pune: [
    {
      area: "Shivajinagar/FC Road",
      hotel: "a mid-range hotel near Shivajinagar or FC Road",
      nightly: 2200,
      bestFor: "central sightseeing, food streets, and station access"
    },
    {
      area: "Koregaon Park/Kalyani Nagar",
      hotel: "a mid-range stay near Koregaon Park",
      nightly: 2600,
      bestFor: "cafes, nightlife, Aga Khan Palace, and airport-side travel"
    }
  ],
  default: [
    {
      area: "central city area",
      hotel: "a mid-range hotel near the main market or railway station",
      nightly: 1800,
      bestFor: "short transfers, food options, and easy sightseeing starts"
    }
  ]
};

function getStayOptions(city) {
  const key = city.toLowerCase().trim();
  if (STAY_BY_CITY[key]) return STAY_BY_CITY[key];

  for (const [stayKey, options] of Object.entries(STAY_BY_CITY)) {
    if (stayKey !== "default" && (key.includes(stayKey) || stayKey.includes(key))) {
      return options;
    }
  }

  return STAY_BY_CITY.default;
}

function getHotelPerNight(costData, totalDays, fallbackNightly) {
  const nights = Math.max(Number(totalDays) || 1, 1);
  const totalHotel = Number(costData?.breakdown?.hotel) || 0;
  return totalHotel > 0 ? Math.round(totalHotel / nights) : fallbackNightly;
}

const TRANSPORT_FARE_BY_CITY = {
  mumbai: { firstAuto: 130, secondAuto: 110, local: 30, firstStep: 25, secondStep: 20, localStep: 10 },
  thane: { firstAuto: 120, secondAuto: 100, local: 30, firstStep: 20, secondStep: 20, localStep: 10 },
  pune: { firstAuto: 120, secondAuto: 100, local: 30, firstStep: 20, secondStep: 20, localStep: 10 },
  delhi: { firstAuto: 110, secondAuto: 95, local: 30, firstStep: 20, secondStep: 15, localStep: 10 },
  "new delhi": { firstAuto: 110, secondAuto: 95, local: 30, firstStep: 20, secondStep: 15, localStep: 10 },
  "old delhi": { firstAuto: 90, secondAuto: 80, local: 25, firstStep: 15, secondStep: 15, localStep: 5 },
  bangalore: { firstAuto: 160, secondAuto: 140, local: 40, firstStep: 30, secondStep: 25, localStep: 10 },
  bengaluru: { firstAuto: 160, secondAuto: 140, local: 40, firstStep: 30, secondStep: 25, localStep: 10 },
  hyderabad: { firstAuto: 130, secondAuto: 110, local: 35, firstStep: 25, secondStep: 20, localStep: 10 },
  chennai: { firstAuto: 130, secondAuto: 110, local: 30, firstStep: 25, secondStep: 20, localStep: 10 },
  kolkata: { firstAuto: 100, secondAuto: 90, local: 25, firstStep: 20, secondStep: 15, localStep: 5 },
  goa: { firstAuto: 300, secondAuto: 250, local: 80, firstStep: 45, secondStep: 40, localStep: 15 },
  "north goa": { firstAuto: 300, secondAuto: 250, local: 80, firstStep: 45, secondStep: 40, localStep: 15 },
  "south goa": { firstAuto: 320, secondAuto: 280, local: 90, firstStep: 50, secondStep: 45, localStep: 15 },
  jaipur: { firstAuto: 110, secondAuto: 95, local: 30, firstStep: 20, secondStep: 15, localStep: 10 },
  agra: { firstAuto: 95, secondAuto: 85, local: 25, firstStep: 15, secondStep: 15, localStep: 5 },
  varanasi: { firstAuto: 95, secondAuto: 85, local: 25, firstStep: 15, secondStep: 15, localStep: 5 },
  udaipur: { firstAuto: 115, secondAuto: 100, local: 30, firstStep: 20, secondStep: 15, localStep: 10 },
  jodhpur: { firstAuto: 110, secondAuto: 95, local: 30, firstStep: 20, secondStep: 15, localStep: 10 },
  amritsar: { firstAuto: 95, secondAuto: 85, local: 25, firstStep: 15, secondStep: 15, localStep: 5 },
  rishikesh: { firstAuto: 100, secondAuto: 90, local: 30, firstStep: 20, secondStep: 15, localStep: 10 },
  haridwar: { firstAuto: 90, secondAuto: 80, local: 25, firstStep: 15, secondStep: 15, localStep: 5 },
  manali: { firstAuto: 240, secondAuto: 210, local: 60, firstStep: 35, secondStep: 30, localStep: 15 },
  shimla: { firstAuto: 230, secondAuto: 200, local: 50, firstStep: 35, secondStep: 30, localStep: 15 },
  ooty: { firstAuto: 180, secondAuto: 160, local: 45, firstStep: 30, secondStep: 25, localStep: 10 },
  leh: { firstAuto: 450, secondAuto: 400, local: 100, firstStep: 60, secondStep: 50, localStep: 20 },
  ladakh: { firstAuto: 450, secondAuto: 400, local: 100, firstStep: 60, secondStep: 50, localStep: 20 },
  sangli: { firstAuto: 70, secondAuto: 60, local: 20, firstStep: 15, secondStep: 15, localStep: 5 },
  karad: { firstAuto: 60, secondAuto: 50, local: 20, firstStep: 10, secondStep: 10, localStep: 5 },
  satara: { firstAuto: 80, secondAuto: 70, local: 25, firstStep: 15, secondStep: 15, localStep: 5 },
  kolhapur: { firstAuto: 90, secondAuto: 80, local: 25, firstStep: 20, secondStep: 15, localStep: 5 },
  solapur: { firstAuto: 90, secondAuto: 80, local: 25, firstStep: 20, secondStep: 15, localStep: 5 },
  nagpur: { firstAuto: 110, secondAuto: 95, local: 30, firstStep: 20, secondStep: 15, localStep: 10 },
  nashik: { firstAuto: 100, secondAuto: 90, local: 25, firstStep: 20, secondStep: 15, localStep: 5 },
  aurangabad: { firstAuto: 100, secondAuto: 90, local: 25, firstStep: 20, secondStep: 15, localStep: 5 },
  lonavala: { firstAuto: 180, secondAuto: 160, local: 45, firstStep: 30, secondStep: 25, localStep: 10 },
  mahabaleshwar: { firstAuto: 220, secondAuto: 190, local: 50, firstStep: 35, secondStep: 30, localStep: 10 },
  ratnagiri: { firstAuto: 85, secondAuto: 75, local: 25, firstStep: 15, secondStep: 15, localStep: 5 },
  default: { firstAuto: 100, secondAuto: 90, local: 30, firstStep: 20, secondStep: 15, localStep: 10 }
};

function getTransportFares(city, index) {
  const key = city.toLowerCase().trim();
  let fare = TRANSPORT_FARE_BY_CITY[key];

  if (!fare) {
    for (const [fareKey, value] of Object.entries(TRANSPORT_FARE_BY_CITY)) {
      if (fareKey !== "default" && (key.includes(fareKey) || fareKey.includes(key))) {
        fare = value;
        break;
      }
    }
  }

  fare = fare || TRANSPORT_FARE_BY_CITY.default;
  const firstAuto = fare.firstAuto + (index * fare.firstStep);
  const secondAuto = fare.secondAuto + (index * fare.secondStep);
  const busLocal = fare.local + (index * fare.localStep);

  return {
    firstAuto,
    secondAuto,
    busLocal,
    taxiAutoTotal: firstAuto + secondAuto,
    total: firstAuto + secondAuto + busLocal
  };
}

function getDailyTransportEstimate(city, days = 3) {
  const sampleDays = Math.max(1, Math.min(Number(days) || 1, 3));
  const total = Array.from({ length: sampleDays }, (_, index) => getTransportFares(city, index).total)
    .reduce((sum, value) => sum + value, 0);
  return Math.round(total / sampleDays);
}

function getStayForDay(city, index, totalDays) {
  const options = getStayOptions(city);
  const shouldSplitStay = totalDays >= 3 && options.length > 1;
  const stayIndex = shouldSplitStay ? Math.min(Math.floor(index / 2), options.length - 1) : 0;
  const previousStayIndex = shouldSplitStay ? Math.min(Math.floor(Math.max(index - 1, 0) / 2), options.length - 1) : 0;

  return {
    stay: options[stayIndex],
    changedFromPreviousDay: index > 0 && stayIndex !== previousStayIndex,
    usesSplitStay: shouldSplitStay
  };
}

function buildStayPlan(city, totalDays) {
  const options = getStayOptions(city);
  const first = options[0];
  const second = options[1];

  if (totalDays >= 3 && second) {
    return {
      title: "Recommended stay plan",
      description: `Use ${first.area} as the base for Day 1 and Day 2 because it is best for ${first.bestFor}. For Day 3 onward, optionally shift to ${second.area} if the plan moves toward ${second.bestFor}. This avoids unnecessary daily hotel changes while still reducing long taxi rides.`
    };
  }

  return {
    title: "Recommended stay plan",
    description: `Keep one base stay around ${first.area}. For a short ${city} trip this is more practical than changing hotels every day, because you can leave luggage safely and take taxis, local trains, metro, or ferries from that base.`
  };
}

function normalizePlanText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(normalizePlanText).filter(Boolean).join(" ");
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([key, item]) => `${key}: ${normalizePlanText(item)}`)
      .join(" ");
  }
  return String(value);
}

function getFallbackStopName(city, dayIndex, stopIndex) {
  const labels = [
    "main market area",
    "riverside or lakefront area",
    "old city heritage lane",
    "local food street",
    "museum or cultural centre",
    "garden or sunset point",
    "shopping street",
    "nearby temple area",
    "city viewpoint"
  ];
  return `${city} ${labels[(dayIndex * 3 + stopIndex) % labels.length]}`;
}

function getDayStops(city, places, dayIndex) {
  const safePlaces = Array.isArray(places) ? places.filter((place) => place?.name) : [];
  const start = dayIndex * 3;

  return [0, 1, 2].map((offset) => {
    const place = safePlaces[start + offset];
    return place?.name || getFallbackStopName(city, dayIndex, offset);
  });
}

function enrichDayPlan(day, index, city, places, totalDays) {
  const cityKey = city.toLowerCase();
  const food = FOOD_BY_CITY[cityKey] || FOOD_BY_CITY.default;
  const [first, second, third] = getDayStops(city, places, index);
  const lunch = food[index % food.length];
  const dinner = food[(index + 1) % food.length] || food[0];
  const { stay } = getStayForDay(city, index, totalDays);
  const fares = getTransportFares(city, index);

  const detailed = `Travel by auto/taxi to ${first} (fare about Rs ${fares.firstAuto}), then continue to ${second} by bus/auto/local transport (fare about Rs ${fares.busLocal}-Rs ${fares.secondAuto}). Have lunch at ${lunch.place}; try ${lunch.dish}. In the evening visit ${third}, then return by auto/bus as convenient and have dinner at ${dinner.place}; try ${dinner.dish}. Local travel fare only: auto/taxi about Rs ${fares.taxiAutoTotal}, bus/local transport about Rs ${fares.busLocal}, total around Rs ${fares.total}.`;

  return {
    ...((typeof day === "object" && !Array.isArray(day)) ? day : {}),
    day: day?.day || index + 1,
    stay: {
      area: stay.area,
      hotel: stay.hotel
    },
    dayExpense: {
      taxiAuto: fares.taxiAutoTotal,
      busLocal: fares.busLocal,
      transport: fares.total
    },
    plan: detailed
  };
}

function normalizeItinerary(parsed, city, days, placesData, costData) {
  const modelDays = Array.isArray(parsed.days) ? parsed.days : [];
  const stayPlan = buildStayPlan(city, days);
  const normalizedDays = Array.from({ length: days }, (_, index) =>
    enrichDayPlan(modelDays[index] || { day: index + 1 }, index, city, placesData, days)
  );
  const normalizedTips = Array.isArray(parsed.tips)
    ? parsed.tips
    : (parsed.tips ? [String(parsed.tips)] : []);

  return {
    ...parsed,
    city,
    requestedDays: days,
    stayPlan,
    days: normalizedDays,
    tips: [
      ...normalizedTips,
      "For one city, keeping one base hotel is usually practical; shift hotels only when the route moves far to another side of the city.",
      "Lunch and dinner places are rotated day-wise so the plan does not repeat the same restaurant every day."
    ],
    cost: costData
  };
}

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.on("get_history", async ({ sessionId, clientId }) => {
    await attachClientToSession(sessionId, clientId);
    const history = await Chat.find({ sessionId }).sort({ timestamp: 1 });
    socket.emit("history", { sessionId, history });
  });

  socket.on("get_memory", async ({ sessionId }) => {
    socket.emit("memory", await getMemory(sessionId));
  });

  socket.on("message", async ({ msg, sessionId, clientId }) => {
    console.log("User:", msg);
    await Chat.create({ sessionId, clientId, role: "user", content: msg });

    try {
      const conversation = await getConversationContext(sessionId);
      const city = extractCity(msg, conversation.city || "goa");
      const daysMatch = msg.match(/(\d+)\s*(?:day|days|night|nights)/i);
      const days = daysMatch ? parseInt(daysMatch[1]) : (conversation.days || 3);
      console.log(`City="${city}" Days=${days}`);

      const memory = await getMemory(sessionId);
      const emitStatus = (message) => socket.emit("status", message);

      function streamText(text) {
        const words = (text || "").split(" ");
        return new Promise((resolve) => {
          let i = 0;
          const interval = setInterval(() => {
            if (i < words.length) {
              socket.emit("reply_chunk", words[i++] + " ");
            } else {
              clearInterval(interval);
              resolve();
            }
          }, 40);
        });
      }

      emitStatus("Planner Agent is analyzing your request...");
      const plan = await runPlannerAgent(msg, city, days, memory, conversation);
      socket.emit("agent_plan", plan);
      emitStatus(`Plan: ${plan.reasoning || "Standard trip planning flow."}`);

      await new Promise((resolve) => setTimeout(resolve, 500));

      emitStatus(`Checking weather in ${city}...`);
      const weatherData = await getWeather(city);
      socket.emit("tool_result", { tool: "getWeather", result: weatherData });

      emitStatus(`Finding top attractions in ${city}...`);
      const placesData = await getPlaces(city);
      socket.emit("places", placesData);
      socket.emit("tool_result", { tool: "getPlaces", result: placesData });

      emitStatus(`Cost Agent calculating ${memory?.travelStyle || "mid-range"} budget...`);
      const costData = await runCostAgent(city, days, weatherData, placesData, memory);
      socket.emit("tool_result", { tool: "estimateCost", result: costData });

      await new Promise((resolve) => setTimeout(resolve, 300));

      emitStatus(`Itinerary Agent building your ${days}-day plan...`);
      const placesListStr = placesData.length > 0
        ? placesData.map((place) => place.name).join(", ")
        : `iconic spots in ${city}`;

      let raw = "";
      try {
        raw = await createJsonResponse({
          maxOutputTokens: 4000,
          input: `Generate JSON for the complete ${days}-day itinerary for ${city}.`,
          instructions: `You are the ITINERARY AGENT. Output ONLY valid JSON. No markdown.
Destination: ${city}, India.
Duration: ${days} days.
Weather: ${weatherData.temp} C, ${weatherData.description}, humidity ${weatherData.humidity}%.
Attractions: ${placesListStr}.
Budget style: ${costData.travelStyle || "mid-range"}.
Return JSON with keys type, city, summary, days, tips, cost, weather.
Generate exactly ${days} day objects.
Each day plan must be practical but concise.
For every day include:
- Write only one paragraph for the day, no bullet list and no timetable.
- Include lunch and dinner only; do not include breakfast.
- Do not repeat the same restaurant every day.
- Do not repeat attractions across days unless the user specifically asks to revisit one.
- What lunch/dinner dish to try.
- Taxi/auto/metro/ferry route from one place to the next.
- Include only taxi/auto/bus/local transport fare in Rs.
- Do not mention hotel, stay, check-in, base stay, hotel price, food price, meal expense, or total daily expense inside day plans.
Use exactly cost perDay=${costData.perDay}, total=${costData.total}.`
        });
      } catch (err) {
        console.warn("Itinerary Agent fallback:", err.response?.data || err.message);
      }

      let parsed;
      try {
        parsed = parseJsonResponse(raw);
      } catch (err) {
        console.warn("Itinerary model JSON parse failed, using local fallback:", err.message);
        parsed = {
          type: "final",
          city,
          summary: `Here is a practical ${days}-day ${city} trip plan using local attractions, lunch and dinner suggestions, and city-specific local travel fares.`,
          days: [],
          tips: [
            `Use local auto, taxi, bus, or metro options in ${city} depending on distance and time.`,
            "Confirm local fares before starting the ride, especially near tourist spots."
          ],
          cost: costData,
          weather: weatherData
        };
      }

      parsed = normalizeItinerary(parsed, city, days, placesData, costData);

      await streamText(parsed.summary || `Your ${days}-day trip to ${city} is ready!`);
      socket.emit("reply_chunk", "\n\n");
      for (const day of parsed.days) {
        await streamText(`Day ${day.day}: ${day.plan}`);
        socket.emit("reply_chunk", "\n\n");
      }

      socket.emit("itinerary", parsed);
      await Chat.create({ sessionId, clientId, role: "assistant", content: JSON.stringify(parsed) });
      socket.emit("reply_done");
    } catch (err) {
      console.error("ERROR:", err.response?.data || err.message);
      const detail = err.message?.includes("OPENROUTER_API_KEY")
        ? "OpenRouter API key is missing on the backend."
        : "The backend could not complete this request.";
      socket.emit("reply_chunk", `${detail} Please check Render environment variables and logs.`);
      socket.emit("reply_done");
    }
  });

  socket.on("disconnect", () => console.log("Disconnected:", socket.id));
});

mongoose.set("bufferCommands", false);

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log("MongoDB connected");
    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Using OpenRouter model: ${OPENROUTER_MODEL}`);
    });
  })
  .catch((err) => {
    console.error("MongoDB connection failed:", err.message);
  });
