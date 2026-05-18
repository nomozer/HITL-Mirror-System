/**
 * App.tsx — MIRROR root composer.
 *
 * Two top-level pages share the same SPA bundle, gated by the URL hash:
 *   • ``""`` (default)  → grading workspace (sidebar + tabs)
 *   • ``"#memory"``     → HITL Memory page (standalone, no sidebar)
 *
 * The header's "Bộ nhớ HITL" button opens ``#memory`` in a NEW browser
 * tab via ``window.open``, so the workspace tab keeps its full state
 * (tabs, uploads, in-flight grades) untouched in the background — same
 * mental model as middle-clicking a link in Chrome.
 */

import { useCallback, useEffect, useState } from "react";
import { vi as t } from "./i18n/vi";
import { T } from "./theme/tokens";
import { GlobalStyles } from "./theme/GlobalStyles";
import { useTabs } from "./hooks/useTabs";
import { useHeartbeat } from "./hooks/useHeartbeat";
import { useIsMobile } from "./hooks/useIsMobile";
import { Sidebar } from "./components/layout/Sidebar";
import { AppHeader } from "./components/layout/AppHeader";
import { TabBar } from "./components/layout/TabBar";
import { EssayWorkspace } from "./features/workspace/EssayWorkspace";
import { MemoryPanel } from "./features/memory/MemoryPanel";
import { HelpModal } from "./features/help/HelpModal";
import { GradeHistoryDropdown } from "./features/history/GradeHistoryDropdown";

const MEMORY_HASH = "#memory";

function isMemoryRoute(): boolean {
  return typeof window !== "undefined" && window.location.hash === MEMORY_HASH;
}

export default function App() {
  // Decide which page to mount ONCE — the workspace tab never navigates
  // to memory in-place (memory always opens in a new browser tab), so a
  // single render-time check is enough and skips loading useTabs / file
  // state on the memory page.
  const [memoryRoute] = useState<boolean>(isMemoryRoute);

  return memoryRoute ? <MemoryPage /> : <WorkspacePage />;
}

// ---------------------------------------------------------------------------
// Memory page — standalone, no sidebar / no tab bar / no heartbeat fight.
// ---------------------------------------------------------------------------

function MemoryPage() {
  // Heartbeat from this tab too so the backend doesn't shut down when the
  // workspace tab is closed but the memory tab remains open.
  useHeartbeat();

  return (
    <div style={{ minHeight: "100vh", background: T.bg }}>
      <GlobalStyles />
      <MemoryPanel />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workspace page — sidebar, tab bar, essay workspaces.
// ---------------------------------------------------------------------------

function WorkspacePage() {
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // History dropdown — open state + the trigger button's bounding rect so
  // the popover anchors under it. AppHeader hands us the rect because the
  // button ref lives over there.
  const [historyAnchor, setHistoryAnchor] = useState<DOMRect | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const openHelp = useCallback(() => setHelpOpen(true), []);
  const closeHelp = useCallback(() => setHelpOpen(false), []);
  const toggleHistory = useCallback((rect: DOMRect | null) => {
    setHistoryAnchor(rect);
    setHistoryOpen((v) => !v);
  }, []);
  const closeHistory = useCallback(() => setHistoryOpen(false), []);

  // "Bộ nhớ HITL" header button: open the memory page in a new browser tab
  // so the workspace tab (uploaded files, in-flight grades, scroll
  // position) stays exactly as the user left it.
  const openMemoryTab = useCallback(() => {
    const url = window.location.origin + window.location.pathname + MEMORY_HASH;
    window.open(url, "_blank", "noopener,noreferrer");
    setDrawerOpen(false);
  }, []);

  // Auto-close the drawer on viewport upgrade so the sticky sidebar
  // doesn't double-render on top of itself when crossing the breakpoint.
  useEffect(() => {
    if (!isMobile) setDrawerOpen(false);
  }, [isMobile]);

  // ESC closes the drawer for keyboard users.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDrawer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen, closeDrawer]);

  const { tabs, activeId, addTab, closeTab, clearAll, setActive, updateMeta } = useTabs();

  // Hydrate subject from localStorage so a returning teacher does not have
  // to re-pick. First-time users start with "" (no selection) and the
  // workspace renders a waiting state until they choose — guarantees every
  // saved lesson is stamped with the correct subject (cs/math).
  const [selectedSubject, setSelectedSubjectState] = useState<string>(() => {
    try {
      return localStorage.getItem("hitl.selectedSubject") || "";
    } catch {
      return "";
    }
  });
  const setSelectedSubject = useCallback((value: string) => {
    setSelectedSubjectState(value);
    try {
      localStorage.setItem("hitl.selectedSubject", value);
    } catch {
      // localStorage may be disabled in private mode — best-effort persist.
    }
  }, []);

  const [selectedClass, setSelectedClass] = useState<string>("Lớp 10");

  useHeartbeat();

  const completedCount = tabs.filter((tab) => tab.hasGrade).length;

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : "260px 1fr",
      }}
    >
      <GlobalStyles />

      {/* Desktop: in-grid sticky sidebar. Mobile: portal-style drawer
          rendered outside the grid so it can overlay the workspace. */}
      {!isMobile && (
        <Sidebar
          t={t}
          selectedSubject={selectedSubject}
          onSubjectChange={setSelectedSubject}
          selectedClass={selectedClass}
          onClassChange={setSelectedClass}
        />
      )}

      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <AppHeader
          onOpenDrawer={isMobile ? openDrawer : undefined}
          onOpenMemory={openMemoryTab}
          onOpenHelp={openHelp}
          memoryActive={false}
          onToggleHistory={toggleHistory}
          historyActive={historyOpen}
        />

        <TabBar
          tabs={tabs}
          activeId={activeId}
          onSelect={setActive}
          onAdd={addTab}
          onClose={closeTab}
          onClear={clearAll}
          completedCount={completedCount}
          t={t}
        />

        <main style={{ paddingTop: 12 }}>
          {tabs.map((tab) => (
            <EssayWorkspace
              key={tab.id}
              active={tab.id === activeId}
              selectedSubject={selectedSubject}
              selectedClass={selectedClass}
              onMeta={(meta) => updateMeta(tab.id, meta)}
            />
          ))}
        </main>
      </div>

      {/* Mobile drawer + backdrop. Mounted outside the grid so the drawer
          overlays the workspace without affecting layout flow. */}
      {isMobile && drawerOpen && (
        <Sidebar
          t={t}
          selectedSubject={selectedSubject}
          onSubjectChange={(value) => {
            setSelectedSubject(value);
            // Close on subject pick — the teacher's done with the drawer.
            closeDrawer();
          }}
          selectedClass={selectedClass}
          onClassChange={setSelectedClass}
          drawer
          onClose={closeDrawer}
        />
      )}

      {helpOpen && <HelpModal onClose={closeHelp} />}

      <GradeHistoryDropdown
        open={historyOpen}
        onClose={closeHistory}
        anchorRect={historyAnchor}
      />
    </div>
  );
}
