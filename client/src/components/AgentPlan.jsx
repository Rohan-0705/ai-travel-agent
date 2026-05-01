import { useEffect, useState } from "react";

const TOOL_ICONS = {
  getWeather:   { icon: "🌤️", label: "Weather Tool",  color: "#4fc3f7" },
  getPlaces:    { icon: "📍", label: "Places Tool",   color: "#81c784" },
  estimateCost: { icon: "💰", label: "Cost Tool",     color: "#ffb74d" },
};

const AGENT_ICONS = {
  planner_agent:   { icon: "🧠", label: "Planner Agent",   color: "#ce93d8" },
  itinerary_agent: { icon: "📝", label: "Itinerary Agent", color: "#80cbc4" },
  cost_agent:      { icon: "💹", label: "Cost Agent",      color: "#ffcc02" },
};

export default function AgentPlan({ plan, toolLog, done }) {
  const [visible,   setVisible]   = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => { setTimeout(() => setVisible(true), 50); }, []);

  // Collapse 1.5s after itinerary is ready
  useEffect(() => {
    if (done) {
      const t = setTimeout(() => setCollapsed(true), 1500);
      return () => clearTimeout(t);
    }
  }, [done]);

  if (!plan || collapsed) return null;

  const toolsDone = toolLog.map(t => t.tool);
  const allTools  = plan.tools_needed   || [];
  const allAgents = plan.agent_sequence || [];
  const getTravelPerDay = (result) =>
    result?.transportPerDay
    || (result?.requestedDays ? Math.round((result?.breakdown?.transport || 0) / result.requestedDays) : 0)
    || result?.breakdown?.transport
    || 0;

  // Only show personalisation when it's a real, meaningful sentence
  const showPersonalization =
    plan.personalization &&
    plan.personalization.trim().length > 10 &&
    !/^none$/i.test(plan.personalization.trim()) &&
    !/no (personalization|memory)/i.test(plan.personalization);

  return (
    <div className={`agent-plan-card ${visible ? "visible" : ""} ${done ? "finishing" : ""}`}>

      <div className="agent-plan-header">
        <span className="agent-badge planner">🧠 PLANNER AGENT</span>
        <span className="agent-plan-intent">{plan.intent}</span>
      </div>

      <p className="agent-reasoning">
        <span className="reasoning-label">Reasoning:</span> {plan.reasoning}
      </p>

      {showPersonalization && (
        <p className="agent-personalization">
          <span className="reasoning-label">🧬 Personalizing:</span> {plan.personalization}
        </p>
      )}

      <div className="agent-flow">
        <div className="flow-section">
          <div className="flow-label">TOOLS</div>
          <div className="flow-items">
            {allTools.map((tool) => {
              const meta   = TOOL_ICONS[tool] || { icon: "🔧", label: tool, color: "#aaa" };
              const isDone = toolsDone.includes(tool);
              const result = toolLog.find(t => t.tool === tool)?.result;
              return (
                <div key={tool} className={`flow-item ${isDone ? "done" : "pending"}`}>
                  <span className="flow-icon">{meta.icon}</span>
                  <span className="flow-name">{meta.label}</span>
                  {isDone && result && (
                    <span className="flow-result">
                      {tool === "getWeather"   && `${result.temp}°C, ${result.description}`}
                      {tool === "getPlaces"    && `${result.length} places found`}
                      {tool === "estimateCost" && `₹${getTravelPerDay(result).toLocaleString("en-IN")}/day travel`}
                    </span>
                  )}
                  <span className={`flow-status ${isDone ? "check" : "dot"}`}>{isDone ? "✓" : "·"}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flow-arrow">→</div>

        <div className="flow-section">
          <div className="flow-label">AGENTS</div>
          <div className="flow-items">
            {allAgents.map((agent) => {
              const meta = AGENT_ICONS[agent] || { icon: "🤖", label: agent, color: "#aaa" };
              return (
                <div key={agent} className={`flow-item ${done ? "done" : "pending"}`}>
                  <span className="flow-icon">{meta.icon}</span>
                  <span className="flow-name">{meta.label}</span>
                  <span className={`flow-status ${done ? "check" : "dot"}`}>{done ? "✓" : "·"}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {toolLog.length > 0 && (
        <div className="tool-log">
          {toolLog.map(({ tool, result }, i) => {
            const meta = TOOL_ICONS[tool] || { icon: "🔧", label: tool, color: "#aaa" };
            return (
              <div key={i} className="tool-log-entry">
                <span className="tool-log-icon">{meta.icon}</span>
                <div className="tool-log-content">
                  <span className="tool-log-name">{meta.label} returned:</span>
                  {tool === "getWeather" && (
                    <span className="tool-log-value">
                      {result.temp}°C · {result.description} · {result.humidity}% humidity
                    </span>
                  )}
                  {tool === "getPlaces" && (
                    <span className="tool-log-value">
                      {result.slice(0, 3).map(p => p.name).join(" · ")}
                      {result.length > 3 ? ` +${result.length - 3} more` : ""}
                    </span>
                  )}
                  {tool === "estimateCost" && (
                    <span className="tool-log-value">
                      Local travel ₹{getTravelPerDay(result).toLocaleString("en-IN")}/day · Total ₹{result.breakdown?.transport?.toLocaleString("en-IN")}
                      {result.travelStyle ? ` · ${result.travelStyle}` : ""}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
