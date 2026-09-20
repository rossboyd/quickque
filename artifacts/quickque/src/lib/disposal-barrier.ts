/**
 * Publish a cleanup promise that cannot finish before the inherited
 * generation's cleanup. An inherited failure remains the barrier's failure,
 * even when this generation's cleanup also fails.
 */
export function chainDisposalBarrier(
  inherited: Promise<void>,
  cleanup: () => Promise<void>,
): Promise<void> {
  return inherited.then(
    () => cleanup(),
    async inheritedError => {
      try {
        await cleanup();
      } catch {
        // Preserve the first failed teardown as the fail-closed barrier.
      }
      throw inheritedError;
    },
  );
}