/* eslint-disable vue/one-component-per-file */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createApp, nextTick, type App } from "vue"
import {
  HoppButtonPrimary,
  HoppButtonSecondary,
  HoppSmartItem,
  HoppSmartModal,
} from "@hoppscotch/ui"

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  confirm: vi.fn(),
  push: vi.fn(),
  user: { displayName: "Workspace User", email: "user@example.com" },
}))

vi.mock("@composables/i18n", () => ({ useI18n: () => (key: string) => key }))
vi.mock("@composables/toast", () => ({
  useToast: () => ({ success: mocks.success, error: mocks.error }),
}))
vi.mock("~/helpers/actions", () => ({ defineActionHandler: vi.fn() }))
vi.mock("vue-router", () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock("~/platform", () => ({
  platform: {
    auth: {
      signOutUser: mocks.signOut,
      getCurrentUser: () => mocks.user,
      additionalLoginItems: [{ id: "OIDC" }],
    },
  },
}))

import Logout from "../Logout.vue"

let app: App
let el: HTMLElement
const settle = async () => {
  await nextTick()
  await nextTick()
}
const button = (label: string) =>
  [
    ...(dialog() ?? document).querySelectorAll<HTMLButtonElement>("button"),
  ].find((item) => item.textContent?.trim() === label)!
const dialog = () => document.querySelector('[role="dialog"]')
const open = async () => {
  ;(el.firstElementChild as HTMLElement).click()
  await settle()
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.signOut.mockReset()
  vi.spyOn(console, "error").mockImplementation(() => {})
  el = document.body.appendChild(document.createElement("div"))
  app = createApp(Logout, { onConfirmLogout: mocks.confirm })
  for (const [name, component] of Object.entries({
    HoppSmartItem,
    HoppSmartModal,
    HoppButtonPrimary,
    HoppButtonSecondary,
  }))
    app.component(name, component)
  app.component("AppLogo", { render: () => null })
  app.component("RouterLink", { render: () => null })
  app.provide("HOPP_UI_OPTIONS", {})
  app.directive("focus", {
    mounted: (element) => nextTick(() => element.focus()),
  })
  app.directive("tippy", {})
  app.mount(el)
})

afterEach(() => {
  app.unmount()
  el.remove()
  document.getElementById("hoppscotch-modal-portal")?.remove()
  vi.restoreAllMocks()
})

describe("logout dialog", () => {
  it("opens once, shows the current account, and lets the user cancel", async () => {
    button("auth.logout").click()
    await settle()
    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    expect(dialog()?.textContent).toContain(mocks.user.email)
    expect(dialog()?.textContent).toContain("auth.logout_sso_note")
    expect(document.activeElement).toBe(button("action.cancel"))
    button("action.cancel").click()
    await settle()
    expect(dialog()).toBeNull()
    expect(mocks.signOut).not.toHaveBeenCalled()
  })

  it("keeps progress visible and prevents duplicate logout and dismissal until completion", async () => {
    let finish!: () => void
    mocks.signOut.mockImplementation(
      () => new Promise<void>((resolve) => (finish = resolve))
    )
    await open()
    button("auth.logout").click()
    button("auth.logout").click()
    await settle()
    expect(mocks.signOut).toHaveBeenCalledTimes(1)
    expect(dialog()?.getAttribute("aria-busy")).toBe("true")
    expect(button("auth.logging_out").disabled).toBe(true)
    expect(button("action.cancel").disabled).toBe(true)
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    await settle()
    expect(dialog()).not.toBeNull()
    expect(mocks.success).not.toHaveBeenCalled()
    finish()
    await settle()
    expect(dialog()).toBeNull()
    expect(mocks.success).toHaveBeenCalledWith("auth.logged_out")
  })

  it("keeps a failed logout open and allows a successful retry", async () => {
    mocks.signOut.mockRejectedValueOnce(new Error("network unavailable"))
    await open()
    button("auth.logout").click()
    await settle()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "auth.logout_failure"
    )
    expect(mocks.error).toHaveBeenCalledWith("auth.logout_failure")
    expect(button("auth.logout").disabled).toBe(false)
    button("auth.logout").click()
    await settle()
    expect(mocks.signOut).toHaveBeenCalledTimes(2)
    expect(dialog()).toBeNull()
    expect(mocks.success).toHaveBeenCalledTimes(1)
  })

  it("allows Escape to cancel and clears old errors when reopened", async () => {
    mocks.signOut.mockRejectedValueOnce(new Error("network unavailable"))
    await open()
    button("auth.logout").click()
    await settle()
    expect(document.querySelector('[role="alert"]')).not.toBeNull()
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    await settle()
    expect(dialog()).toBeNull()
    await open()
    expect(document.querySelector('[role="alert"]')).toBeNull()
    expect(button("auth.logout").disabled).toBe(false)
  })
})
