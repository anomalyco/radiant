import { BOOT_ELEMENT_ID, type Boot } from "./boot"

function read(): Boot {
  const element = document.getElementById(BOOT_ELEMENT_ID)
  if (element?.textContent) return JSON.parse(element.textContent) as Boot
  // The Vite dev server has no Worker in front of it.
  return { page: "landing", baseUrl: location.origin + "/labs/radiant", basePath: "/labs/radiant" }
}

export const boot = read()
