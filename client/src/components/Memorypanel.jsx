export default function MemoryPanel({ memory, onClear, onClose }) {
  if (!memory) return null;

  const hasData = (memory.pastTrips?.length > 0) || (memory.interests?.length > 0) || memory.travelStyle;

  return (
    <div className="memory-sidebar">
      <div className="saved-header">
        <h3>🧠 Your Travel Memory</h3>
        <button className="close-btn" onClick={onClose}>✕</button>
      </div>

      {!hasData && (
        <p className="saved-empty">No memory yet.<br />Save a trip to build your travel profile!</p>
      )}

      {memory.pastTrips?.length > 0 && (
        <div className="memory-section">
          <div className="memory-section-label">🗺️ Cities Visited</div>
          <div className="memory-tags">
            {memory.pastTrips.map((city, i) => (
              <span key={i} className="memory-tag city-tag">{city}</span>
            ))}
          </div>
        </div>
      )}

      {memory.interests?.length > 0 && (
        <div className="memory-section">
          <div className="memory-section-label">❤️ Your Interests</div>
          <div className="memory-tags">
            {memory.interests.map((interest, i) => (
              <span key={i} className="memory-tag interest-tag">{interest}</span>
            ))}
          </div>
        </div>
      )}

      {memory.travelStyle && (
        <div className="memory-section">
          <div className="memory-section-label">💼 Travel Style</div>
          <span className="memory-tag style-tag">
            {memory.travelStyle === "budget" ? "💸 Budget" : memory.travelStyle === "luxury" ? "💎 Luxury" : "⚖️ Mid-Range"}
          </span>
        </div>
      )}

      {memory.lastUpdated && (
        <p className="memory-updated">Last updated: {new Date(memory.lastUpdated).toLocaleDateString("en-IN")}</p>
      )}

      <div className="memory-note">
        <span>ℹ️</span>
        <span>Memory is auto-built from your saved trips. The AI uses this to personalize future recommendations.</span>
      </div>

      <button className="delete-btn full-width" onClick={onClear}>🗑️ Clear My Memory</button>
    </div>
  );
}