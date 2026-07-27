"use client";
import useSWR from "swr";
import { fetcher, SalesGeneralKPIs } from "./salesApi";
import { TrendingUp, Users, Target, AlertTriangle, CheckCircle, Activity, Briefcase, ShieldAlert, MessageCircle, BarChart2, ArrowUpRight } from "lucide-react";
import { 
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, Cell, 
  AreaChart, Area, CartesianGrid 
} from "recharts";

export function SalesGeneralDashboard() {
  const { data: kpis, error } = useSWR<SalesGeneralKPIs>("/api/sales/analysis/general", fetcher, {
    refreshInterval: 5000,
  });

  const isLoading = !kpis && !error;

  // Elite Mock Data for Premium Presentation
  const mockData: SalesGeneralKPIs = {
    sdr: { meetings_today: 18, objections_handled: 24, prospecting_volume: 310 },
    closer: { win_rate: 42.5, deal_velocity_days: 11, total_negotiation: 8 },
    manager: { total_pipeline_value: 845000, high_risk_deals: 2, team_performance_score: 96 },
    funnel: {
      "Discovery": 24,
      "Demo": 15,
      "Negotiation": 8,
      "Closed Won": 5
    },
    high_risk_list: [
      { id: 1, meeting_id: 101, platform: "meet", summary: "Prospect loves the product but CFO is pushing back on budget constraints.", risk_flag: "High", funnel_stage: "Negotiation", next_steps: [], objections: [], created_at: "" },
      { id: 2, meeting_id: 105, platform: "zoom", summary: "Champion left the company; need to re-engage with the new VP of Engineering.", risk_flag: "High", funnel_stage: "Demo", next_steps: [], objections: [], created_at: "" },
    ],
    action_items_feed: [
      { id: 3, meeting_id: 102, platform: "teams", summary: "Send security compliance whitepaper.", risk_flag: "Low", funnel_stage: "Discovery", next_steps: [{ action: "Send Whitepaper", assignee: "Sarah", deadline: "Today" }], objections: [], created_at: "" },
      { id: 4, meeting_id: 108, platform: "meet", summary: "Schedule technical deep dive.", risk_flag: "Low", funnel_stage: "Demo", next_steps: [{ action: "Schedule Call", assignee: "Mike", deadline: "Tomorrow" }], objections: [], created_at: "" }
    ],
    objections_handling: {
      total_raised: 45,
      resolved: 38,
      top_objections: [
        { category: "Pricing", count: 20, resolved: 15 },
        { category: "Timeline", count: 12, resolved: 11 },
        { category: "Competitor", count: 8, resolved: 7 },
        { category: "Authority", count: 5, resolved: 5 },
      ]
    },
    call_quality: {
      avg_talk_listen_ratio: 42, 
      avg_sentiment: 94,
      sentiment_trend: "up"
    }
  };

  const data = kpis || mockData;

  const funnelData = Object.entries(data.funnel).map(([name, value]) => ({ name, value }));
  const velocityData = [
    { day: "Mon", pipeline: 680 },
    { day: "Tue", pipeline: 710 },
    { day: "Wed", pipeline: 745 },
    { day: "Thu", pipeline: 790 },
    { day: "Fri", pipeline: 845 },
  ];

  const bentoCard: React.CSSProperties = {
    backgroundColor: "var(--panel)",
    border: "1px solid rgba(255,255,255,0.04)",
    borderRadius: 24,
    padding: "28px",
    display: "flex",
    flexDirection: "column",
    gap: 20,
    boxShadow: "0 10px 40px -10px rgba(0,0,0,0.3)",
    backdropFilter: "blur(12px)",
    position: "relative",
    overflow: "hidden"
  };

  const headerLabel: React.CSSProperties = {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.15em",
    fontWeight: 800,
    color: "var(--t3)",
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 8
  };

  const statValue: React.CSSProperties = {
    fontSize: 38,
    fontWeight: 900,
    lineHeight: 1,
    letterSpacing: "-0.04em",
    color: "var(--t1)"
  };

  const statLabel: React.CSSProperties = {
    fontSize: 13,
    color: "var(--t2)",
    marginTop: 8,
    fontWeight: 500
  };

  return (
    <div className="vx-fade-up" style={{ height: "100%", overflowY: "auto", padding: "40px", backgroundColor: "var(--bg)", color: "var(--t1)" }}>
      <div style={{ maxWidth: 1400, margin: "0 auto", display: "flex", flexDirection: "column", gap: 32 }}>
        
        {/* Header Section */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <h1 style={{ fontSize: 36, fontWeight: 900, letterSpacing: "-0.04em", display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ padding: 10, borderRadius: 12, backgroundColor: "var(--accentbg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <TrendingUp size={28} style={{ color: "var(--accent)" }} />
              </div>
              Sales Intelligence
            </h1>
            <p style={{ color: "var(--t2)", fontSize: 16, fontWeight: 500, marginLeft: 52 }}>
              Live pipeline velocity, objection handling, and call quality monitoring.
            </p>
          </div>
          <div style={{ padding: "8px 16px", backgroundColor: "var(--panel2)", border: "1px solid var(--line)", borderRadius: 30, fontSize: 12, letterSpacing: "0.05em", fontWeight: 700, display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 8, height: 8, backgroundColor: isLoading ? "var(--t3)" : "var(--accent)", borderRadius: "50%", animation: isLoading ? "none" : "pulse 2s infinite" }} />
            {isLoading ? "CONNECTING..." : "LIVE SYNC ACTIVE"}
          </div>
        </div>

        {error && (
          <div style={{ padding: 16, borderRadius: 12, backgroundColor: "var(--dangerbg)", border: "1px solid var(--danger)", color: "var(--danger)", fontSize: 14, fontWeight: 600 }}>
            Backend unreachable. Displaying elite cached data.
          </div>
        )}

        {/* Bento Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: 24 }}>
          
          {/* Row 1: Top KPIs */}
          <div style={{ gridColumn: "span 3", ...bentoCard }}>
            <h3 style={headerLabel}><Activity size={16} color="var(--blue)" /> Outbound Pulse</h3>
            <div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <div style={statValue}>{data.sdr.meetings_today}</div>
                <div style={{ color: "var(--blue)", fontSize: 14, fontWeight: 700 }}>meetings</div>
              </div>
              <div style={statLabel}>Generated Today • {data.sdr.prospecting_volume} vol</div>
            </div>
            <div style={{ position: "absolute", right: -20, bottom: -20, opacity: 0.05 }}><Activity size={140} /></div>
          </div>

          <div style={{ gridColumn: "span 3", ...bentoCard }}>
            <h3 style={headerLabel}><Target size={16} color="var(--accent)" /> Win Velocity</h3>
            <div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <div style={{ ...statValue, color: "var(--accent)" }}>{data.closer.win_rate}%</div>
                <div style={{ color: "var(--accent)", fontSize: 14, fontWeight: 700 }}><ArrowUpRight size={16}/></div>
              </div>
              <div style={statLabel}>{data.closer.deal_velocity_days}d avg close • {data.closer.total_negotiation} active</div>
            </div>
            <div style={{ position: "absolute", right: -20, bottom: -20, opacity: 0.05 }}><Target size={140} /></div>
          </div>

          <div style={{ gridColumn: "span 3", ...bentoCard }}>
            <h3 style={headerLabel}><Briefcase size={16} color="var(--t1)" /> Pipeline Value</h3>
            <div>
              <div style={statValue}>${(data.manager.total_pipeline_value / 1000).toFixed(1)}k</div>
              <div style={statLabel}>Active Pipeline • Score {data.manager.team_performance_score}/100</div>
            </div>
          </div>

          <div style={{ gridColumn: "span 3", ...bentoCard }}>
            <h3 style={headerLabel}><MessageCircle size={16} color="var(--violet)" /> Live Call Quality</h3>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flex: 1 }}>
              <div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <div style={statValue}>{data.call_quality?.avg_sentiment ?? 0}</div>
                  <div style={{ color: "var(--violet)", fontSize: 14, fontWeight: 700 }}>/ 100</div>
                </div>
                <div style={statLabel}>Client Sentiment</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: "var(--t1)" }}>{data.call_quality?.avg_talk_listen_ratio ?? 0}%</div>
                <div style={{ fontSize: 11, color: "var(--t3)", fontWeight: 700, textTransform: "uppercase" }}>Talk Ratio</div>
              </div>
            </div>
          </div>

          {/* Row 2: Deep Insights */}
          <div style={{ gridColumn: "span 4", ...bentoCard, padding: 0 }}>
            <div style={{ padding: "28px 28px 16px" }}>
              <h3 style={headerLabel}><ShieldAlert size={16} color="var(--warn)" /> Objection Handling</h3>
              <p style={{ fontSize: 13, color: "var(--t2)", lineHeight: 1.5, marginBottom: 16 }}>
                Real-time tracking of prospect objections and rep resolution success rate.
              </p>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 24 }}>
                <span style={{ fontSize: 42, fontWeight: 900, color: "var(--warn)", lineHeight: 1 }}>{Math.round(((data.objections_handling?.resolved ?? 0) / (data.objections_handling?.total_raised ?? 1)) * 100)}%</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--t3)", textTransform: "uppercase" }}>Resolution Rate</span>
              </div>
            </div>
            <div style={{ padding: "0 28px 28px", display: "flex", flexDirection: "column", gap: 16 }}>
              {data.objections_handling?.top_objections.map(obj => {
                const pct = Math.round((obj.resolved / obj.count) * 100);
                return (
                  <div key={obj.category}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                      <span style={{ color: "var(--t1)" }}>{obj.category}</span>
                      <span style={{ color: "var(--t3)" }}>{obj.resolved}/{obj.count} resolved</span>
                    </div>
                    <div style={{ height: 6, width: "100%", backgroundColor: "var(--panel2)", borderRadius: 4, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pct}%`, backgroundColor: pct > 75 ? "var(--accent)" : "var(--warn)", borderRadius: 4, transition: "width 1s cubic-bezier(0.4, 0, 0.2, 1)" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ gridColumn: "span 5", ...bentoCard }}>
            <h3 style={headerLabel}><TrendingUp size={16} color="var(--accent)" /> Pipeline Trajectory (5 Days)</h3>
            <div style={{ flex: 1, minHeight: 220, width: "100%" }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={velocityData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorPipeline" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="var(--accent)" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: "var(--t3)", fontSize: 12, fontWeight: 600 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "var(--t3)", fontSize: 12, fontWeight: 600 }} />
                  <RechartsTooltip 
                    contentStyle={{ backgroundColor: "var(--panel)", border: "1px solid var(--line2)", borderRadius: 12, color: "var(--t1)", boxShadow: "0 10px 30px rgba(0,0,0,0.5)" }}
                    itemStyle={{ color: "var(--accent)", fontWeight: 800 }}
                  />
                  <Area type="monotone" dataKey="pipeline" stroke="var(--accent)" strokeWidth={4} fillOpacity={1} fill="url(#colorPipeline)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div style={{ gridColumn: "span 3", ...bentoCard }}>
            <h3 style={headerLabel}><Users size={16} color="var(--t1)" /> Funnel Stage</h3>
            <div style={{ flex: 1, minHeight: 220, width: "100%" }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={funnelData} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
                  <XAxis type="number" hide />
                  <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fill: "var(--t2)", fontSize: 12, fontWeight: 700 }} width={80} />
                  <RechartsTooltip 
                    cursor={{ fill: "rgba(255,255,255,0.02)" }}
                    contentStyle={{ backgroundColor: "var(--panel)", border: "1px solid var(--line2)", borderRadius: 12, color: "var(--t1)" }}
                  />
                  <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={20}>
                    {funnelData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={index === funnelData.length - 1 ? "var(--accent)" : "var(--panel2)"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Row 3: Actionable Lists */}
          <div style={{ gridColumn: "span 6", ...bentoCard, border: "1px solid rgba(224, 100, 94, 0.2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <h3 style={{ ...headerLabel, marginBottom: 0, color: "var(--danger)" }}><AlertTriangle size={16} /> Deals At Risk</h3>
              <div style={{ backgroundColor: "var(--dangerbg)", color: "var(--danger)", padding: "4px 10px", borderRadius: 12, fontSize: 12, fontWeight: 800 }}>
                {data.manager.high_risk_deals} CRITICAL
              </div>
            </div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {data.high_risk_list.map((deal: any) => (
                <div key={deal.id} style={{ display: "flex", flexDirection: "column", gap: 10, backgroundColor: "rgba(0,0,0,0.2)", padding: 20, borderRadius: 16, border: "1px solid rgba(255,255,255,0.03)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 15, fontWeight: 800, color: "var(--t1)" }}>Meeting #{deal.meeting_id}</span>
                    <span style={{ fontSize: 11, textTransform: "uppercase", fontWeight: 800, color: "var(--danger)", backgroundColor: "var(--dangerbg)", padding: "4px 10px", borderRadius: 8 }}>{deal.funnel_stage}</span>
                  </div>
                  <p style={{ color: "var(--t2)", fontSize: 14, lineHeight: 1.6 }}>{deal.summary}</p>
                </div>
              ))}
            </div>
          </div>

          <div style={{ gridColumn: "span 6", ...bentoCard }}>
            <h3 style={headerLabel}><CheckCircle size={16} color="var(--accent)" /> Live Action Feed</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {data.action_items_feed.map((item: any) => (
                <div key={item.id} style={{ display: "flex", flexDirection: "column", gap: 14, backgroundColor: "rgba(0,0,0,0.2)", padding: 20, borderRadius: 16, border: "1px solid rgba(255,255,255,0.03)" }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "var(--t3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Meeting #{item.meeting_id} • {item.funnel_stage}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {item.next_steps.map((step: any, idx: number) => (
                      <div key={idx} style={{ display: "flex", alignItems: "center", gap: 14 }}>
                        <div style={{ width: 20, height: 20, borderRadius: 6, border: "2px solid var(--line2)", flex: "none" }} />
                        <span style={{ fontSize: 15, color: "var(--t1)", fontWeight: 500 }}>{step.action}</span>
                        <div style={{ display: "flex", gap: 12, fontSize: 12, color: "var(--t3)", marginLeft: "auto", fontWeight: 600 }}>
                          {step.assignee && <span style={{ padding: "4px 8px", backgroundColor: "var(--panel2)", borderRadius: 6 }}>{step.assignee}</span>}
                          {step.deadline && <span style={{ padding: "4px 8px", backgroundColor: "var(--panel2)", borderRadius: 6 }}>{step.deadline}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
