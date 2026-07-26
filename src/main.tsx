import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

async function bootstrap() {
  const root = document.getElementById("root") as HTMLElement;
  if (import.meta.env.VITE_E2E_MOCK) {
    const { installE2eMocks } = await import("./e2e/mock-ipc");
    installE2eMocks();
    const { E2eRoot } = await import("./E2eRoot");
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <E2eRoot />
      </React.StrictMode>,
    );
    return;
  }
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();
