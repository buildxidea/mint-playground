import "./styles.css";
import { App } from "./core/App";

const container = document.getElementById("app");
if (!container) throw new Error("Missing #app container");

const app = new App(container);
app.start();
