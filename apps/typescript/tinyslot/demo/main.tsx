import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TinySlotApp } from "../app/TinySlotApp";
import "../app/globals.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("TinySlot demo root element was not found.");
}

createRoot(root).render(
  <StrictMode>
    <TinySlotApp publicDemo />
  </StrictMode>,
);
