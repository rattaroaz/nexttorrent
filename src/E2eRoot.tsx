import { TorrentWorkspace } from "./components/TorrentWorkspace";
import "./App.css";

/** Minimal shell for Playwright smoke tests (no Tauri window / clipboard hooks). */
export function E2eRoot() {
  return <TorrentWorkspace />;
}
