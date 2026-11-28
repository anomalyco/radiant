// Sets the colour scheme before the first paint. A file, because the CSP allows no inline script.
;(() => {
  let saved = null
  try {
    saved = localStorage.getItem("radiant:color-scheme")
  } catch {}
  const dark = saved === "light" || saved === "dark" ? saved === "dark" : matchMedia("(prefers-color-scheme: dark)").matches
  document.documentElement.dataset.colorScheme = dark ? "dark" : "light"
})()
