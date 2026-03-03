import type { AnalyzedRoom, FloorPlanAnalysis, Recommendation } from "./types";
import { ROOM_COLORS, ROOM_TYPES } from "./types";

/* ── Insights Panel ── */
export function InsightsPanel({ analysis }: { analysis: FloorPlanAnalysis }) {
  const { score = 0, summary = "", insights = [], flowIssues = [], recommendations = [] } = analysis;
  const scoreColor = score >= 8 ? "#16A34A" : score >= 6 ? "#D97706" : "#DC2626";

  return (
    <div className="text-[13px]">
      <div className="flex gap-3 p-3 bg-muted/30 rounded-[10px] mb-3.5 border border-border/50">
        <div className="text-center min-w-[48px]">
          <div className="text-[32px] font-black leading-none" style={{ color: scoreColor }}>{score.toFixed(1)}</div>
          <div className="text-[10px] text-muted-foreground">/ 10</div>
        </div>
        <div className="flex-1">
          <div className="font-bold text-foreground mb-1">Layout Score</div>
          <div className="h-[5px] bg-muted rounded-sm overflow-hidden mb-1.5">
            <div className="h-full rounded-sm transition-all duration-500" style={{ width: `${(score / 10) * 100}%`, background: scoreColor }} />
          </div>
          <div className="text-muted-foreground leading-snug">{summary}</div>
        </div>
      </div>

      {insights.length > 0 && (
        <div className="mb-3">
          <SectionHead title="Analysis" />
          {insights.map((ins, i) => {
            const isPos = ins.type === "positive";
            const isWrn = ins.type === "warning";
            return (
              <div key={i} className="p-2 px-2.5 mb-1 rounded-lg border text-[12.5px] leading-snug" style={{
                background: isPos ? "#F0FDF4" : isWrn ? "#FFFBEB" : "#FEF2F2",
                borderColor: isPos ? "#BBF7D0" : isWrn ? "#FDE68A" : "#FECACA",
                color: isPos ? "#166534" : isWrn ? "#92400E" : "#991B1B",
              }}>
                {isPos ? "✓" : isWrn ? "⚠" : "✕"} {ins.text}
              </div>
            );
          })}
        </div>
      )}

      {flowIssues.length > 0 && (
        <div className="mb-3">
          <SectionHead title="Flow Issues" />
          {flowIssues.map((f, i) => (
            <div key={i} className="p-2 px-2.5 mb-1 rounded-lg border text-[12.5px] leading-snug" style={{ background: "#FFF7ED", borderColor: "#FED7AA", color: "#9A3412" }}>
              🔄 {f}
            </div>
          ))}
        </div>
      )}

      {recommendations.length > 0 && (
        <div className="mb-3">
          <SectionHead title={`${recommendations.length} Recommendation${recommendations.length !== 1 ? "s" : ""} Available`} />
          {recommendations.map(r => {
            const impactBg = r.impact === "high" ? "#FEE2E2" : r.impact === "medium" ? "#FEF3C7" : "#F0FDF4";
            const impactColor = r.impact === "high" ? "#991B1B" : r.impact === "medium" ? "#92400E" : "#166534";
            const impactBc = r.impact === "high" ? "#FECACA" : r.impact === "medium" ? "#FDE68A" : "#BBF7D0";
            return (
              <div key={r.id} className="p-2 px-2.5 rounded-lg border mb-1" style={{ borderColor: "#BFDBFE", background: "#EFF6FF" }}>
                <div className="font-bold mb-0.5" style={{ color: "#1E40AF" }}>
                  {r.title}
                  <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: impactBg, color: impactColor, border: `1px solid ${impactBc}` }}>
                    {r.impact}
                  </span>
                </div>
                <div className="text-[11.5px] leading-snug" style={{ color: "#3730A3" }}>{r.description}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Legend ── */
export function LegendPanel({ rooms }: { rooms: AnalyzedRoom[] }) {
  const total = rooms.reduce((s, r) => s + (r.estimatedSqFt || 0), 0);
  return (
    <div>
      <SectionHead title={`${rooms.length} Room${rooms.length !== 1 ? "s" : ""}${total > 0 ? ` · ${total.toLocaleString()} ft²` : ""}`} />
      {rooms.map(r => {
        const c = ROOM_COLORS[r.type] || ROOM_COLORS.Unknown;
        return (
          <div key={r.id} className="flex items-center justify-between p-1.5 px-2.5 mb-1 rounded-lg" style={{ background: c.bg, border: `1px solid ${c.border}` }}>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-sm shrink-0" style={{ background: c.dot }} />
              <span className="text-[12.5px] font-semibold" style={{ color: c.text }}>{r.label || r.type}</span>
            </div>
            {r.estimatedSqFt > 0 && <span className="text-[11px] text-muted-foreground">{r.estimatedSqFt} ft²</span>}
          </div>
        );
      })}
    </div>
  );
}

/* ── Edit Panel ── */
export function EditPanel({ room, onUpdate, onDelete, onClose }: {
  room: AnalyzedRoom | null;
  onUpdate: (patch: Partial<AnalyzedRoom>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  if (!room) {
    return (
      <div className="text-muted-foreground text-[13px] text-center py-7 leading-relaxed">
        Click any room overlay to edit it.<br />
        <span className="text-[11px]">Drag to move · drag red corner to resize</span>
      </div>
    );
  }

  const c = ROOM_COLORS[room.type] || ROOM_COLORS.Unknown;

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <span className="font-bold text-[13px]" style={{ color: c.text }}>✎ Editing Room</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-[15px] bg-transparent border-none cursor-pointer">✕</button>
      </div>

      <Field label="Type">
        <select value={room.type} onChange={e => onUpdate({ type: e.target.value, label: e.target.value })} className="w-full p-1.5 px-2 rounded-md border border-border text-[12.5px] bg-background">
          {ROOM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </Field>
      <Field label="Label">
        <input value={room.label || ""} onChange={e => onUpdate({ label: e.target.value })} className="w-full p-1.5 px-2 rounded-md border border-border text-[12.5px] bg-background" placeholder="e.g. Master Bedroom" />
      </Field>
      <Field label="Est. Area (sq ft)">
        <input type="number" value={room.estimatedSqFt || ""} onChange={e => onUpdate({ estimatedSqFt: Number(e.target.value) || 0 })} className="w-full p-1.5 px-2 rounded-md border border-border text-[12.5px] bg-background" min={0} />
      </Field>
      <Field label="Notes">
        <textarea value={room.notes || ""} onChange={e => onUpdate({ notes: e.target.value })} className="w-full p-1.5 px-2 rounded-md border border-border text-[12.5px] bg-background h-[52px] resize-y" placeholder="e.g. South-facing windows…" />
      </Field>
      <button onClick={onDelete} className="mt-2.5 w-full bg-destructive/10 text-destructive border border-destructive/20 rounded-lg p-1.5 text-[12px] cursor-pointer hover:bg-destructive/20 transition-colors">
        🗑 Delete Room
      </button>
    </div>
  );
}

/* ── Recommend Panel ── */
export function RecommendPanel({ recommendations, selected, onToggle, onApply, applying }: {
  recommendations: Recommendation[];
  selected: string[];
  onToggle: (id: string) => void;
  onApply: () => void;
  applying: boolean;
}) {
  if (!recommendations.length) {
    return (
      <div className="text-muted-foreground text-[13px] text-center py-7 leading-relaxed">
        No recommendations available.<br />
        <span className="text-[11px]">Run analysis first to see suggestions.</span>
      </div>
    );
  }

  return (
    <div>
      <SectionHead title="Select recommendations to apply" />
      {recommendations.map(r => {
        const isChecked = selected.includes(r.id);
        const impactColor = r.impact === "high" ? "#DC2626" : r.impact === "medium" ? "#D97706" : "#16A34A";
        return (
          <div key={r.id} onClick={() => onToggle(r.id)} className="p-2.5 px-3 mb-2 rounded-[9px] cursor-pointer transition-all" style={{
            border: `2px solid ${isChecked ? "#3B82F6" : "hsl(var(--border))"}`,
            background: isChecked ? "#EFF6FF" : "hsl(var(--muted) / 0.3)",
          }}>
            <div className="flex items-start gap-2.5">
              <div className="w-[18px] h-[18px] rounded-[5px] shrink-0 mt-0.5 flex items-center justify-center" style={{
                border: `2px solid ${isChecked ? "#3B82F6" : "#CBD5E1"}`,
                background: isChecked ? "#3B82F6" : "#fff",
              }}>
                {isChecked && <span className="text-white text-[11px] font-black">✓</span>}
              </div>
              <div className="flex-1">
                <div className="font-bold text-foreground text-[13px] mb-0.5">
                  {r.title}
                  <span className="ml-1.5 text-[10px] font-bold" style={{ color: impactColor }}>● {r.impact} impact</span>
                </div>
                <div className="text-[11.5px] text-muted-foreground leading-snug">{r.description}</div>
              </div>
            </div>
          </div>
        );
      })}
      <button
        onClick={onApply}
        disabled={selected.length === 0 || applying}
        className="mt-1.5 w-full p-2.5 rounded-[9px] border-none font-bold text-[13px] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          background: (selected.length > 0 && !applying) ? "linear-gradient(135deg,#3B82F6,#2563EB)" : "hsl(var(--muted))",
          color: (selected.length > 0 && !applying) ? "#fff" : "hsl(var(--muted-foreground))",
          cursor: (selected.length > 0 && !applying) ? "pointer" : "not-allowed",
        }}
      >
        {applying ? "⏳ Applying…" : `✨ Apply Recommendation${selected.length !== 1 ? "s" : ""}`}
      </button>
    </div>
  );
}

/* ── DiffBadge ── */
export function DiffBadge({ originalRooms, updatedRooms }: { originalRooms: AnalyzedRoom[]; updatedRooms: AnalyzedRoom[] }) {
  const removed = originalRooms.filter(o => !updatedRooms.find(u => u.id === o.id));
  const added = updatedRooms.filter(u => !originalRooms.find(o => o.id === u.id));
  const changed = updatedRooms.filter(u => {
    const o = originalRooms.find(r => r.id === u.id);
    if (!o) return false;
    return o.label !== u.label || o.type !== u.type || Math.abs((o.width || 0) - (u.width || 0)) > 0.4 || Math.abs((o.height || 0) - (u.height || 0)) > 0.4;
  });

  if (!removed.length && !added.length && !changed.length) return null;

  return (
    <div className="rounded-[9px] p-2.5 px-3.5 mb-3 text-[12px]" style={{ background: "#F0FDF4", border: "1px solid #86EFAC" }}>
      <div className="font-bold mb-1.5" style={{ color: "#166534" }}>✅ Floor Plan Updated</div>
      {changed.map(r => <div key={r.id} style={{ color: "#15803D" }}>✎ {r.label || r.type} — modified</div>)}
      {removed.map(r => <div key={r.id} style={{ color: "#DC2626" }}>✕ {r.label || r.type} — removed</div>)}
      {added.map(r => <div key={r.id} style={{ color: "#2563EB" }}>＋ {r.label || r.type} — added</div>)}
    </div>
  );
}

/* ── Helpers ── */
function SectionHead({ title }: { title: string }) {
  return <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">{title}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-0.5">{label}</div>
      {children}
    </div>
  );
}
