import type { ReactNode } from "react";
import type { Subject } from "../types";

/**
 * formatTranscript — render the cross-check transcript with visual cues.
 *
 *   1. Uncertainty markers become colored pills so teachers can eyeball
 *      the risky spots at a glance:
 *        [?]          → red pill
 *        [gạch]       → orange strikethrough pill
 *        [gạch: xxx]  → orange strikethrough pill (content visible)
 *        [a|b]        → yellow ambiguity pill
 *
 *   2. Figure/diagram wrappers → blue block pill so the teacher spots
 *      non-text elements in the transcript and can jump to "Xem ảnh gốc":
 *        [Hình vẽ: △ABC cân tại A, AB = AC = 5cm, ...]
 *        [Figure: ...]  [Sơ đồ: ...]  [Diagram: ...]
 *        [Bảng: ...]    [Table: ...]  [Mind map: ...]
 *
 *   3. Soft line-breaks after ' ⇒ ' or ' → ' so chains of reasoning
 *      read like real step-by-step work.
 *
 *   4. Math-only (subject === "stem") tokens:
 *        x^2, x^{n+1}   → <sup>
 *        a_1, v_{max}   → <sub>
 *        sqrt(x+1)      → √(x+1)
 */

const FIGURE_LABELS = "Hình vẽ|Figure|Sơ đồ|Diagram|Bảng|Table|Mind map";
const FIGURE_RE = new RegExp(`^\\[(${FIGURE_LABELS}):\\s*([\\s\\S]*)\\]$`, "i");

const TOKEN_RE = new RegExp(
  "(" +
    "\\[\\?\\]|" +
    "\\[gạch(?::\\s*[^\\]]*)?\\]|" +
    `\\[(?:${FIGURE_LABELS}):[^\\]]*\\]|` +
    "\\[[^|\\]\\n]+\\|[^|\\]\\n]+\\]|" +
    "sqrt\\([^)]*\\)|" +
    "\\^\\{[^}]+\\}|\\^[A-Za-z0-9+\\-]|" +
    "_\\{[^}]+\\}|_[A-Za-z0-9+\\-]" +
    ")",
  "g",
);

const pillBase: React.CSSProperties = {
  display: "inline-block",
  padding: "0 6px",
  borderRadius: 5,
  fontSize: "0.86em",
  fontWeight: 600,
  lineHeight: 1.4,
  verticalAlign: "baseline",
};

const S = {
  unclear: { ...pillBase, background: "#fee2e2", color: "#b91c1c" } as React.CSSProperties,
  strike: {
    ...pillBase,
    background: "#fed7aa",
    color: "#9a3412",
    textDecoration: "line-through",
  } as React.CSSProperties,
  ambig: { ...pillBase, background: "#fef3c7", color: "#854d0e" } as React.CSSProperties,
  figure: {
    display: "inline-block",
    padding: "4px 10px",
    borderRadius: 6,
    background: "#dbeafe",
    color: "#1e3a8a",
    border: "1px solid #93c5fd",
    fontSize: "0.9em",
    fontWeight: 500,
    lineHeight: 1.5,
    maxWidth: "100%",
    wordBreak: "break-word",
    verticalAlign: "baseline",
  } as React.CSSProperties,
  figureLabel: {
    display: "inline-block",
    marginRight: 6,
    fontSize: "0.78em",
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    opacity: 0.75,
  } as React.CSSProperties,
  arrow: { color: "#6366f1", fontWeight: 600 } as React.CSSProperties,
};

function renderToken(tok: string, isStem: boolean, key: string): ReactNode {
  if (tok === "[?]") {
    return (
      <span key={key} style={S.unclear} title="Không đọc được">
        ?
      </span>
    );
  }
  if (tok.startsWith("[gạch")) {
    if (tok === "[gạch]") {
      return (
        <span
          key={key}
          style={{ ...S.strike, textDecoration: "none" }}
          title="Nét gạch xóa không đọc được"
        >
          [xóa bỏ]
        </span>
      );
    }
    let inner = tok.slice(1, -1); // drop [ ]
    if (inner.startsWith("gạch:")) inner = inner.slice(5).trim();
    else if (inner.startsWith("gạch")) inner = inner.slice(4).trim();

    return (
      <span key={key} style={S.strike} title="Học sinh gạch bỏ chữ này">
        {inner}
      </span>
    );
  }
  const figMatch = tok.match(FIGURE_RE);
  if (figMatch) {
    return (
      <span
        key={key}
        style={S.figure}
        title="Hình vẽ / sơ đồ — đối chiếu với ảnh gốc để xác nhận"
      >
        <span style={S.figureLabel}>{figMatch[1]}</span>
        {figMatch[2]}
      </span>
    );
  }
  if (/^\[[^|\]\n]+\|[^|\]\n]+\]$/.test(tok)) {
    return (
      <span key={key} style={S.ambig} title="Phân vân giữa hai cách đọc">
        {tok.slice(1, -1)}
      </span>
    );
  }
  // math tokens — passthrough for non-STEM subjects
  if (!isStem) return tok;
  if (tok.startsWith("sqrt(")) return <span key={key}>√{tok.slice(4)}</span>;
  if (tok.startsWith("^{")) return <sup key={key}>{tok.slice(2, -1)}</sup>;
  if (tok.startsWith("^")) return <sup key={key}>{tok.slice(1)}</sup>;
  if (tok.startsWith("_{")) return <sub key={key}>{tok.slice(2, -1)}</sub>;
  if (tok.startsWith("_")) return <sub key={key}>{tok.slice(1)}</sub>;
  return tok;
}

function tokenize(src: string, isStem: boolean, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(src)) !== null) {
    if (m.index > last) nodes.push(src.slice(last, m.index));
    nodes.push(renderToken(m[0], isStem, `${keyBase}-${k++}`));
    last = m.index + m[0].length;
  }
  if (last < src.length) nodes.push(src.slice(last));
  return nodes;
}

export function formatTranscript(
  text: string | null | undefined,
  subject: Subject | string,
): ReactNode {
  if (!text) return text;
  const isStem = subject === "stem";
  const lines = String(text).split("\n");
  const out: ReactNode[] = [];
  lines.forEach((line, li) => {
    // Split on ' ⇒ ', ' → ', or ' ⇔ ' — whitespace-bordered arrows only.
    const segments = line.split(/\s+([⇒→⇔])\s+/);
    segments.forEach((seg, si) => {
      const key = `${li}-${si}`;
      if (seg === "⇒" || seg === "→" || seg === "⇔") {
        out.push("\n  ");
        out.push(
          <span key={`a-${key}`} style={S.arrow}>
            {seg}
          </span>,
        );
        out.push(" ");
      } else {
        out.push(...tokenize(seg, isStem, key));
      }
    });
    if (li < lines.length - 1) out.push("\n");
  });
  return out;
}
