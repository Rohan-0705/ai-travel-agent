import Map from "./Map";

export default function Itinerary({ data, places, onSave, isSaved }) {
  if (!data) return null;

  const cost = data.cost || {};
  const breakdown = cost.breakdown || {};
 const numDays = data.requestedDays || data.days?.length || 0;

  const fmt = (val) =>
    val !== undefined && val !== null && Number(val) > 0
      ? `₹${Number(val).toLocaleString("en-IN")}`
      : "—";
      function addIcons(text) {
  return text
    .replace(/Beach/gi, "🏖️ Beach")
    .replace(/Fort/gi, "🏰 Fort")
    .replace(/Temple/gi, "🛕 Temple")
    .replace(/Market/gi, "🛍️ Market")
    .replace(/Waterfall/gi, "🌊 Waterfall");
}

  return (
    <div className="itinerary">
      <div className="itinerary-title-row">
        <h2>🗺️ Your Trip Plan</h2>
        <button
          className={`save-btn ${isSaved ? "saved" : ""}`}
          onClick={onSave}
          title={isSaved ? "Trip saved!" : "Save this trip"}
        >
          {isSaved ? "✅ Saved" : "💾 Save Trip"}
        </button>
      </div>

      <div className="trip-meta">
        <span>📍 {data.city || "Unknown"}</span>
        <span>📅 {numDays} Days</span>
        <span>💰 {fmt(cost.total)}</span>
      </div>

      <p className="summary">{data.summary}</p>

      {/* Map always renders — passes city so Map can geocode if needed */}
      {places && places.length > 0 && (
        <div className="map-wrapper">
          <Map locations={places} city={data.city} />
        </div>
      )}

      <div className="cost-card">
        <h3>💰 Estimated Budget</h3>
        <div className="cost-grid">
          {/* FIX: use numDays not hardcoded "D" */}
          <div><span>Per Day</span>                                    <strong>{fmt(cost.perDay)}</strong></div>
          <div><span>Total ({numDays}D)</span>                         <strong>{fmt(cost.total)}</strong></div>
          <div><span>🏨 Hotel</span>                                   <strong>{fmt(breakdown.hotel)}</strong></div>
          <div><span>🍽️ Food</span>                                    <strong>{fmt(breakdown.food)}</strong></div>
          <div><span>🚗 Transport</span>                               <strong>{fmt(breakdown.transport)}</strong></div>
        </div>
        <p className="cost-note">📌 {cost.note || `Estimated budget in INR for a mid-range solo traveler (${numDays} days)`}</p>
      </div>

     {data.days?.map((d, index) => (
        <div key={d.day} className="day-card">
          <h3>📅 Day {index + 1}</h3>
          <p>{d.plan}</p>
        </div>
      ))}

      {data.tips?.length > 0 && (
        <div className="tips-card">
          <h3>💡 Travel Tips</h3>
          <ul>{data.tips.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </div>
      )}
    </div>
  );
}