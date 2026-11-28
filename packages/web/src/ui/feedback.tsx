import { showToast } from "@opencode/ui/toast"

export const toastError = (error: unknown) =>
  showToast({ variant: "error", title: error instanceof Error ? error.message : String(error) })

export const toastSuccess = (title: string, description?: string) => showToast({ variant: "success", title, description })

/** Runs an action, toasting its failure, and reports whether it succeeded. */
export async function attempt(action: () => Promise<unknown>, success?: string): Promise<boolean> {
  try {
    await action()
    if (success) toastSuccess(success)
    return true
  } catch (error) {
    toastError(error)
    return false
  }
}

export async function copy(text: string, label = "Copied") {
  try {
    await navigator.clipboard.writeText(text)
    toastSuccess(label)
  } catch (error) {
    toastError(error)
  }
}
