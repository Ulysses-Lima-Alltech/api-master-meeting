"use client";
import { useState, useRef, useMemo } from "react";
import useSWR from "swr";
import { MeetingMock } from "./meetingModel";
import { useMeetingLive } from "./meetingLive";
import { Target, AlertTriangle, TrendingUp, CheckCircle, Thermometer } from "lucide-react";
import { SalesAnalysis, postLiveAnalysis } from "./salesApi";

interface SalesLiveDashboardProps {
  meeting: MeetingMock;
}

export function SalesLiveDashboard({ meeting }: SalesLiveDashboardProps) {
  const liveState = useMeetingLive(meeting.id, meeting.session_uid || "");
  const lastAnalyzedLen = useRef(0);
  
  // Aggregate transcript into a single block of text
  const currentTranscript = useMemo(() => {
    return liveState.transcript
      .filter(t => t.completed)
      .map(t => `${t.speaker}: ${t.text}`)
      .join("\n");
  }, [liveState.transcript]);

  // Only trigger a new SWR fetch if transcript grew by at least 100 chars
  const shouldAnalyze = currentTranscript.length - lastAnalyzedLen.current >= 100;
  
  const { data: liveAnalysis, isValidating: analyzing } = useSWR<Partial<SalesAnalysis> | null>(
    shouldAnalyze ? ["/api/sales/analysis/live", meeting.id, currentTranscript.length] : null,
    async () => {
      lastAnalyzedLen.current = currentTranscript.length;
      return await postLiveAnalysis(meeting.id, currentTranscript);
    },
    { 
      keepPreviousData: true, 
      revalidateOnFocus: false 
    }
  );

  const stage = liveAnalysis?.funnel_stage || "Listening...";
  const risk = liveAnalysis?.risk_flag || "Low";
  const summary = liveAnalysis?.summary || "Waiting for enough dialogue to generate summary.";
  const objections = liveAnalysis?.objections || [];
  const nextSteps = liveAnalysis?.next_steps || [];
  
  // Default to 50 if no score yet. 100 = Hot (Good/Engaged), 0 = Cold (Bad/Disengaged)
  const temperature = liveAnalysis?.temperature_score ?? 50; 
  
  // Map risk/temperature to colors
  const tempColor = temperature >= 70 ? "var(--green)" : temperature >= 40 ? "#f59e0b" : "var(--danger)";
  const riskColor = risk === "High" ? "var(--danger)" : risk === "Medium" ? "#f59e0b" : "var(--green)";

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "32px", backgroundColor: "var(--bg)", color: "var(--t1)" }}>
      <div style={{ maxWidth: 1024, margin: "0 auto", display: "flex", flexDirection: "column", gap: 32 }}>
        
        {/* Header Section */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <h1 style={{ fontSize: 32, fontWeight: 900, letterSpacing: "-0.03em", display: "flex", alignItems: "center", gap: 12 }}>
              <TrendingUp size={32} style={{ color: "var(--accent)" }} />
              Live Sales Intelligence
            </h1>
            <p style={{ color: "var(--t2)", fontSize: 15, fontWeight: 500 }}>
              Real-time analysis for <span style={{ fontWeight: 700, color: "var(--t1)" }}>{meeting.title}</span>
            </p>
          </div>
          <div style={{ padding: "6px 12px", backgroundColor: "var(--panel)", border: "1px solid var(--line)", borderRadius: 20, fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 8, height: 8, backgroundColor: analyzing ? "var(--accent)" : "var(--green)", borderRadius: "50%", animation: "pulse 2s infinite" }} />
            {analyzing ? "ANALYZING..." : "LIVE"}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: 24 }}>
          
          {/* Current State & Temperature (Bento Box 1) */}
          <div style={{ gridColumn: "span 12", padding: 24, borderRadius: 16, backgroundColor: "var(--panel)", border: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 16, boxShadow: "0 4px 20px rgba(0,0,0,0.02)" }} className="md:col-span-6">
            <h2 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, color: "var(--t3)", display: "flex", alignItems: "center", gap: 8 }}>
              <Target size={16} /> Current State
            </h2>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: "var(--t2)", fontSize: 14 }}>Funnel Stage</span>
              <span style={{ color: "var(--t1)", fontWeight: 700 }}>{stage}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: "var(--t2)", fontSize: 14 }}>Risk Level</span>
              <span style={{ color: riskColor, fontWeight: 800 }}>{risk}</span>
            </div>
            
            {/* Temperature Gauge */}
            <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8, backgroundColor: "var(--bg)", padding: 16, borderRadius: 12, border: "1px solid var(--line)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "var(--t3)", fontSize: 12, textTransform: "uppercase", fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                  <Thermometer size={14} color={tempColor} /> Meeting Temperature
                </span>
                <span style={{ color: tempColor, fontWeight: 800, fontSize: 16 }}>{temperature}°</span>
              </div>
              <div style={{ height: 8, backgroundColor: "var(--panel2)", borderRadius: 9999, overflow: "hidden", display: "flex" }}>
                <div style={{ height: "100%", backgroundColor: tempColor, width: `${temperature}%`, transition: "width 1s cubic-bezier(0.4, 0, 0.2, 1), background-color 1s ease" }} />
              </div>
            </div>
          </div>

          {/* Real-time Summary (Bento Box 2) */}
          <div style={{ gridColumn: "span 12", padding: 24, borderRadius: 16, backgroundColor: "var(--panel)", border: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 16, boxShadow: "0 4px 20px rgba(0,0,0,0.02)" }} className="md:col-span-6">
            <h2 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, color: "var(--t3)", display: "flex", alignItems: "center", gap: 8 }}>
              <CheckCircle size={16} /> Live Summary
            </h2>
            <p style={{ color: "var(--t1)", fontSize: 15, lineHeight: 1.6 }}>
              {summary}
            </p>
          </div>

          {/* Objections (Bento Box 3) */}
          <div style={{ gridColumn: "span 12", padding: 24, borderRadius: 16, backgroundColor: "var(--panel)", border: risk === "High" ? "1px solid var(--danger)" : "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 16, boxShadow: "0 4px 20px rgba(0,0,0,0.02)" }}>
            <h2 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, color: "var(--danger)", display: "flex", alignItems: "center", gap: 8 }}>
              <AlertTriangle size={16} /> Detected Objections
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 16 }}>
              {objections.length === 0 ? (
                <div style={{ color: "var(--t3)", fontSize: 14 }}>No objections detected yet.</div>
              ) : (
                objections.map((obj: any, idx: number) => (
                  <div key={idx} style={{ backgroundColor: "var(--bg)", border: "1px solid var(--line)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                    <span style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>{obj.category}</span>
                    <p style={{ color: "var(--t2)", fontSize: 14, lineHeight: 1.5 }}>{obj.description}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Action Items Feed (Bento Box 4) */}
          <div style={{ gridColumn: "span 12", padding: 24, borderRadius: 16, backgroundColor: "var(--panel)", border: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 16, boxShadow: "0 4px 20px rgba(0,0,0,0.02)" }}>
            <h2 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, color: "var(--t3)", display: "flex", alignItems: "center", gap: 8 }}>
              <CheckCircle size={16} /> Recommended Actions
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {nextSteps.length === 0 ? (
                <div style={{ color: "var(--t3)", fontSize: 14 }}>Waiting for actionable items...</div>
              ) : (
                nextSteps.map((step: any, idx: number) => (
                  <div key={idx} style={{ display: "flex", alignItems: "center", gap: 16, backgroundColor: "var(--bg)", padding: 16, borderRadius: 12, border: "1px solid var(--line)" }}>
                    <div style={{ width: 24, height: 24, borderRadius: 6, border: "2px solid var(--line)", flex: "none", display: "flex", alignItems: "center", justifyContent: "center" }} />
                    <span style={{ fontSize: 15, color: "var(--t1)", fontWeight: 500 }}>{step.action}</span>
                    <div style={{ display: "flex", gap: 16, fontSize: 13, color: "var(--t3)", marginLeft: "auto" }}>
                      {step.assignee && <span style={{ display: "flex", alignItems: "center", gap: 6 }}>👤 {step.assignee}</span>}
                      {step.deadline && <span style={{ display: "flex", alignItems: "center", gap: 6 }}>⏳ {step.deadline}</span>}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
