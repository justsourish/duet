import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// In development only: lets a developer look at the app's state from the console.
if (import.meta.env.DEV) void import("./state/store").then((m) => ((window as unknown as { __duet: unknown }).__duet = m));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
