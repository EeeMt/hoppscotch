<template>
  <HoppSmartModal
    dialog
    :title="`${t('auth.login_to_hoppscotch')}`"
    styles="sm:max-w-md"
    @close="hideModal"
  >
    <template #body>
      <template v-if="platform.auth.customLoginSelectorUI">
        <component :is="platform.auth.customLoginSelectorUI" />
      </template>

      <template v-else-if="isLoadingAllowedAuthProviders">
        <div class="flex justify-center">
          <HoppSmartSpinner />
        </div>
      </template>

      <template v-else>
        <div v-if="mode === 'sign-in'" class="flex flex-col space-y-2">
          <div v-if="hasOIDCLogin" class="oidc-welcome">
            <AppLogo class="h-14 w-14" aria-hidden="true" />
            <p class="mt-4 text-lg font-semibold text-secondaryDark">
              {{ t("auth.oidc_welcome") }}
            </p>
            <p class="mt-2 max-w-xs leading-relaxed">
              {{ t("auth.oidc_welcome_description") }}
            </p>
          </div>

          <template v-if="hasOIDCLogin">
            <template
              v-for="(loginItem, index) in oidcLoginItems"
              :key="loginItem.id"
            >
              <button
                type="button"
                class="oidc-login-button"
                :disabled="additionalLoading !== null"
                :aria-busy="additionalLoading === loginItem.id"
                :aria-label="
                  additionalLoading === loginItem.id
                    ? t('auth.oidc_redirecting')
                    : loginItem.text(t)
                "
                :aria-describedby="`oidc-description-${index}`"
                @click="doAdditionalLoginItemClickAction(loginItem)"
              >
                <span class="oidc-login-icon" aria-hidden="true">
                  <HoppSmartSpinner v-if="additionalLoading === loginItem.id" />
                  <IconKeyRound v-else class="h-5 w-5" />
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block font-semibold text-secondaryDark">
                    {{
                      additionalLoading === loginItem.id
                        ? t("auth.oidc_redirecting")
                        : loginItem.text(t)
                    }}
                  </span>
                  <span
                    :id="`oidc-description-${index}`"
                    class="mt-1 block text-xs font-normal leading-relaxed text-secondary"
                  >
                    {{ t("auth.oidc_login_description") }}
                  </span>
                </span>
                <IconArrowRight class="h-4 w-4 shrink-0" aria-hidden="true" />
              </button>
            </template>
            <p class="oidc-login-note" role="status">
              <IconShieldCheck
                class="h-3.5 w-3.5 shrink-0"
                aria-hidden="true"
              />
              {{ t("auth.oidc_login_note") }}
            </p>
            <div
              v-if="allowedAuthProviders.length || otherLoginItems.length"
              class="oidc-login-divider"
            >
              <span>{{ t("auth.oidc_other_options") }}</span>
            </div>
          </template>

          <HoppSmartItem
            v-for="provider in allowedAuthProviders"
            :key="provider.id"
            :loading="provider.isLoading.value"
            :disabled="additionalLoading !== null"
            :icon="provider.icon"
            :label="provider.label"
            @click="provider.action"
          />

          <hr
            v-if="otherLoginItems.length > 0 && allowedAuthProviders.length"
          />

          <HoppSmartItem
            v-for="loginItem in otherLoginItems"
            :key="loginItem.id"
            :loading="additionalLoading === loginItem.id"
            :disabled="additionalLoading !== null"
            :icon="loginItem.icon"
            :label="loginItem.text(t)"
            @click="doAdditionalLoginItemClickAction(loginItem)"
          />
        </div>
        <form
          v-if="mode === 'email'"
          class="flex flex-col space-y-2"
          @submit.prevent="signInWithEmail"
        >
          <HoppSmartInput
            v-model="form.email"
            type="email"
            placeholder=" "
            :label="t('auth.email')"
            input-styles="floating-input"
          />

          <HoppButtonPrimary
            :loading="signingInWithEmail"
            type="submit"
            :label="`${t('auth.send_magic_link')}`"
          />
        </form>

        <div
          v-if="!allowedAuthProviders?.length && !additionalLoginItems.length"
          class="flex flex-col items-center text-center"
        >
          <p>{{ t("state.require_auth_provider") }}</p>
          <p>{{ t("state.configure_auth") }}</p>
          <div class="mt-5">
            <a
              href="https://docs.hoppscotch.io/documentation/self-host/getting-started"
            >
              <HoppButtonSecondary
                outline
                filled
                blank
                :icon="IconFileText"
                :label="t('state.self_host_docs')"
              />
            </a>
          </div>
        </div>
        <div v-if="mode === 'email-sent'" class="flex flex-col px-4">
          <div class="flex max-w-md flex-col items-center justify-center">
            <icon-lucide-inbox class="h-6 w-6 text-accent" />
            <h3 class="my-2 text-center text-lg">
              {{ t("auth.we_sent_magic_link") }}
            </h3>
            <p class="text-center">
              {{
                t("auth.we_sent_magic_link_description", { email: form.email })
              }}
            </p>
          </div>
        </div>
      </template>
    </template>
    <template
      v-if="mode !== 'sign-in' || (tosLink && privacyPolicyLink)"
      #footer
    >
      <div
        v-if="mode === 'sign-in' && tosLink && privacyPolicyLink"
        class="text-tiny text-secondaryLight"
      >
        By signing in, you are agreeing to our
        <HoppSmartAnchor
          class="link"
          :to="tosLink"
          blank
          label="Terms of Service"
        />
        and
        <HoppSmartAnchor
          class="link"
          :to="privacyPolicyLink"
          blank
          label="Privacy Policy"
        />
      </div>
      <div v-if="mode === 'email'">
        <HoppButtonSecondary
          :label="t('auth.all_sign_in_options')"
          :icon="IconArrowLeft"
          class="!p-0"
          @click="mode = 'sign-in'"
        />
      </div>
      <div
        v-if="mode === 'email-sent'"
        class="flex flex-1 justify-between text-secondaryLight"
      >
        <HoppSmartAnchor
          class="link"
          :label="t('auth.re_enter_email')"
          :icon="IconArrowLeft"
          @click="mode = 'email'"
        />
        <HoppSmartAnchor
          class="link"
          :label="`${t('action.dismiss')}`"
          @click="hideModal"
        />
      </div>
    </template>
  </HoppSmartModal>
</template>

<script setup lang="ts">
import { parseAdditionalAuthProviders } from "~/helpers/auth-provider-login"
import { Ref, computed, onMounted, ref, shallowRef } from "vue"
import { useEventListener } from "@vueuse/core"

import { useI18n } from "@composables/i18n"
import { useStreamSubscriber } from "@composables/stream"
import { useToast } from "@composables/toast"

import { platform } from "~/platform"

import IconEmail from "~icons/auth/email"
import IconGithub from "~icons/auth/github"
import IconGoogle from "~icons/auth/google"
import IconMicrosoft from "~icons/auth/microsoft"
import IconArrowLeft from "~icons/lucide/arrow-left"
import IconFileText from "~icons/lucide/file-text"
import IconKeyRound from "~icons/lucide/key-round"
import IconArrowRight from "~icons/lucide/arrow-right"
import IconShieldCheck from "~icons/lucide/shield-check"

import { useService } from "dioc/vue"
import { LoginItemDef } from "~/platform/auth"
import { PersistenceService } from "~/services/persistence"

import * as E from "fp-ts/Either"

const emit = defineEmits<{
  (e: "hide-modal"): void
}>()

const { subscribeToStream } = useStreamSubscriber()
const t = useI18n()
const toast = useToast()

const persistenceService = useService(PersistenceService)

const form = {
  email: "",
}

const isLoadingAllowedAuthProviders = ref(true)

const signingInWithGoogle = ref(false)
const signingInWithGitHub = ref(false)
const signingInWithMicrosoft = ref(false)
const signingInWithEmail = ref(false)
const mode = ref("sign-in")

const tosLink = import.meta.env.VITE_APP_TOS_LINK
const privacyPolicyLink = import.meta.env.VITE_APP_PRIVACY_POLICY_LINK

type AuthProviderItem = {
  id: string
  icon: typeof IconGithub
  label: string
  action: (...args: any[]) => any
  isLoading: Ref<boolean>
}

let allowedAuthProviders: AuthProviderItem[] = []
const additionalLoginItems = shallowRef<LoginItemDef[]>([])
const isOIDCItem = (item: LoginItemDef) =>
  item.id === "OIDC" || item.id.startsWith("OIDC:")
const oidcLoginItems = computed(() =>
  additionalLoginItems.value.filter(isOIDCItem)
)
const otherLoginItems = computed(() =>
  additionalLoginItems.value.filter((item) => !isOIDCItem(item))
)
const hasOIDCLogin = computed(() => oidcLoginItems.value.length > 0)

const additionalLoading = ref<string | null>(null)
// Returning through the browser's back/forward cache must restore usable buttons.
useEventListener(window, "pageshow", () => {
  additionalLoading.value = null
})
const doAdditionalLoginItemClickAction = async (item: LoginItemDef) => {
  if (additionalLoading.value !== null) return
  additionalLoading.value = item.id
  try {
    await item.onClick()
    // Keep the progress state visible until the OIDC navigation replaces this
    // page. Closing the modal immediately makes a slow redirect look like a failure.
    if (!isOIDCItem(item)) emit("hide-modal")
  } catch {
    toast.error(t("auth.oidc_failure"))
    additionalLoading.value = null
    return
  }
  if (!isOIDCItem(item)) additionalLoading.value = null
}

onMounted(async () => {
  const currentUser$ = platform.auth.getCurrentUserStream()

  subscribeToStream(currentUser$, (user) => {
    if (user) hideModal()
  })

  const res = await platform.auth.getAllowedAuthProviders()

  if (E.isLeft(res)) {
    toast.error(`${t("error.authproviders_load_error")}`)
    isLoadingAllowedAuthProviders.value = false
    return
  }

  // setup the normal auth providers
  const enabledAuthProviders = authProvidersAvailable.filter((provider) =>
    res.right.includes(provider.id)
  )
  allowedAuthProviders = enabledAuthProviders

  // setup the additional login items
  platform.auth.additionalLoginItems?.forEach((item) => {
    parseAdditionalAuthProviders(res.right, item.id).forEach(({ id, name }) => {
      additionalLoginItems.value = [
        ...additionalLoginItems.value,
        {
          ...item,
          id,
          text: name
            ? () => t("auth.continue_with_auth_provider", { provider: name })
            : item.text,
        },
      ]
    })
  })

  isLoadingAllowedAuthProviders.value = false
})

const showLoginSuccess = () => {
  toast.success(`${t("auth.login_success")}`)
}

const signInWithGoogle = async () => {
  signingInWithGoogle.value = true

  try {
    await platform.auth.signInUserWithGoogle()
  } catch (e) {
    console.error(e)
    /*
        A auth/account-exists-with-different-credential Firebase error wont happen between Google and any other providers
        Seems Google account overwrites accounts of other providers https://github.com/firebase/firebase-android-sdk/issues/25
        */
    toast.error(`${t("error.something_went_wrong")}`)
  }

  signingInWithGoogle.value = false
}

const signInWithGithub = async () => {
  signingInWithGitHub.value = true

  const result = await platform.auth.signInUserWithGithub()

  if (!result) {
    signingInWithGitHub.value = false
    return
  }

  if (result.type === "success") {
    // this.showLoginSuccess()
  } else if (result.type === "account-exists-with-different-cred") {
    toast.info(`${t("auth.account_exists")}`, {
      duration: 0,
      closeOnSwipe: false,
      action: {
        text: `${t("action.yes")}`,
        onClick: async (_, toastObject) => {
          await result.link()
          showLoginSuccess()

          toastObject.goAway(0)
        },
      },
    })
  } else {
    console.log("error logging into github", result.err)
    toast.error(`${t("error.something_went_wrong")}`)
  }

  signingInWithGitHub.value = false
}

const signInWithMicrosoft = async () => {
  signingInWithMicrosoft.value = true

  try {
    await platform.auth.signInUserWithMicrosoft()
    // this.showLoginSuccess()
  } catch (e) {
    console.error(e)
    /*
        A auth/account-exists-with-different-credential Firebase error wont happen between MS with Google or Github
        If a Github account exists and user then logs in with MS email we get a "Something went wrong toast" and console errors and MS replaces GH as only provider.
        The error messages are as follows:
            FirebaseError: Firebase: Error (auth/popup-closed-by-user).
            @firebase/auth: Auth (9.6.11): INTERNAL ASSERTION FAILED: Pending promise was never set
        They may be related to https://github.com/firebase/firebaseui-web/issues/947
        */
    toast.error(`${t("error.something_went_wrong")}`)
  }

  signingInWithMicrosoft.value = false
}

const signInWithEmail = async () => {
  signingInWithEmail.value = true

  await platform.auth
    .signInWithEmail(form.email)
    .then(async () => {
      mode.value = "email-sent"
      await persistenceService.setLocalConfig("emailForSignIn", form.email)
    })
    .catch((e) => {
      console.error(e)
      toast.error(e.message)
      signingInWithEmail.value = false
    })
    .finally(() => {
      signingInWithEmail.value = false
    })
}

const authProvidersAvailable: AuthProviderItem[] = [
  {
    id: "GITHUB",
    icon: IconGithub,
    label: t("auth.continue_with_github"),
    action: signInWithGithub,
    isLoading: signingInWithGitHub,
  },
  // the authprovider either send github or github:enterprise and both are handled by the same route
  {
    id: "GITHUB:ENTERPRISE",
    icon: IconGithub,
    label: t("auth.continue_with_github_enterprise"),
    action: signInWithGithub,
    isLoading: signingInWithGitHub,
  },
  {
    id: "GOOGLE",
    icon: IconGoogle,
    label: t("auth.continue_with_google"),
    action: signInWithGoogle,
    isLoading: signingInWithGoogle,
  },
  {
    id: "MICROSOFT",
    icon: IconMicrosoft,
    label: t("auth.continue_with_microsoft"),
    action: signInWithMicrosoft,
    isLoading: signingInWithMicrosoft,
  },
  {
    id: "EMAIL",
    icon: IconEmail,
    label: t("auth.continue_with_email"),
    action: () => {
      mode.value = "email"
    },
    isLoading: signingInWithEmail,
  },
]

const hideModal = () => {
  mode.value = "sign-in"
  toast.clear()

  emit("hide-modal")
}
</script>

<style scoped lang="scss">
.oidc-welcome {
  @apply flex flex-col items-center px-4 pb-6 pt-3 text-center;
}

.oidc-login-button {
  @apply flex w-full items-center gap-3 rounded-xl border p-4 text-left leading-relaxed transition-colors;
  border-color: var(--accent-color);
  border-color: color-mix(
    in srgb,
    var(--accent-color) 40%,
    var(--divider-color)
  );
  background: var(--primary-light-color);
  background: color-mix(in srgb, var(--accent-color) 7%, var(--primary-color));

  &:hover:enabled {
    border-color: var(--accent-color);
    background: color-mix(
      in srgb,
      var(--accent-color) 13%,
      var(--primary-color)
    );
  }

  &:focus-visible {
    outline: 2px solid var(--accent-color);
    outline-offset: 3px;
  }

  &:disabled {
    @apply cursor-wait opacity-70;
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
}

.oidc-login-icon {
  @apply flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-accent;
  background: color-mix(in srgb, var(--accent-color) 12%, var(--primary-color));
}

.oidc-login-note {
  @apply flex items-start justify-center gap-2 px-3 pb-2 pt-3 text-center text-xs leading-relaxed;

  svg {
    @apply mt-0.5;
  }
}

.oidc-login-divider {
  @apply flex items-center gap-3 py-3 text-xs;

  &::before,
  &::after {
    content: "";
    @apply h-px flex-1 bg-divider;
  }
}
</style>
