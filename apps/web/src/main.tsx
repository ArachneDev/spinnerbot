import "@fontsource/barlow/400.css";
import "@fontsource/barlow/600.css";
import "@fontsource/black-ops-one/400.css";
import "@fontsource/oswald/500.css";
import "@fontsource/share-tech-mono/400.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/tokens.css";
import "./styles/arachne.css";
import "./styles/app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
