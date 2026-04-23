import type { Tab, TabsAction, TabsState } from "../types";

export function makeTabId(): string {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function blankTab(): Tab {
  return {
    id: makeTabId(),
    label: "",
    phase: "idle",
    step: 1,
    hasGrade: false,
  };
}

/**
 * Pure reducer for tabs + activeId.
 * Every action returns {tabs, activeId} — no setTimeout, no side-effects.
 */
export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case "ADD": {
      const fresh = blankTab();
      return { tabs: [...state.tabs, fresh], activeId: fresh.id };
    }
    case "CLOSE": {
      const idx = state.tabs.findIndex((x) => x.id === action.id);
      const next = state.tabs.filter((x) => x.id !== action.id);
      if (next.length === 0) {
        const fresh = blankTab();
        return { tabs: [fresh], activeId: fresh.id };
      }
      let activeId = state.activeId;
      if (activeId === action.id) {
        activeId = next[Math.max(0, idx - 1)]?.id || next[0].id;
      }
      return { tabs: next, activeId };
    }
    case "CLEAR": {
      const fresh = blankTab();
      return { tabs: [fresh], activeId: fresh.id };
    }
    case "SET_ACTIVE":
      return { ...state, activeId: action.id };
    case "UPDATE_META":
      return {
        ...state,
        tabs: state.tabs.map((x) =>
          x.id === action.id ? { ...x, ...action.meta } : x,
        ),
      };
    default:
      return state;
  }
}
