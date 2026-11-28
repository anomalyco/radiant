// Plaid Link's script loads on demand, from the only third-party origin the CSP allows.

interface PlaidHandler {
  open: () => void
  destroy: () => void
}

interface PlaidLink {
  create: (options: {
    token: string
    onSuccess: (publicToken: string) => void
    onExit?: (error: unknown) => void
  }) => PlaidHandler
}

declare global {
  interface Window {
    Plaid?: PlaidLink
  }
}

let loading: Promise<PlaidLink> | undefined

export function loadPlaid(): Promise<PlaidLink> {
  if (window.Plaid) return Promise.resolve(window.Plaid)
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script")
    script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js"
    script.async = true
    script.onload = () => (window.Plaid ? resolve(window.Plaid) : reject(new Error("Plaid Link failed to load")))
    script.onerror = () => {
      loading = undefined
      reject(new Error("Plaid Link failed to load"))
    }
    document.head.append(script)
  })
  return loading
}

/** Opens Plaid Link for a token and settles with the public token, or null when the user closes it. */
export async function openPlaid(token: string): Promise<string | null> {
  const plaid = await loadPlaid()
  return new Promise((resolve) => {
    const handler = plaid.create({
      token,
      onSuccess: (publicToken) => {
        resolve(publicToken)
        handler.destroy()
      },
      onExit: () => {
        resolve(null)
        handler.destroy()
      },
    })
    handler.open()
  })
}
