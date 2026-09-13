import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { SimulatorApp } from "./SimulatorApp.js";
import "./simulator.css";

const root = document.getElementById("root");
if (root === null) throw new Error("Muster simulator web root is unavailable");
createRoot(root).render(
  <StrictMode>
    <SimulatorApp />
  </StrictMode>,
);
