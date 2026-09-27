/** A mounted map supplies its save operation. Failed saves leave its editor mounted. */
export function createMapNavigationGuard() {
  let save: (() => Promise<unknown>) | null = null;
  let session = 0;
  return {
    register(next: (() => Promise<unknown>) | null) { save = next; },
    reset() { save = null; session += 1; },
    async run(transition: () => void) {
      const currentSession = session;
      if (save) {
        try { await save(); }
        catch { return false; } // The editor exposes its retry action and retains the local geometry.
      }
      if (currentSession !== session) return false;
      transition();
      return true;
    },
  };
}
