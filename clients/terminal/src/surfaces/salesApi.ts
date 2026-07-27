import { getJson } from "./apiClient";

export interface SalesAnalysis {
  id: number;
  meeting_id: number;
  platform: string;
  summary: string | null;
  next_steps: Array<{
    action: string;
    assignee: string;
    deadline: string;
  }>;
  funnel_stage: string | null;
  objections: Array<{
    category: string;
    description: string;
  }>;
  risk_flag: string | null; // "High", "Medium", "Low"
  temperature_score?: number; // 0-100 indicating deal temperature
  created_at: string | null;
}

export interface SalesGeneralKPIs {
  sdr: {
    meetings_today: number;
    objections_handled: number;
    prospecting_volume: number;
  };
  closer: {
    win_rate: number;
    deal_velocity_days: number;
    total_negotiation: number;
  };
  manager: {
    total_pipeline_value: number;
    high_risk_deals: number;
    team_performance_score: number;
  };
  funnel: Record<string, number>;
  high_risk_list: SalesAnalysis[];
  action_items_feed: SalesAnalysis[];
  objections_handling?: {
    total_raised: number;
    resolved: number;
    top_objections: Array<{ category: string; count: number; resolved: number }>;
  };
  call_quality?: {
    avg_talk_listen_ratio: number;
    avg_sentiment: number;
    sentiment_trend: "up" | "down" | "flat";
  };
}

// Keep legacy fetch for any backwards compat, but SWR will mostly use the endpoints directly via generic fetcher
export async function fetchSalesAnalyses(): Promise<SalesAnalysis[]> {
  return await getJson<SalesAnalysis[]>("/api/sales/analysis");
}

export const fetcher = (url: string) => getJson<any>(url);

export async function postLiveAnalysis(meeting_id: number | string, transcript: string): Promise<SalesAnalysis> {
  return await getJson<SalesAnalysis>("/api/sales/analysis/live", {
    method: "POST",
    body: JSON.stringify({ meeting_id, transcript })
  });
}
