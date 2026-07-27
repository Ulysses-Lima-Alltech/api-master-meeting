"use client";
/** calendarView — a visual monthly calendar for the sidebar showing all meetings organized by date.
 *  Each day with meetings shows a dot; clicking a day expands its meetings list below. Clicking a
 *  meeting opens its tab in the center pane. */
import { useState, useMemo } from "react";
import { useService } from "../platform";
import { LayoutServiceId } from "../workbench/layout";
import type { MeetingMock } from "./meetingModel";
import { Icon } from "../ui-kit";

interface CalendarViewProps {
  meetings: MeetingMock[];
  onOpenMeeting: (m: MeetingMock) => void;
}

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function meetingDate(m: MeetingMock): Date | null {
  const raw = m.start_time || m.scheduled_at;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : null;
}

export function CalendarView({ meetings, onOpenMeeting }: CalendarViewProps) {
  const [viewDate, setViewDate] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  // Map meetings to day keys
  const meetingsByDay = useMemo(() => {
    const map = new Map<string, MeetingMock[]>();
    for (const m of meetings) {
      const d = meetingDate(m);
      if (!d) continue;
      const key = dateKey(d);
      const arr = map.get(key) || [];
      arr.push(m);
      map.set(key, arr);
    }
    return map;
  }, [meetings]);

  // Build calendar grid
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = firstDay.getDay(); // 0=Sun
  const daysInMonth = lastDay.getDate();
  const today = dateKey(new Date());

  const cells: Array<{ day: number; key: string } | null> = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, key: `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}` });
  }

  const prevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const nextMonth = () => setViewDate(new Date(year, month + 1, 1));

  const selectedMeetings = selectedDay ? (meetingsByDay.get(selectedDay) || []) : [];

  return (
    <div style={{ padding: "4px 0" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 4px 8px" }}>
        <button onClick={prevMonth} style={{ background: "none", border: "none", color: "var(--t2)", cursor: "pointer", fontSize: 14, padding: "2px 6px", borderRadius: 4 }}
          onMouseEnter={e => e.currentTarget.style.background = "var(--panel2)"} onMouseLeave={e => e.currentTarget.style.background = "none"}>◀</button>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--t1)" }}>{MONTHS[month]} {year}</span>
        <button onClick={nextMonth} style={{ background: "none", border: "none", color: "var(--t2)", cursor: "pointer", fontSize: 14, padding: "2px 6px", borderRadius: 4 }}
          onMouseEnter={e => e.currentTarget.style.background = "var(--panel2)"} onMouseLeave={e => e.currentTarget.style.background = "none"}>▶</button>
      </div>

      {/* Weekday headers */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 0 }}>
        {WEEKDAYS.map(w => (
          <div key={w} style={{ textAlign: "center", fontSize: 9.5, color: "var(--t3)", fontWeight: 700, padding: "2px 0", textTransform: "uppercase", letterSpacing: ".05em" }}>{w}</div>
        ))}
      </div>

      {/* Day cells */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1 }}>
        {cells.map((cell, i) => {
          if (!cell) return <div key={`empty-${i}`} />;
          const hasMeetings = meetingsByDay.has(cell.key);
          const isToday = cell.key === today;
          const isSelected = cell.key === selectedDay;
          return (
            <div key={cell.key}
              onClick={() => setSelectedDay(isSelected ? null : cell.key)}
              style={{
                textAlign: "center", padding: "4px 0", cursor: hasMeetings ? "pointer" : "default",
                borderRadius: 6, position: "relative",
                background: isSelected ? "var(--accent)" : isToday ? "var(--panel2)" : "transparent",
                color: isSelected ? "var(--bg)" : isToday ? "var(--t1)" : hasMeetings ? "var(--t1)" : "var(--t3)",
                fontSize: 11, fontWeight: isToday || isSelected ? 700 : 400,
                transition: "background 0.15s",
              }}
              onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "var(--panel2)"; }}
              onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = isToday ? "var(--panel2)" : "transparent"; }}
            >
              {cell.day}
              {hasMeetings && (
                <div style={{
                  position: "absolute", bottom: 1, left: "50%", transform: "translateX(-50%)",
                  width: 4, height: 4, borderRadius: "50%",
                  background: isSelected ? "var(--bg)" : "var(--accent)",
                }} />
              )}
            </div>
          );
        })}
      </div>

      {/* Expanded day meetings */}
      {selectedDay && (
        <div style={{ marginTop: 8, padding: "0 2px" }}>
          <div style={{ fontSize: 10, color: "var(--t3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", padding: "4px 4px 6px" }}>
            {selectedMeetings.length > 0
              ? `${selectedMeetings.length} reunião(ões) em ${selectedDay.split("-")[2]}/${selectedDay.split("-")[1]}`
              : `Nenhuma reunião em ${selectedDay.split("-")[2]}/${selectedDay.split("-")[1]}`}
          </div>
          {selectedMeetings.map(m => (
            <div key={m.id}
              onClick={() => onOpenMeeting(m)}
              style={{
                padding: "6px 8px", borderRadius: 6, cursor: "pointer", marginBottom: 2,
                display: "flex", alignItems: "center", gap: 8, fontSize: 11.5,
              }}
              onMouseEnter={e => e.currentTarget.style.background = "var(--panel2)"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <Icon name="cal" size={12} style={{ color: "var(--accent)" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: "var(--t1)", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.title}</div>
                <div style={{ fontSize: 10, color: "var(--t3)", marginTop: 1 }}>
                  {m.start_time ? new Date(m.start_time).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : m.when}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
