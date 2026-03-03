import { useRef, useCallback } from "react";
import type { AnalyzedRoom } from "./types";
import { ROOM_COLORS } from "./types";

interface Props {
  imgUrl: string | null;
  rooms: AnalyzedRoom[];
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onUpdate?: (id: string, patch: Partial<AnalyzedRoom>) => void;
  dims: { w: number; h: number };
  readOnly?: boolean;
  label?: string;
}

export function FloorPlanCanvas({ imgUrl, rooms, selectedId, onSelect, onUpdate, dims, readOnly = false, label }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; ox: number; oy: number } | null>(null);
  const resizeRef = useRef<{ id: string; sx: number; sy: number; origPx: { x: number; y: number; w: number; h: number } } | null>(null);

  const dimsRef = useRef(dims);
  dimsRef.current = dims;

  const toPx = useCallback((r: AnalyzedRoom) => {
    const { w, h } = dimsRef.current;
    return { x: (r.x / 100) * w, y: (r.y / 100) * h, w: (r.width / 100) * w, h: (r.height / 100) * h };
  }, []);

  const evXY = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    const touch = "touches" in e ? e.touches?.[0] : null;
    const cx = touch ? touch.clientX : (e as React.MouseEvent).clientX;
    const cy = touch ? touch.clientY : (e as React.MouseEvent).clientY;
    const { w, h } = dimsRef.current;
    return { x: ((cx - rect.left) / rect.width) * w, y: ((cy - rect.top) / rect.height) * h };
  }, []);

  const roomsRef = useRef(rooms);
  roomsRef.current = rooms;

  const startDrag = useCallback((e: React.MouseEvent | React.TouchEvent, room: AnalyzedRoom) => {
    if (readOnly) return;
    e.stopPropagation();
    const p = evXY(e);
    const px = toPx(room);
    dragRef.current = { id: room.id, ox: p.x - px.x, oy: p.y - px.y };
  }, [readOnly, evXY, toPx]);

  const startResize = useCallback((e: React.MouseEvent | React.TouchEvent, room: AnalyzedRoom) => {
    if (readOnly) return;
    e.stopPropagation();
    const p = evXY(e);
    const px = toPx(room);
    resizeRef.current = { id: room.id, sx: p.x, sy: p.y, origPx: px };
  }, [readOnly, evXY, toPx]);

  const onMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!dragRef.current && !resizeRef.current) return;
    const p = evXY(e);
    const { w, h } = dimsRef.current;

    if (dragRef.current) {
      const room = roomsRef.current.find(r => r.id === dragRef.current!.id);
      if (!room) return;
      const nx = p.x - dragRef.current.ox;
      const ny = p.y - dragRef.current.oy;
      onUpdate?.(dragRef.current.id, {
        x: Math.max(0, Math.min(96, (nx / w) * 100)),
        y: Math.max(0, Math.min(96, (ny / h) * 100)),
      });
    }

    if (resizeRef.current) {
      const { sx, sy, origPx } = resizeRef.current;
      const nw = Math.max(30, origPx.w + (p.x - sx));
      const nh = Math.max(20, origPx.h + (p.y - sy));
      onUpdate?.(resizeRef.current.id, {
        width: Math.max(3, (nw / w) * 100),
        height: Math.max(2, (nh / h) * 100),
      });
    }
  }, [evXY, onUpdate]);

  const onUp = useCallback(() => {
    dragRef.current = null;
    resizeRef.current = null;
  }, []);

  return (
    <div className="relative">
      {label && (
        <div className="absolute top-2 left-2 z-10 bg-black/55 text-white text-[11px] font-bold px-2.5 py-0.5 rounded-full tracking-wide backdrop-blur-sm pointer-events-none">
          {label}
        </div>
      )}
      <div
        ref={containerRef}
        className="relative select-none rounded-[10px] overflow-hidden shadow-lg"
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={onUp}
        onTouchMove={onMove}
        onTouchEnd={onUp}
        onClick={() => { if (!readOnly && onSelect) onSelect(null); }}
      >
        {imgUrl && (
          <img src={imgUrl} alt="floor plan" draggable={false} className="w-full block" />
        )}

        <svg
          viewBox={`0 0 ${dims.w} ${dims.h}`}
          className="absolute inset-0 w-full h-full"
        >
          {rooms.map((room) => {
            const c = ROOM_COLORS[room.type] || ROOM_COLORS.Unknown;
            const isSel = !readOnly && room.id === selectedId;
            const p = toPx(room);
            const fs = Math.min(15, Math.max(8, p.w / 10));

            return (
              <g key={room.id}>
                <rect
                  x={p.x} y={p.y} width={p.w} height={p.h}
                  fill={c.bg}
                  fillOpacity={isSel ? 0.88 : 0.65}
                  stroke={isSel ? "#EF4444" : c.border}
                  strokeWidth={isSel ? 2.5 : 1.6}
                  rx={4}
                  style={{ cursor: readOnly ? "default" : "grab" }}
                  onClick={(e) => { if (!readOnly) { e.stopPropagation(); onSelect?.(room.id); } }}
                  onMouseDown={(e) => { if (!readOnly) { onSelect?.(room.id); startDrag(e, room); } }}
                  onTouchStart={(e) => { if (!readOnly) { onSelect?.(room.id); startDrag(e, room); } }}
                />
                <text
                  x={p.x + p.w / 2} y={p.y + p.h / 2 - (room.estimatedSqFt ? fs * 0.7 : 0)}
                  textAnchor="middle" dominantBaseline="middle"
                  fill={c.text} fontSize={fs} fontWeight={700}
                  fontFamily="Inter,sans-serif" style={{ pointerEvents: "none" }}
                >
                  {room.label || room.type}
                </text>
                {room.estimatedSqFt > 0 && (
                  <text
                    x={p.x + p.w / 2} y={p.y + p.h / 2 + fs * 0.9}
                    textAnchor="middle" dominantBaseline="middle"
                    fill={c.text} fontSize={fs * 0.75} opacity={0.75}
                    fontFamily="Inter,sans-serif" style={{ pointerEvents: "none" }}
                  >
                    {room.estimatedSqFt} ft²
                  </text>
                )}
                {isSel && (
                  <rect
                    x={p.x + p.w - 14} y={p.y + p.h - 14}
                    width={14} height={14}
                    fill="#EF4444" rx={3}
                    style={{ cursor: "se-resize" }}
                    onMouseDown={(e) => startResize(e, room)}
                    onTouchStart={(e) => startResize(e, room)}
                  />
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
