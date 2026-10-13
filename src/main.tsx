import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// In development only: lets a developer look at the app's state from the console.
if (import.meta.env.DEV) void import("./state/store").then((m) => ((window as unknown as { __duet: unknown }).__duet = m));

// In the app people download, Duet is never a web page: the system's own right click menu, with
// Reload and Inspect, does not show, and the reload keys do nothing. Reload would throw away unsaved work.
if (import.meta.env.PROD) {
  window.addEventListener("contextmenu", (e) => e.preventDefault());
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "F5" || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "r")) e.preventDefault();
    },
    true,
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
