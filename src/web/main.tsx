import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "../components/auth/AuthProvider";
import { App } from "./App";
import "./styles.css";

try {
  const theme = localStorage.getItem("aire-theme");
  document.documentElement.classList.toggle("dark", theme === "dark" || (!theme && window.matchMedia("(prefers-color-scheme: dark)").matches));
} catch { /* Storage can be disabled. */ }
const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");
createRoot(root).render(<StrictMode><BrowserRouter><AuthProvider><App /></AuthProvider></BrowserRouter></StrictMode>);
