import { useReducer, useCallback } from "react";
import { blankTab, tabsReducer } from "../lib/tabs";
import type { Tab, TabMeta, TabsState } from "../types";

function init(): TabsState {
  const fresh = blankTab();
  return { tabs: [fresh], activeId: fresh.id };
}

export interface UseTabsResult extends TabsState {
  addTab: () => void;
  closeTab: (id: string) => void;
  clearAll: () => void;
  setActive: (id: string) => void;
  updateMeta: (id: string, meta: TabMeta) => void;
}

export function useTabs(): UseTabsResult {
  const [state, dispatch] = useReducer(tabsReducer, undefined, init);

  const addTab = useCallback(() => dispatch({ type: "ADD" }), []);
  const closeTab = useCallback(
    (id: string) => dispatch({ type: "CLOSE", id }),
    [],
  );
  const clearAll = useCallback(() => dispatch({ type: "CLEAR" }), []);
  const setActive = useCallback(
    (id: string) => dispatch({ type: "SET_ACTIVE", id }),
    [],
  );
  const updateMeta = useCallback(
    (id: string, meta: TabMeta) => dispatch({ type: "UPDATE_META", id, meta }),
    [],
  );

  return { ...state, addTab, closeTab, clearAll, setActive, updateMeta };
}

// Re-export Tab type for convenience.
export type { Tab };
