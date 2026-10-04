import React from "react";
import { createRoot } from "react-dom/client";
import WorkspaceFixture from "./wa-workspace-app.jsx";

createRoot(document.getElementById("root")).render(<WorkspaceFixture planningMode={new URLSearchParams(location.search).has("planning")} />);
