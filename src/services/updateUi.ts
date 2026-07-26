export type UpdateDialogPhase =
  | "idle"
  | "checking"
  | "up_to_date"
  | "downloading"
  | "installing"
  | "error";

export type UpdateUiState = {
  open: boolean;
  phase: UpdateDialogPhase;
  message: string;
};

type Listener = (state: UpdateUiState) => void;

const listeners = new Set<Listener>();

let state: UpdateUiState = {
  open: false,
  phase: "idle",
  message: "",
};

function emit() {
  for (const l of listeners) {
    l(state);
  }
}

export function getUpdateUiState(): UpdateUiState {
  return state;
}

export function subscribeUpdateUi(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function openUpdateDialog(message = "Checking for updates…") {
  state = { open: true, phase: "checking", message };
  emit();
}

export function closeUpdateDialog() {
  state = { open: false, phase: "idle", message: "" };
  emit();
}

export function setUpdateDialog(partial: {
  phase: UpdateDialogPhase;
  message: string;
}) {
  state = { open: true, ...partial };
  emit();
}
