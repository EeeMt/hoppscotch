/* eslint-disable vue/one-component-per-file */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createApp, defineComponent, h, nextTick, type App } from "vue"

const mocks = vi.hoisted(() => ({
  allowed: ["OIDC"],
  redirect: vi.fn(),
  toast: vi.fn(),
  hide: vi.fn(),
}))
vi.mock("@composables/i18n", () => ({ useI18n: () => (key: string) => key }))
vi.mock("@composables/stream", () => ({
  useStreamSubscriber: () => ({ subscribeToStream: vi.fn() }),
}))
vi.mock("@composables/toast", () => ({
  useToast: () => ({ error: mocks.toast, clear: vi.fn() }),
}))
vi.mock("dioc/vue", () => ({ useService: () => ({}) }))
vi.mock("~/services/persistence", () => ({ PersistenceService: class {} }))
vi.mock("~/platform", () => ({
  platform: {
    auth: {
      getCurrentUserStream: vi.fn(),
      getAllowedAuthProviders: async () => ({
        _tag: "Right",
        right: mocks.allowed,
      }),
      additionalLoginItems: [
        { id: "OIDC", text: () => "OpenID Connect", onClick: mocks.redirect },
      ],
    },
  },
}))

import Login from "../Login.vue"

const Modal = defineComponent({
  setup:
    (_, { slots }) =>
    () =>
      h("section", [slots.body?.(), slots.footer?.()]),
})
const Item = defineComponent({
  props: { label: { type: String, default: "" }, disabled: Boolean },
  setup: (props) => () =>
    h("button", { disabled: props.disabled }, props.label),
})
const Empty = defineComponent({ render: () => null })

let app: App | undefined
let el: HTMLElement
const mount = async () => {
  el = document.body.appendChild(document.createElement("div"))
  app = createApp(Login, { onHideModal: mocks.hide })
  for (const [name, component] of Object.entries({
    HoppSmartModal: Modal,
    HoppSmartItem: Item,
    HoppSmartSpinner: Empty,
    AppLogo: Empty,
    HoppSmartInput: Empty,
    HoppButtonPrimary: Empty,
    HoppSmartAnchor: Empty,
    HoppButtonSecondary: Empty,
  }))
    app.component(name, component)
  app.mount(el)
  await nextTick()
  await nextTick()
}
const oidcButton = () =>
  el.querySelector<HTMLButtonElement>(".oidc-login-button")!

beforeEach(() => {
  vi.clearAllMocks()
  mocks.allowed = ["OIDC"]
  mocks.redirect.mockReset()
})
afterEach(() => {
  app?.unmount()
  el?.remove()
})

describe("OIDC login dialog", () => {
  it("shows a single OIDC action and explains the redirect", async () => {
    await mount()
    expect(el.querySelectorAll("button")).toHaveLength(1)
    expect(el.textContent).toContain("auth.oidc_welcome")
    expect(el.textContent).toContain("auth.oidc_login_note")
    expect(el.querySelector(".oidc-login-divider")).toBeNull()
    expect(
      document.getElementById(oidcButton().getAttribute("aria-describedby")!)
    ).not.toBeNull()
  })

  it("prevents duplicate navigation, shows progress, and recovers after browser Back", async () => {
    let finish!: () => void
    mocks.redirect.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    await mount()
    oidcButton().click()
    oidcButton().click()
    await nextTick()
    expect(mocks.redirect).toHaveBeenCalledTimes(1)
    expect(oidcButton().disabled).toBe(true)
    expect(oidcButton().getAttribute("aria-busy")).toBe("true")
    expect(oidcButton().textContent).toContain("auth.oidc_redirecting")
    finish()
    await nextTick()
    expect(mocks.hide).not.toHaveBeenCalled()
    expect(oidcButton().disabled).toBe(true)
    window.dispatchEvent(new Event("pageshow"))
    await nextTick()
    expect(oidcButton().disabled).toBe(false)
  })

  it("allows retry when navigation cannot start", async () => {
    mocks.redirect.mockRejectedValueOnce(new Error("navigation failed"))
    await mount()
    oidcButton().click()
    await nextTick()
    await nextTick()
    expect(mocks.toast).toHaveBeenCalledWith("auth.oidc_failure")
    expect(oidcButton().disabled).toBe(false)
    expect(mocks.hide).not.toHaveBeenCalled()
    oidcButton().click()
    expect(mocks.redirect).toHaveBeenCalledTimes(2)
  })

  it("keeps other sign-in methods and supports named OIDC providers", async () => {
    mocks.allowed = ["OIDC:Company", "GOOGLE", "EMAIL"]
    await mount()
    expect(el.querySelectorAll(".oidc-login-button")).toHaveLength(1)
    expect(el.querySelector(".oidc-login-divider")).not.toBeNull()
    expect(el.querySelectorAll("button")).toHaveLength(3)
    oidcButton().click()
    await nextTick()
    expect(
      [...el.querySelectorAll("button")].every((button) => button.disabled)
    ).toBe(true)
  })

  it("preserves the existing dialog when OIDC is disabled", async () => {
    mocks.allowed = ["GOOGLE"]
    await mount()
    expect(el.querySelector(".oidc-welcome")).toBeNull()
    expect(el.querySelector(".oidc-login-button")).toBeNull()
    expect(el.querySelectorAll("button")).toHaveLength(1)
  })
})
