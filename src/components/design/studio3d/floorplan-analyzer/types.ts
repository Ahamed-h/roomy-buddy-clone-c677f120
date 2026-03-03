export interface AnalyzedRoom {
  id: string;
  type: string;
  label: string;
  estimatedSqFt: number;
  x: number;
  y: number;
  width: number;
  height: number;
  notes?: string;
}

export interface Insight {
  type: "positive" | "warning" | "negative";
  text: string;
}

export interface RoomChange {
  id: string;
  width?: number;
  height?: number;
  label?: string;
  type?: string;
  notes?: string;
  remove?: boolean;
}

export interface Recommendation {
  id: string;
  title: string;
  description: string;
  impact: "high" | "medium" | "low";
  roomChanges: RoomChange[];
}

export interface FloorPlanAnalysis {
  rooms: AnalyzedRoom[];
  totalArea: number;
  score: number;
  summary: string;
  insights: Insight[];
  flowIssues: string[];
  recommendations: Recommendation[];
}

export const ROOM_COLORS: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  "Living Room": { bg: "#DBEAFE", border: "#3B82F6", text: "#1D4ED8", dot: "#3B82F6" },
  "Bedroom":     { bg: "#FEF3C7", border: "#F59E0B", text: "#92400E", dot: "#F59E0B" },
  "Kitchen":     { bg: "#D1FAE5", border: "#10B981", text: "#065F46", dot: "#10B981" },
  "Bathroom":    { bg: "#EDE9FE", border: "#8B5CF6", text: "#4C1D95", dot: "#8B5CF6" },
  "Dining Room": { bg: "#FEE2E2", border: "#EF4444", text: "#7F1D1D", dot: "#EF4444" },
  "Office":      { bg: "#CFFAFE", border: "#06B6D4", text: "#164E63", dot: "#06B6D4" },
  "Hallway":     { bg: "#F1F5F9", border: "#94A3B8", text: "#334155", dot: "#94A3B8" },
  "Garage":      { bg: "#FEF9C3", border: "#CA8A04", text: "#713F12", dot: "#CA8A04" },
  "Laundry":     { bg: "#E0F2FE", border: "#0284C7", text: "#0C4A6E", dot: "#0284C7" },
  "Storage":     { bg: "#F0FDF4", border: "#16A34A", text: "#14532D", dot: "#16A34A" },
  "Balcony":     { bg: "#FDF4FF", border: "#A855F7", text: "#581C87", dot: "#A855F7" },
  "Unknown":     { bg: "#F8FAFC", border: "#CBD5E1", text: "#475569", dot: "#CBD5E1" },
};

export const ROOM_TYPES = Object.keys(ROOM_COLORS);
