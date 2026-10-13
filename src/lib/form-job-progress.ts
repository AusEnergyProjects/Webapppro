/** Public completion feedback shared by the web and native form clients. */
export type ProgressBlocker = { key: string; label: string; target: string };
export type FormJobProgress = {
  changed: boolean; stage: string; revision?: number; pending?: boolean;
  blockers: ProgressBlocker[];
};
