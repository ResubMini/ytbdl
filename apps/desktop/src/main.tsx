import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// 禁用 WebKit 原生右键菜单（英文、无法汉化）。
// bubble 阶段只 preventDefault：自定义 ContextMenu(Radix) 先处理并显示，
// 原生菜单被这里阻止，因此只剩我们的中文菜单。
window.addEventListener("contextmenu", (e) => e.preventDefault());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
