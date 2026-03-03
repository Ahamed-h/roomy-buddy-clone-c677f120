import { useState, useRef, useCallback, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { FloorPlanCanvas } from "./FloorPlanCanvas";
import { InsightsPanel, LegendPanel, EditPanel, RecommendPanel, DiffBadge } from "./SidePanels";
import { analyzeFloorplan, applyRecommendations } from "./analyzeFloorplan";
import type { AnalyzedRoom, FloorPlanAnalysis } from "./types";
import { ROOM_COLORS } from "./types";

type Step = "upload" | "analyzing" | "done" | "applying" | "applied";

export default function FloorPlanAnalyzer() {
  const { toast } = useToast();

  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });

  const [originalRooms, setOriginalRooms] = useState<AnalyzedRoom[]>([]);
  const [rooms, setRooms] = useState<AnalyzedRoom[]>([]);
  const [updatedRooms, setUpdatedRooms] = useState<AnalyzedRoom[] | null>(null);

  const [analysis, setAnalysis] = useState<FloorPlanAnalysis | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRecs, setSelectedRecs] = useState<string[]>([]);

  const [step, setStep] = useState<Step>("upload");
  const [activeTab, setActiveTab] = useState("insights");
  const [error, setError] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);

  const selectedRoom = useMemo(
    () => rooms.find(r => r.id === selectedId) || null,
    [rooms, selectedId]
  );

  const hasResults = step === "done" || step === "applied" || step === "applying";

  const loadFile = useCallback((file: File | undefined) => {
    if (!file?.type.startsWith("image/")) {
      setError("Please upload an image file (PNG, JPG, WEBP).");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const url = e.target?.result as string;
      setImgUrl(url);
      setRooms([]);
      setOriginalRooms([]);
      setUpdatedRooms(null);
      setAnalysis(null);
      setSelectedId(null);
      setSelectedRecs([]);
      setError(null);
      setStep("upload");
      const img = new Image();
      img.onload = () => setDims({ w: img.naturalWidth, h: img.naturalHeight });
      img.src = url;
    };
    reader.readAsDataURL(file);
  }, []);

  const runAnalysis = useCallback(async () => {
    if (!imgUrl) return;
    setStep("analyzing");
    setError(null);
    try {
      const result = await analyzeFloorplan(imgUrl);
      const withIds = (result.rooms || []).map((r, i) => ({ ...r, id: r.id || `r${i}` }));
      setOriginalRooms(withIds);
      setRooms(withIds.map(r => ({ ...r })));
      setAnalysis(result);
      setUpdatedRooms(null);
      setSelectedRecs([]);
      setActiveTab("insights");
      setStep("done");
      toast({ title: "Analysis Complete", description: `Detected ${withIds.length} rooms. Score: ${result.score}/10` });
    } catch (e: any) {
      setError("Analysis failed: " + e.message);
      setStep("upload");
      toast({ title: "Analysis Failed", description: e.message, variant: "destructive" });
    }
  }, [imgUrl, toast]);

  const updateRoom = useCallback((id: string, patch: Partial<AnalyzedRoom>) => {
    setRooms(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  }, []);

  const deleteRoom = useCallback((id: string) => {
    setRooms(prev => prev.filter(r => r.id !== id));
    setSelectedId(null);
  }, []);

  const addRoom = useCallback(() => {
    const newRoom: AnalyzedRoom = {
      id: `r_new_${Date.now()}`, type: "Unknown", label: "New Room",
      estimatedSqFt: 0, x: 10, y: 10, width: 20, height: 15,
    };
    setRooms(prev => [...prev, newRoom]);
    setSelectedId(newRoom.id);
    setActiveTab("edit");
  }, []);

  const toggleRec = useCallback((id: string) => {
    setSelectedRecs(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }, []);

  const applyRecs = useCallback(async () => {
    if (!analysis) return;
    setStep("applying");
    try {
      const result = applyRecommendations(rooms, analysis.recommendations || [], selectedRecs);
      setUpdatedRooms(result);
      setStep("applied");
    } catch (e: any) {
      setError("Failed to apply: " + e.message);
      setStep("done");
    }
  }, [rooms, analysis, selectedRecs]);

  const acceptChanges = useCallback(() => {
    if (updatedRooms) setRooms(updatedRooms);
    setUpdatedRooms(null);
    setSelectedRecs([]);
    setStep("done");
  }, [updatedRooms]);

  const discardChanges = useCallback(() => {
    setUpdatedRooms(null);
    setStep("done");
  }, []);

  const displayRooms = (step === "applied" && updatedRooms) ? updatedRooms : rooms;

  const tabs = [
    { id: "insights", label: "📊 Insights" },
    { id: "legend", label: "🗂 Rooms" },
    { id: "edit", label: "✎ Edit" },
    { id: "recommend", label: "✨ Apply" },
  ];

  return (
    <div className="min-h-[600px] rounded-xl overflow-hidden" style={{ background: "linear-gradient(180deg, #0a0f2a 0%, #1a1f3a 100%)" }}>
      {/* Scanning animation */}
      <style>{`@keyframes scanBar { 0% { width: 0%; margin-left: 0% } 50% { width: 55%; margin-left: 22% } 100% { width: 0%; margin-left: 100% } }`}</style>

      {/* Header */}
      <div className="text-center py-5">
        <div className="text-xl font-black text-white/90 tracking-tight">🏗 Floor Plan Analyzer & Editor</div>
        <div className="text-[12.5px] text-white/40 mt-1">Upload · AI analyses rooms · Edit manually · Apply AI recommendations</div>
      </div>

      {/* Upload zone */}
      {!imgUrl && (
        <div
          className="max-w-[540px] mx-auto border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all"
          style={{
            borderColor: isDraggingFile ? "#60A5FA" : "#334155",
            background: isDraggingFile ? "rgba(96,165,250,0.07)" : "rgba(255,255,255,0.03)",
          }}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setIsDraggingFile(true); }}
          onDragLeave={() => setIsDraggingFile(false)}
          onDrop={(e) => { e.preventDefault(); setIsDraggingFile(false); loadFile(e.dataTransfer.files[0]); }}
        >
          <div className="text-[50px] mb-3">📐</div>
          <div className="text-white/90 font-bold text-base mb-1.5">Drop your floor plan here</div>
          <div className="text-white/40 text-[13px]">PNG, JPG or WEBP</div>
          <div className="mt-4 inline-block bg-blue-500/10 border border-blue-400/25 text-blue-300 rounded-lg py-2 px-5 text-[13px] font-semibold">
            Browse Files
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => loadFile(e.target.files?.[0])} />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="max-w-[640px] mx-auto mt-3 p-2.5 px-3.5 rounded-lg text-[13px]" style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#991B1B" }}>
          ⚠ {error}
        </div>
      )}

      {/* Analyzing spinner */}
      {step === "analyzing" && (
        <div className="text-center mt-8 text-white/50">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-blue-400" />
          <div className="text-sm">🤖 AI is analysing your floor plan…</div>
          <div className="h-1 max-w-xs mx-auto mt-3 bg-white/10 rounded overflow-hidden">
            <div className="h-full rounded" style={{ background: "linear-gradient(90deg,#3B82F6,#60A5FA)", animation: "scanBar 1.4s ease-in-out infinite" }} />
          </div>
        </div>
      )}

      {/* Main content */}
      {imgUrl && step !== "analyzing" && (
        <div className="max-w-[1300px] mx-auto px-5 pb-6">
          {/* Analyse CTA */}
          {!hasResults && (
            <div className="text-center mt-4 mb-5">
              <img src={imgUrl} alt="preview" className="max-w-full max-h-[300px] rounded-[10px] object-contain mb-4 mx-auto" style={{ boxShadow: "0 4px 20px rgba(0,0,0,0.45)" }} />
              <button onClick={runAnalysis} className="text-white border-none rounded-[10px] py-3 px-9 text-[15px] font-bold cursor-pointer" style={{ background: "linear-gradient(135deg,#2563EB,#3B82F6)", boxShadow: "0 4px 16px rgba(59,130,246,0.4)" }}>
                🔍 Analyse Floor Plan with AI
              </button>
            </div>
          )}

          {/* Toolbar */}
          {hasResults && (
            <div className="flex gap-2 mb-4 flex-wrap items-center">
              <ActionBtn color="#334155" onClick={() => { setImgUrl(null); setStep("upload"); }}>↩ New Plan</ActionBtn>
              <ActionBtn color="#334155" onClick={addRoom}>＋ Add Room</ActionBtn>
              <ActionBtn color="#1D4ED8" onClick={runAnalysis}>🔄 Re-analyse</ActionBtn>
              <div className="ml-auto text-[11.5px] text-white/30">Drag rooms to reposition · drag red corner to resize</div>
            </div>
          )}

          {/* 3-column layout */}
          {hasResults && (
            <div className="flex gap-4 items-start flex-wrap">
              {/* Col 1: Original AI */}
              <div className="flex-1 min-w-[260px]">
                <div className="text-[11px] font-bold text-white/40 uppercase tracking-wider mb-2">📐 Original — AI Analysed</div>
                <FloorPlanCanvas imgUrl={imgUrl} rooms={originalRooms} dims={dims} readOnly label="AI Analysis" onSelect={() => {}} onUpdate={() => {}} />
                <div className="mt-2.5 flex flex-wrap gap-1">
                  {originalRooms.map(r => {
                    const c = ROOM_COLORS[r.type] || ROOM_COLORS.Unknown;
                    return (
                      <div key={r.id} className="flex items-center gap-1 py-0.5 px-2 rounded-full text-[11px] font-semibold" style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.text }}>
                        <div className="w-1.5 h-1.5 rounded-full" style={{ background: c.dot }} />
                        {r.label || r.type}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Col 2: Editable */}
              <div className="flex-1 min-w-[260px]">
                <div className="text-[11px] font-bold text-white/40 uppercase tracking-wider mb-2">
                  {step === "applied" ? "✨ Updated Floor Plan" : "✏️ Editable Floor Plan"}
                </div>
                {step === "applied" && updatedRooms && <DiffBadge originalRooms={originalRooms} updatedRooms={updatedRooms} />}
                <FloorPlanCanvas
                  imgUrl={imgUrl}
                  rooms={displayRooms}
                  selectedId={selectedId}
                  onSelect={(id) => { setSelectedId(id); if (id) setActiveTab("edit"); }}
                  onUpdate={updateRoom}
                  dims={dims}
                  label={step === "applied" ? "After Recommendations" : "Your Edit"}
                />
                {step === "applied" && updatedRooms && (
                  <div className="flex gap-2 mt-2.5">
                    <ActionBtn color="#15803D" onClick={acceptChanges}>✓ Accept Changes</ActionBtn>
                    <ActionBtn color="#7C3AED" onClick={discardChanges}>✕ Discard</ActionBtn>
                  </div>
                )}
              </div>

              {/* Col 3: Side panel */}
              <div className="w-[290px] min-w-[240px] shrink-0">
                <div className="flex gap-0.5 mb-2.5 bg-white/5 rounded-[10px] p-0.5">
                  {tabs.map(({ id, label }) => (
                    <button key={id} onClick={() => setActiveTab(id)} className="flex-1 py-1.5 px-0.5 rounded-lg border-none cursor-pointer text-[11px] font-medium transition-all" style={{
                      background: activeTab === id ? "#fff" : "transparent",
                      color: activeTab === id ? "#1E40AF" : "#64748B",
                      fontWeight: activeTab === id ? 700 : 500,
                    }}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="bg-white rounded-xl p-4 shadow-2xl max-h-[72vh] overflow-y-auto">
                  {activeTab === "insights" && analysis && <InsightsPanel analysis={analysis} />}
                  {activeTab === "legend" && <LegendPanel rooms={displayRooms} />}
                  {activeTab === "edit" && (
                    <EditPanel
                      room={selectedRoom}
                      onUpdate={(patch) => selectedId && updateRoom(selectedId, patch)}
                      onDelete={() => selectedId && deleteRoom(selectedId)}
                      onClose={() => setSelectedId(null)}
                    />
                  )}
                  {activeTab === "recommend" && (
                    <RecommendPanel
                      recommendations={analysis?.recommendations || []}
                      selected={selectedRecs}
                      onToggle={toggleRec}
                      onApply={applyRecs}
                      applying={step === "applying"}
                    />
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ActionBtn({ children, color, onClick, disabled = false }: { children: React.ReactNode; color: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="text-white border-none rounded-lg py-2 px-3.5 text-[12.5px] font-semibold cursor-pointer transition-opacity disabled:opacity-60 disabled:cursor-not-allowed" style={{ background: color }}>
      {children}
    </button>
  );
}
