import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { AppProviders } from "./app/providers";
import { appRouter } from "./app/router";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("Отсутствует контейнер #root");
}

createRoot(container).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={appRouter} />
    </AppProviders>
  </StrictMode>,
);
