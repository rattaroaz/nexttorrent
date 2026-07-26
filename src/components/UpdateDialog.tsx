import { useEffect, useState } from "react";

import {
  closeUpdateDialog,
  getUpdateUiState,
  subscribeUpdateUi,
  type UpdateDialogPhase,
  type UpdateUiState,
} from "../services/updateUi";

function titleForPhase(phase: UpdateDialogPhase): string {
  switch (phase) {
    case "checking":
      return "Checking for updates";
    case "up_to_date":
      return "Up to date";
    case "downloading":
      return "Downloading update";
    case "installing":
      return "Installing update";
    case "error":
      return "Update failed";
    default:
      return "Updates";
  }
}

function isBusy(phase: UpdateDialogPhase): boolean {
  return (
    phase === "checking" ||
    phase === "downloading" ||
    phase === "installing"
  );
}

export function UpdateDialog() {
  const [ui, setUi] = useState<UpdateUiState>(getUpdateUiState);

  useEffect(() => subscribeUpdateUi(setUi), []);

  if (!ui.open) {
    return null;
  }

  const busy = isBusy(ui.phase);

  return (
    <dialog open className="modal" data-testid="update-dialog">
      <h3>{titleForPhase(ui.phase)}</h3>
      <p className="muted" style={{ whiteSpace: "pre-wrap" }}>
        {ui.message}
      </p>
      {busy ? (
        <p className="hint">Please wait…</p>
      ) : (
        <div className="modal-actions">
          <button
            type="button"
            data-testid="update-dialog-close"
            onClick={() => closeUpdateDialog()}
          >
            Close
          </button>
        </div>
      )}
    </dialog>
  );
}
