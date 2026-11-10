import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { registerSW } from "virtual:pwa-register";

// The offline copy is shown first, so a new deploy used to appear only on the
// second open. Registering this way reloads the page once a new version has
// been downloaded, and we look for one whenever the app comes back into view
// (an installed app is resumed far more often than it is reloaded).
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    const check = () => {
      if (document.visibilityState === "visible" && navigator.onLine) registration.update().catch(() => {});
    };
    document.addEventListener("visibilitychange", check);
    setInterval(check, 60 * 60 * 1000);
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
