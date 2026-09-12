import { useState } from "react";
import {
  formatNativeErrorDetailsForCopy,
  type NativeErrorDetails,
} from "@/lib/flow/native-errors";

interface NativeErrorDetailsProps {
  details: NativeErrorDetails;
  /** Clears the parent Flow state's raw stderr and process metadata. */
  onClear: () => void;
}

export function NativeErrorDetails({ details, onClear }: NativeErrorDetailsProps) {
  const [open, setOpen] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");

  const copy = async () => {
    try {
      // Clipboard access is available only behind this explicit button.
      await navigator.clipboard.writeText(formatNativeErrorDetailsForCopy(details));
      setCopyMessage("Copied");
    } catch {
      setCopyMessage("Copy unavailable");
    }
  };

  return (
    <section className="mt-2 w-full basis-full rounded border border-destructive-foreground/25 bg-black/10 text-xs">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className="w-full px-2 py-1.5 text-left font-medium underline-offset-2 hover:underline"
      >
        {open ? "Hide native details" : "Show native details"}
      </button>
      {open && (
        <div className="space-y-2 border-t border-destructive-foreground/20 px-2 py-2">
          <p className="font-medium">
            Warning: native output may contain sensitive information, including
            file paths or words.
          </p>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
            <dt>Process exit code</dt>
            <dd>{details.exitCode === null ? "Unknown" : details.exitCode}</dd>
            <dt>Process signal</dt>
            <dd>{details.signal === null ? "Unknown" : details.signal}</dd>
            <dt>Forced cleanup</dt>
            <dd>{details.cleanupForced ? "Yes" : "No"}</dd>
          </dl>
          <div>
            <p className="mb-1 font-medium">
              Raw stderr{details.stderrTruncated ? " (capped at 8192 bytes)" : ""}
            </p>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-black/20 p-2 font-mono text-[11px]">
              {details.stderr || "(no stderr captured)"}
            </pre>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void copy()}
              className="rounded border border-current/30 px-2 py-1 font-medium hover:bg-black/10"
            >
              Copy details
            </button>
            <button
              type="button"
              onClick={onClear}
              className="px-2 py-1 underline underline-offset-2 hover:no-underline"
            >
              Clear
            </button>
            {copyMessage && <span role="status">{copyMessage}</span>}
          </div>
        </div>
      )}
    </section>
  );
}