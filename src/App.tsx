import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

import { DebugOverlay } from "./components/DebugOverlay";
import { TorrentWorkspace } from "./components/TorrentWorkspace";
import { IPC_EVENTS, type SessionSnapshot } from "./ipc/contracts";
import { getNexttorrentSettings, getSessionSnapshot } from "./ipc/client";
import "./App.css";

function App() {
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;

    void getSessionSnapshot().then((data) => {
      if (!cancelled) {
        setSnapshot(data);
      }
    });

    void getNexttorrentSettings().then((s) => {
      document.documentElement.dataset.theme = s.theme;
    });

    const unlistenPromise = listen<SessionSnapshot>(
      IPC_EVENTS.sessionReady,
      (event) => {
        setSnapshot(event.payload);
      },
    );

    return () => {
      cancelled = true;
      void unlistenPromise.then((unlisten) => {
        unlisten();
      });
    };
  }, []);

  useEffect(() => {
    let unlistenClose: (() => void) | undefined;
    void (async () => {
      unlistenClose = await getCurrentWindow().onCloseRequested(async (event) => {
        const s = await getNexttorrentSettings();
        if (s.minimizeToTray) {
          event.preventDefault();
          await getCurrentWindow().hide();
        }
      });
    })();
    return () => {
      unlistenClose?.();
    };
  }, []);

  return (
    <>
      <TorrentWorkspace />
      <DebugOverlay snapshot={snapshot} />
    </>
  );
}

export default App;
