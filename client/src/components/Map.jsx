import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import { useEffect, useMemo, useState } from "react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// Well-known city coordinates (fallback when geocoding isn't available)
const CITY_CENTERS = {
  "mumbai":        [19.0760, 72.8777],
  "pune":          [18.5204, 73.8567],
  "goa":           [15.2993, 74.1240],
  "north goa":     [15.5135, 73.8567],
  "south goa":     [15.1734, 74.0383],
  "delhi":         [28.6139, 77.2090],
  "new delhi":     [28.6139, 77.2090],
  "bangalore":     [12.9716, 77.5946],
  "bengaluru":     [12.9716, 77.5946],
  "hyderabad":     [17.3850, 78.4867],
  "chennai":       [13.0827, 80.2707],
  "kolkata":       [22.5726, 88.3639],
  "jaipur":        [26.9124, 75.7873],
  "agra":          [27.1767, 78.0081],
  "varanasi":      [25.3176, 82.9739],
  "udaipur":       [24.5854, 73.7125],
  "jodhpur":       [26.2389, 73.0243],
  "amritsar":      [31.6340, 74.8723],
  "manali":        [32.2432, 77.1892],
  "shimla":        [31.1048, 77.1734],
  "darjeeling":    [27.0410, 88.2663],
  "ooty":          [11.4102, 76.6950],
  "rishikesh":     [30.0869, 78.2676],
  "haridwar":      [29.9457, 78.1642],
  "leh":           [34.1526, 77.5771],
  "nashik":        [19.9975, 73.7898],
  "aurangabad":    [19.8762, 75.3433],
  "mahabaleshwar": [17.9307, 73.6477],
  "lonavala":      [18.7537, 73.4063],
  "nagpur":        [21.1458, 79.0882],
  "kolhapur":      [16.7050, 74.2433],
  "satara":        [17.6805, 73.9990],
  "sangli":        [16.8524, 74.5815],
  "solapur":       [17.6599, 75.9064],
  "thane":         [19.2183, 72.9781],
  "nanded":        [19.1383, 77.3210],
  "amravati":      [20.9374, 77.7796],
  "ratnagiri":     [16.9902, 73.3120],
};

function FitBounds({ locations }) {
  const map = useMap();
  const key = useMemo(() => JSON.stringify(locations), [locations]);
  useEffect(() => {
    if (!locations.length) return;
    if (locations.length === 1) { map.setView([locations[0].lat, locations[0].lon], 13); return; }
    map.fitBounds(locations.map(l => [l.lat, l.lon]), { padding: [40, 40] });
  }, [key]);
  return null;
}

const customIcon = new L.Icon({
  iconUrl: "https://cdn-icons-png.flaticon.com/512/684/684908.png",
  iconSize: [32, 32],
});

// Spread markers evenly around a city center when we don't have real coords
function spreadAroundCenter(center, places) {
  const [baseLat, baseLon] = center;
  const offsets = [
    [0, 0], [0.015, 0.010], [-0.010, 0.018], [0.008, -0.015],
    [-0.018, -0.008], [0.020, 0.020], [-0.012, 0.022],
  ];
  return places.map((p, i) => ({
    ...p,
    lat: baseLat + (offsets[i % offsets.length][0]),
    lon: baseLon + (offsets[i % offsets.length][1]),
    approximate: true,
  }));
}

export default function Map({ locations, city }) {
  const [resolvedLocs, setResolvedLocs] = useState([]);

  useEffect(() => {
    if (!locations?.length) return;

    const hasRealCoords = locations.some(l => l.lat && l.lon && (Math.abs(l.lat) > 0.1 || Math.abs(l.lon) > 0.1));

    if (hasRealCoords) {
      // Use real coords, filter out any lat=0/lon=0 entries
      setResolvedLocs(locations.filter(l => l.lat && l.lon));
      return;
    }

    // No real coords — use city center lookup then spread markers
    const cityKey = (city || "").toLowerCase().trim();
    const center = CITY_CENTERS[cityKey];

    if (center) {
      setResolvedLocs(spreadAroundCenter(center, locations));
      return;
    }

    // Last resort: try to geocode via Nominatim (no API key needed)
    fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city + ", India")}&format=json&limit=1`)
      .then(r => r.json())
      .then(data => {
        if (data?.[0]) {
          const center = [parseFloat(data[0].lat), parseFloat(data[0].lon)];
          setResolvedLocs(spreadAroundCenter(center, locations));
        }
      })
      .catch(() => {/* silently fail */});
  }, [locations, city]);

  if (!resolvedLocs.length) return null;

  const center = [resolvedLocs[0].lat, resolvedLocs[0].lon];

  return (
    <div style={{ margin: "16px 0", borderRadius: "12px", overflow: "hidden" }}>
      <MapContainer center={center} zoom={13} style={{ height: "300px", width: "100%" }}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <FitBounds locations={resolvedLocs} />
        {resolvedLocs.map((loc, i) => (
         <Marker key={loc.name} position={[loc.lat, loc.lon]} icon={customIcon}>
            <Popup>
              <strong>{loc.name}</strong>
              {loc.approximate && <><br /><em style={{ fontSize: "11px", color: "#888" }}>Approximate location</em></>}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}