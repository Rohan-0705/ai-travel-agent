export default function SavedTrips({ trips, onLoad, onDelete, onClose }) {
  if (!trips) return null;

  return (
    <div className="saved-sidebar">
      <div className="saved-header">
        <h3>🔖 Saved Trips</h3>
        <button className="close-btn" onClick={onClose}>✕</button>
      </div>

      {trips.length === 0 && (
        <p className="saved-empty">No saved trips yet.<br />Click 💾 on any itinerary to save it.</p>
      )}

      {trips.map((trip) => (
        <div key={trip._id} className="saved-card">
          <div className="saved-card-info">
            <span className="saved-city">📍 {trip.city}</span>
            <span className="saved-days">  {trip.days} days</span>
            <span className="saved-date">{new Date(trip.savedAt).toLocaleDateString("en-IN")}</span>
          </div>
          <p className="saved-summary">
            {trip.summary ? trip.summary.slice(0, 80) + "..." : "No summary available."}
          </p>
          <div className="saved-actions">
            <button className="load-btn" onClick={() => onLoad(trip)}>📂 Load</button>
            <button className="delete-btn" onClick={() => onDelete(trip._id)}>🗑️ Delete</button>
          </div>
        </div>
      ))}
    </div>
  );
}