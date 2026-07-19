import {StrictMode} from "react";
import {createRoot} from "react-dom/client";

import {App} from "./App";
import "./styles.css";
import "./demo.css";

const enableReactScan = new URLSearchParams(window.location.search).get("scan") === "1";

if (import.meta.env.DEV && enableReactScan) {
  void import("react-scan").then(({scan}) => scan());
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
