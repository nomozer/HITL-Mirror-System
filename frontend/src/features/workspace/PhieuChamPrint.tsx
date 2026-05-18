// ---------------------------------------------------------------------------
// PhieuChamPrint — formal paper grading slip (phiếu chấm điểm).
//
// Separate component from ResultCard because the on-screen card and the
// printed slip have different conventions:
//   • On-screen: at-a-glance, branded (italic red 8.5, soft shadows).
//   • Printed:   document layout — Times serif, black borders, signature
//                blocks, total written out in chữ, blanks for handwriting
//                school/date if the teacher prefers to fill them by hand.
//
// Visibility is controlled by the parent (ResultCard) via the `.rc-print-only`
// class — this component renders unconditionally and assumes the parent's
// @media print rules show/hide it appropriately.
// ---------------------------------------------------------------------------

export interface PhieuChamPrintRow {
  num: number;
  label: string;
  prompt: string;
  maxPoints: number;
  aiScore: number;
  teacherScore: number;
  goodPoints: string;
  improvements: string;
}

export interface PhieuChamPrintProps {
  studentName: string;
  studentClass: string;
  studentRoll: string;
  /** Human-readable subject label, e.g. "Toán · Lớp 10". Empty string ⇒
   *  renders a blank line for handwriting. */
  subjectLabel: string;
  maxTotal: number;
  overall: number | string;
  rows: PhieuChamPrintRow[];
  /** ISO timestamp of finalization. Falls back to today when missing. */
  finalizedAt?: string | null;
}

const DIGITS_VI = [
  "không",
  "một",
  "hai",
  "ba",
  "bốn",
  "năm",
  "sáu",
  "bảy",
  "tám",
  "chín",
  "mười",
];

/** Vietnamese number-in-words for grades on the 0–10 scale with one
 *  decimal place. 8.5 → "tám phẩy năm", 10 → "mười", 7.0 → "bảy". */
function gradeInWords(n: number): string {
  if (!isFinite(n)) return "—";
  const rounded = Math.round(n * 10) / 10;
  const intPart = Math.trunc(rounded);
  const decPart = Math.round((rounded - intPart) * 10);
  const intWord = DIGITS_VI[intPart] ?? String(intPart);
  if (decPart === 0) return intWord;
  return `${intWord} phẩy ${DIGITS_VI[decPart] ?? String(decPart)}`;
}

function formatDateVi(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : new Date();
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Inline blank line for fields we can't fill (school name, etc.). The
 *  underscore baseline is what teachers expect on Vietnamese forms. */
function BlankLine({ width = 220 }: { width?: number }) {
  return (
    <span
      style={{
        display: "inline-block",
        width,
        borderBottom: "1px solid #000",
        verticalAlign: "bottom",
        marginLeft: 6,
      }}
    />
  );
}

export function PhieuChamPrint({
  studentName,
  studentClass,
  studentRoll,
  subjectLabel,
  maxTotal,
  overall,
  rows,
  finalizedAt,
}: PhieuChamPrintProps) {
  const overallNum =
    typeof overall === "number"
      ? overall
      : typeof overall === "string" && overall !== ""
        ? Number(overall)
        : NaN;
  const overallText = isFinite(overallNum) ? overallNum.toFixed(2) : "—";
  const overallWords = isFinite(overallNum) ? gradeInWords(overallNum) : "—";
  const dateStr = formatDateVi(finalizedAt);

  const cellBase: React.CSSProperties = {
    border: "1px solid #000",
    padding: "6px 8px",
    verticalAlign: "top",
    fontSize: 12,
    lineHeight: 1.4,
  };

  const headCell: React.CSSProperties = {
    ...cellBase,
    fontWeight: 700,
    textAlign: "center",
    background: "#f0f0f0",
    fontSize: 11,
    letterSpacing: "0.02em",
  };

  return (
    <div
      className="phieu-cham-root"
      style={{
        // Times-style serif is the de facto formal-document font in VN
        // schools. Keep colours pure black so any printer renders cleanly.
        fontFamily: '"Times New Roman", Times, serif',
        color: "#000",
        background: "#fff",
        fontSize: 12,
        lineHeight: 1.5,
      }}
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          marginBottom: 14,
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ fontWeight: 700, textTransform: "uppercase" }}>
            Trường:
            <BlankLine width={180} />
          </div>
          <div style={{ marginTop: 4, fontStyle: "italic" }}>
            ─────────────
          </div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontWeight: 700, textTransform: "uppercase" }}>
            Cộng hoà Xã hội Chủ nghĩa Việt Nam
          </div>
          <div style={{ fontWeight: 700 }}>
            Độc lập &mdash; Tự do &mdash; Hạnh phúc
          </div>
          <div style={{ marginTop: 4, fontStyle: "italic" }}>
            ─────────────
          </div>
        </div>
      </div>

      <h1
        style={{
          textAlign: "center",
          fontSize: 18,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          margin: "10px 0 4px",
        }}
      >
        Phiếu chấm điểm bài kiểm tra
      </h1>
      <div
        style={{
          textAlign: "center",
          fontStyle: "italic",
          marginBottom: 18,
          fontSize: 12,
        }}
      >
        Môn: {subjectLabel || <BlankLine width={180} />}
        {dateStr && <> &mdash; Ngày: {dateStr}</>}
      </div>

      {/* ── Student info ───────────────────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          rowGap: 6,
          columnGap: 24,
          marginBottom: 14,
        }}
      >
        <div>
          <strong>Họ và tên học sinh:</strong>{" "}
          {studentName || <BlankLine width={220} />}
        </div>
        <div>
          <strong>Lớp:</strong> {studentClass || <BlankLine width={120} />}
        </div>
        <div>
          <strong>Số báo danh:</strong>{" "}
          {studentRoll || <BlankLine width={120} />}
        </div>
        <div>
          <strong>Ngày kiểm tra:</strong> <BlankLine width={120} />
        </div>
      </div>

      {/* ── Per-câu table ─────────────────────────────────────────────── */}
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          marginBottom: 14,
        }}
      >
        <thead>
          <tr>
            <th style={{ ...headCell, width: 36 }}>Câu</th>
            <th style={{ ...headCell, textAlign: "left" }}>
              Nội dung &amp; nhận xét của giáo viên
            </th>
            <th style={{ ...headCell, width: 64 }}>Thang điểm</th>
            <th style={{ ...headCell, width: 64 }}>Điểm chấm</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.num}>
              <td style={{ ...cellBase, textAlign: "center", fontWeight: 700 }}>
                {r.num}
              </td>
              <td style={cellBase}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  {r.prompt}
                </div>
                {r.goodPoints && (
                  <div style={{ marginTop: 2 }}>
                    <em>Ưu điểm:</em> {r.goodPoints}
                  </div>
                )}
                {r.improvements && (
                  <div style={{ marginTop: 2 }}>
                    <em>Cần cải thiện:</em> {r.improvements}
                  </div>
                )}
              </td>
              <td style={{ ...cellBase, textAlign: "center" }}>
                {r.maxPoints.toFixed(1)}
              </td>
              <td
                style={{ ...cellBase, textAlign: "center", fontWeight: 700 }}
              >
                {r.teacherScore.toFixed(2)}
              </td>
            </tr>
          ))}
          <tr>
            <td
              colSpan={2}
              style={{
                ...cellBase,
                textAlign: "right",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.02em",
              }}
            >
              Tổng cộng
            </td>
            <td style={{ ...cellBase, textAlign: "center", fontWeight: 700 }}>
              {maxTotal.toFixed(1)}
            </td>
            <td style={{ ...cellBase, textAlign: "center", fontWeight: 700 }}>
              {overallText}
            </td>
          </tr>
        </tbody>
      </table>

      {/* ── Final score in numbers + words ─────────────────────────────── */}
      <div style={{ marginBottom: 22 }}>
        <strong>Điểm cuối cùng:</strong> {overallText} / {maxTotal.toFixed(1)}
        &nbsp;&mdash;&nbsp;
        <em>Bằng chữ:</em> {overallWords}
      </div>

      {/* ── Signature blocks ───────────────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 24,
          textAlign: "center",
          marginTop: 24,
        }}
      >
        <div>
          <div style={{ fontStyle: "italic", marginBottom: 4 }}>
            Phụ huynh học sinh
          </div>
          <div style={{ fontSize: 11, fontStyle: "italic", color: "#333" }}>
            (Ký và ghi rõ họ tên)
          </div>
          <div style={{ height: 60 }} />
          <BlankLine width={180} />
        </div>
        <div>
          <div style={{ fontStyle: "italic", marginBottom: 4 }}>
            {dateStr ? `Ngày ${dateStr}` : "Ngày … tháng … năm ……"}
          </div>
          <div style={{ fontWeight: 700 }}>Giáo viên chấm</div>
          <div style={{ fontSize: 11, fontStyle: "italic", color: "#333" }}>
            (Ký và ghi rõ họ tên)
          </div>
          <div style={{ height: 60 }} />
          <BlankLine width={180} />
        </div>
      </div>
    </div>
  );
}
