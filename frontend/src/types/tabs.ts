import type { PipelinePhase } from "./domain";

export interface Tab {
  id: string;
  label: string;
  phase: PipelinePhase;
  step: number;
  hasGrade: boolean;
}

export type TabMeta = Partial<Pick<Tab, "label" | "phase" | "step" | "hasGrade">>;

export type TabsAction =
  | { type: "ADD" }
  | { type: "CLOSE"; id: string }
  | { type: "CLEAR" }
  | { type: "SET_ACTIVE"; id: string }
  | { type: "UPDATE_META"; id: string; meta: TabMeta };

export interface TabsState {
  tabs: Tab[];
  activeId: string;
}
