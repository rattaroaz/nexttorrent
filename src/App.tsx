import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { ask } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";

import { DebugOverlay } from "./components/DebugOverlay";
import { UpdateDialog } from "./components/UpdateDialog";
import { TorrentWorkspace } from "./components/TorrentWorkspace";
import { IPC_EVENTS, type SessionSnapshot } from "./ipc/contracts";
import {
  getNexttorrentSettings,
  getSessionSnapshot,
  torrentAddMagnet,
} from "./ipc/client";
import { formatInvokeError } from "./ipc/invokeError";
import "./App.css";

function App() {
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const clipboardChecked = useRef(false);

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
    if (clipboardChecked.current) {
      return;
    }
    clipboardChecked.current = true;

    // Deep-link / CLI magnets are handled in Rust (magnet_handler). Only prompt
    // for clipboard magnets here to avoid double-adding launch URLs.
    void (async () => {
      try {
        const text = (await readText())?.trim() ?? "";
        if (!text.startsWith("magnet:?")) {
          return;
        }
        const add = await ask(
          "A magnet link was found on the clipboard. Add it to Nexttorrent?",
          { title: "Add magnet from clipboard", kind: "info" },
        );
        if (add) {
          await torrentAddMagnet(text, null, null, false);
        }
      } catch {
        /* clipboard unavailable */
      }
    })().catch((e) => {
      console.warn("clipboard magnet prompt failed:", formatInvokeError(e));
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlistenClose: (() => void) | undefined;
    void (async () => {
      const unlisten = await getCurrentWindow().onCloseRequested(
        async (event) => {
          const s = await getNexttorrentSettings();
          if (s.minimizeToTray) {
            event.preventDefault();
            await getCurrentWindow().hide();
          }
        },
      );
      if (cancelled) {
        unlisten();
        return;
      }
      unlistenClose = unlisten;
    })();
    return () => {
      cancelled = true;
      unlistenClose?.();
    };
  }, []);

  return (
    <>
      <TorrentWorkspace />
      <UpdateDialog />
      <DebugOverlay snapshot={snapshot} />
    </>
  );
}

export default App;
