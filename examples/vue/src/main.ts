import { createApp } from "vue";
import App from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

createApp(App).mount(root);
