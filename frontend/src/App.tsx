/**
 * App.tsx — MIRROR root composer.
 *
 * Wires hooks + layout shell (sidebar, header, tab bar) + per-essay
 * workspaces. Business logic lives in hooks/ and features/ — this file
 * only composes.
 */

import { useState } from "react";
import { i18n } from "./i18n";
import { GlobalStyles } from "./theme/GlobalStyles";
import { useLang } from "./hooks/useLang";
import { useTabs } from "./hooks/useTabs";
import { useHeartbeat } from "./hooks/useHeartbeat";
import { Sidebar } from "./components/layout/Sidebar";
import { AppHeader } from "./components/layout/AppHeader";
import { TabBar } from "./components/layout/TabBar";
import { EssayWorkspace } from "./features/workspace/EssayWorkspace";

export default function App() {
  const { lang, toggle: toggleLang } = useLang();
  const t = i18n[lang];

  const {
    tabs,
    activeId,
    addTab,
    closeTab,
    clearAll,
    setActive,
    updateMeta,
  } = useTabs();

  const [selectedSubject, setSelectedSubject] = useState<string>("Môn Tin");
  const [selectedClass, setSelectedClass] = useState<string>("Lớp 10");

  useHeartbeat();

  const completedCount = tabs.filter((tab) => tab.hasGrade).length;

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        gridTemplateColumns: "260px 1fr",
      }}
    >
      <GlobalStyles />

      <Sidebar
        t={t}
        selectedSubject={selectedSubject}
        onSubjectChange={setSelectedSubject}
        selectedClass={selectedClass}
        onClassChange={setSelectedClass}
      />

      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <AppHeader
          selectedSubject={selectedSubject}
          selectedClass={selectedClass}
          onToggleLang={toggleLang}
          t={t}
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
              lang={lang}
              selectedSubject={selectedSubject}
              selectedClass={selectedClass}
              onMeta={(meta) => updateMeta(tab.id, meta)}
            />
          ))}
        </main>
      </div>
    </div>
  );
}
