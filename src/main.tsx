import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/noto-sans-sc/chinese-simplified-400.css";
import "@fontsource/noto-sans-sc/chinese-simplified-600.css";
import "@fontsource/noto-sans-sc/chinese-simplified-700.css";
import "@fontsource/noto-serif-sc/chinese-simplified-700.css";
import "@fontsource/noto-serif-sc/chinese-simplified-900.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import App from "./App";
import { CloudGate } from "./cloud/CloudGate";
import "./styles.css";
import "./exports.css";
import "./result-view.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><CloudGate><App /></CloudGate></React.StrictMode>,
);
