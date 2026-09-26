/**
 * fields.tsx — small shared form widgets: tooltip, money field, toggle, select.
 */
import { useState } from "react";

export function Tip({ text, children }: { text: string; children?: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const handleMouseMove = (e: React.MouseEvent<HTMLSpanElement>) => {
    setPos({ x: e.clientX, y: e.clientY });
  };
  return (
    <span
      style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onMouseMove={handleMouseMove}
    >
      {children ?? (
        <span style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 14, height: 14, borderRadius: "50%",
          background: "#e2e8f0", color: "#64748b",
          fontSize: 9, fontWeight: 800, cursor: "help",
          flexShrink: 0, marginLeft: 4, lineHeight: 1,
          border: "1px solid #cbd5e1",
        }}>?</span>
      )}
      {visible && (
        <div style={{
          position: "fixed",
          left: Math.min(pos.x + 12, window.innerWidth - 280),
          top: pos.y - 8,
          transform: "translateY(-100%)",
          zIndex: 9999,
          background: "#1e293b",
          color: "#f1f5f9",
          borderRadius: 8,
          padding: "10px 13px",
          fontSize: 12,
          lineHeight: 1.55,
          maxWidth: 260,
          boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
          pointerEvents: "none",
          whiteSpace: "pre-line",
        }}>
          {text}
          <div style={{
            position: "absolute", bottom: -5, left: 16,
            width: 10, height: 10,
            background: "#1e293b",
            transform: "rotate(45deg)",
            borderRadius: 2,
          }} />
        </div>
      )}
    </span>
  );
}

export function NumField({
  label,
  value,
  onChange,
  hint,
  step = 1000,
  tooltip,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
  step?: number;
  tooltip?: string;
}) {
  return (
    <div style={{ marginBottom: 11 }}>
      <label style={{
        display: "block",
        fontSize: 11,
        color: "#64748b",
        marginBottom: 3,
        fontWeight: 600,
        textTransform: "uppercase" as const,
        letterSpacing: "0.04em",
      }}>
        {label}{tooltip && <Tip text={tooltip} />}
      </label>
      <div style={{ display: "flex" }}>
        <span
          style={{
            background: "#f3f4f6",
            border: "1px solid #d1d5db",
            borderRight: "none",
            padding: "4px 7px",
            borderRadius: "5px 0 0 5px",
            fontSize: 12,
            color: "#9ca3af",
          }}
        >
          £
        </span>
        <input
          type="number"
          value={value}
          step={step}
          min={0}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{
            flex: 1,
            padding: "4px 7px",
            border: "1px solid #d1d5db",
            borderRadius: "0 5px 5px 0",
            fontSize: 12,
            outline: "none",
            minWidth: 0,
          }}
        />
      </div>
      {hint && (
        <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>{hint}</div>
      )}
    </div>
  );
}

export function Toggle({
  label,
  value,
  onChange,
  tooltip,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  tooltip?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 9,
        cursor: "pointer",
      }}
      onClick={() => onChange(!value)}
    >
      <div
        style={{
          width: 32,
          height: 18,
          borderRadius: 9,
          background: value ? "#4f46e5" : "#d1d5db",
          position: "relative",
          transition: "background 0.18s",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: value ? 14 : 2,
            width: 14,
            height: 14,
            borderRadius: 7,
            background: "#fff",
            transition: "left 0.18s",
          }}
        />
      </div>
      <span style={{ fontSize: 12, color: "#374151", userSelect: "none" }}>{label}{tooltip && <Tip text={tooltip} />}</span>
    </div>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  tooltip,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  tooltip?: string;
}) {
  return (
    <div style={{ marginBottom: 11 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#64748b", marginBottom: 3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label} {tooltip && <Tip text={tooltip} />}
      </label>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: "100%", padding: "4px 7px", border: "1px solid #d1d5db", borderRadius: 5, fontSize: 12 }}
      >
        {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
    </div>
  );
}
