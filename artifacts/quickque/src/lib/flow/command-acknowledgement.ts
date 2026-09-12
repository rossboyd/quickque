export type FlowBridgeCommand = { action: string; generation: number };

/**
 * UI error reporting is observational, not an acknowledgement of native
 * shutdown. Awaiting callers must receive a rejection even when the failed
 * request is stale or its owning React component has already unmounted.
 */
export async function invokeAcknowledgedFlowCommand(
  command: FlowBridgeCommand,
  execute: (command: FlowBridgeCommand) => Promise<unknown>,
  reportFailure: (error: unknown) => void,
): Promise<void> {
  try {
    await execute(command);
  } catch (error) {
    try {
      reportFailure(error);
    } finally {
      // Never forward native payloads/transcripts into general error logs.
      throw new Error(`Flow ${command.action} was not acknowledged. Stop playback and retry.`);
    }
  }
}