"use client";
import { registerTab, registerList } from "../contributions";
import { useService } from "../platform";
import { LayoutServiceId } from "../workbench/layout";
import { TrendingUp } from "lucide-react";
import { useLiveMeetings } from "./liveMeetings";
import { SalesGeneralDashboard } from "./salesGeneral";
import { SalesLiveDashboard } from "./salesLive";

export function SalesDashboard() {
  const meetings = useLiveMeetings();
  const activeMeeting = meetings.find(m => m.status === "live");

  if (activeMeeting) {
    return <SalesLiveDashboard meeting={activeMeeting} />;
  }

  return <SalesGeneralDashboard />;
}

registerTab("sales", SalesDashboard);

function SalesSidebar() {
  const layout = useService(LayoutServiceId);
  return (
    <div style={{ padding: "8px" }}>
      <div 
        onClick={() => layout.openTab({ id: "sales:dashboard", kind: "sales", title: "Sales Intelligence" })}
        style={{ padding: "8px 12px", cursor: "pointer", borderRadius: 6, display: "flex", alignItems: "center", gap: 8, color: "#e4e4e7" }}
        onMouseEnter={e => e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.1)"}
        onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}
      >
        <TrendingUp size={16} color="#818cf8" />
        <span style={{ fontSize: 13, fontWeight: 500 }}>Open Dashboard</span>
      </div>
    </div>
  );
}

registerList({ id: "sales", label: "Sales Intelligence", icon: "spark", order: 25, component: SalesSidebar });
