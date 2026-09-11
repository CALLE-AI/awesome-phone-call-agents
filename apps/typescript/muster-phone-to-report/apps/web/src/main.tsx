import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import "./brand.css";
import { ensureFleetRoute } from "./router.js";
import "./styles.css";

const root = document.getElementById("root");
if (root === null) throw new Error("Muster web root is unavailable");
ensureFleetRoute(window);
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
