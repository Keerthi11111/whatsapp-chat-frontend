"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";

export type DeleteMode = "me" | "everyone";

type DeleteMessagesDialogProps = {
  count: number;
  /** All selected messages are mine, saved, and not already deleted for everyone. */
  canDeleteForEveryone: boolean;
  onDelete: (mode: DeleteMode) => Promise<void>;
  onClose: () => void;
};

/** WhatsApp's "Delete message?" dialog: for everyone / for me / cancel. */
export default function DeleteMessagesDialog({ count, canDeleteForEveryone, onDelete, onClose }: DeleteMessagesDialogProps) {
  const [busy, setBusy] = useState<DeleteMode | null>(null);
  const [error, setError] = useState("");

  async function run(mode: DeleteMode) {
    setBusy(mode);
    setError("");
    try {
      await onDelete(mode);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
      setBusy(null);
    }
  }

  const button =
    "flex items-center justify-center gap-2 rounded-full border border-[#d1d7db] px-6 py-2 text-sm font-medium text-[#008069] transition hover:bg-[#f5f6f6] hover:shadow-sm disabled:opacity-60";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/80 p-4" onClick={() => !busy && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[500px] rounded-[3px] bg-white px-6 pb-5 pt-6 shadow-[0_17px_50px_0_rgba(11,20,26,.19),0_12px_15px_0_rgba(11,20,26,.24)]"
      >
        <h2 id="delete-title" className="text-[15px] text-[#3b4a54]">
          {count === 1 ? "Delete message?" : `Delete ${count} messages?`}
        </h2>

        {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="mt-8 flex flex-col items-end gap-3">
          {canDeleteForEveryone && (
            <button onClick={() => run("everyone")} disabled={!!busy} className={button}>
              {busy === "everyone" && <LoaderCircle className="h-4 w-4 animate-spin" />}
              Delete for everyone
            </button>
          )}
          <button onClick={() => run("me")} disabled={!!busy} className={button}>
            {busy === "me" && <LoaderCircle className="h-4 w-4 animate-spin" />}
            Delete for me
          </button>
          <button onClick={onClose} disabled={!!busy} className={button}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
