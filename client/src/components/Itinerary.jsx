import Map from "./Map";

function toText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join("\n");
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([key, item]) => {
        const label = key.replace(/_/g, " ");
        const text = toText(item);
        return text ? `${label}: ${text}` : "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return String(value);
}

function getDayPlan(day) {
  if (typeof day === "string") return day;
  return toText(day.plan || day.activities || day.schedule || day.itinerary || day);
}

export default function Itinerary({ data, places, onSave, isSaved }) {
  if (!data) return null;

  const cost = data.cost || {};
  const breakdown = cost.breakdown || {};
  const days = Array.isArray(data.days) ? data.days : [];
  const tips = Array.isArray(data.tips)
    ? data.tips
    : (data.tips ? [String(data.tips)] : []);
  const numDays = data.requestedDays || days.length || 0;
  const stayPlan = data.stayPlan || null;
  const taxiAutoTotal = days.reduce((sum, day) => sum + Number(day?.dayExpense?.taxiAuto || 0), 0);
  const busLocalTotal = days.reduce((sum, day) => sum + Number(day?.dayExpense?.busLocal || 0), 0);
  const localTransportTotal = days.reduce((sum, day) => sum + Number(day?.dayExpense?.transport || 0), 0) || breakdown.transport;
  const hotelTotal = Number(breakdown.hotel || 0);
  const foodTotal = Number(breakdown.food || 0);
  const tripExpenseTotal = hotelTotal + foodTotal + Number(localTransportTotal || 0);

  const fmt = (val) =>
    val !== undefined && val !== null && Number(val) > 0
      ? `Rs ${Number(val).toLocaleString("en-IN")}`
      : "-";

  return (
    <div className="itinerary">
      <div className="itinerary-title-row">
        <h2>Your Trip Plan</h2>
        <button
          className={`save-btn ${isSaved ? "saved" : ""}`}
          onClick={onSave}
          title={isSaved ? "Trip saved!" : "Save this trip"}
        >
          {isSaved ? "Saved" : "Save Trip"}
        </button>
      </div>

      <div className="trip-meta">
        <span>{data.city || "Unknown"}</span>
        <span>{numDays} Days</span>
        <span>{fmt(tripExpenseTotal)} Total</span>
      </div>

      <p className="summary">{data.summary}</p>

      {stayPlan?.description && (
        <div className="stay-card">
          <h3>{stayPlan.title || "Stay Plan"}</h3>
          <p>{stayPlan.description}</p>
        </div>
      )}

      {places && places.length > 0 && (
        <div className="map-wrapper">
          <Map locations={places} city={data.city} />
        </div>
      )}

      <div className="cost-card">
        <h3>Estimated Expenses</h3>
        <div className="cost-grid">
          <div><span>Hotel</span><strong>{fmt(hotelTotal)}</strong></div>
          <div><span>Food</span><strong>{fmt(foodTotal)}</strong></div>
          <div><span>Taxi/Auto</span><strong>{fmt(taxiAutoTotal)}</strong></div>
          <div><span>Bus/Local</span><strong>{fmt(busLocalTotal)}</strong></div>
          <div><span>Total Travel</span><strong>{fmt(localTransportTotal)}</strong></div>
          <div><span>Total</span><strong>{fmt(tripExpenseTotal)}</strong></div>
        </div>
        <p className="cost-note">Hotel and food use city-specific mid-range estimates. Day plans show only taxi, auto, bus, or metro fares.</p>
      </div>

      {days.map((day, index) => (
        <div key={day.day || index} className="day-card">
          <h3>Day {index + 1}</h3>
          <p>{getDayPlan(day)}</p>
        </div>
      ))}

      {tips.length > 0 && (
        <div className="tips-card">
          <h3>Travel Tips</h3>
          <ul>{tips.map((tip, index) => <li key={index}>{tip}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
