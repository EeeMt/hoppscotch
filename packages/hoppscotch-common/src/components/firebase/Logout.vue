<template>
  <div class="flex" @click.self="openLogoutModal">
    <HoppSmartItem
      :icon="IconLogOut"
      :label="t('auth.logout')"
      :aria-label="t('auth.logout')"
      :outline="outline"
      :shortcut="shortcut"
      @click="openLogoutModal"
    />
    <HoppSmartModal
      v-if="confirmLogout"
      dialog
      :title="t('auth.logout')"
      :dimissible="!isLoggingOut"
      styles="sm:max-w-md"
      :aria-label="t('auth.logout')"
      aria-modal="true"
      :aria-busy="isLoggingOut"
      @close="hideModal"
    >
      <template #body>
        <div class="logout-welcome">
          <AppLogo class="h-14 w-14" aria-hidden="true" />
          <h2 class="mt-4 text-lg font-semibold text-secondaryDark">
            {{ t("auth.logout_title") }}
          </h2>
          <p class="mt-2 max-w-xs leading-relaxed">
            {{ t("auth.logout_description") }}
          </p>
        </div>

        <div v-if="logoutUser" class="logout-account">
          <span class="logout-account-icon" aria-hidden="true">
            <IconUserRound class="h-5 w-5" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="break-words font-semibold text-secondaryDark">
              {{
                logoutUser.displayName || t("profile.default_hopp_displayname")
              }}
            </p>
            <p v-if="logoutUser.email" class="mt-1 break-all text-xs">
              {{ logoutUser.email }}
            </p>
          </div>
        </div>

        <div v-if="supportsOIDC" class="logout-note">
          <IconShieldCheck
            class="mt-0.5 h-3.5 w-3.5 shrink-0"
            aria-hidden="true"
          />
          <p>{{ t("auth.logout_sso_note") }}</p>
        </div>

        <p
          v-if="logoutFailed"
          role="alert"
          class="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs leading-relaxed text-red-500"
        >
          {{ t("auth.logout_failure") }}
        </p>
      </template>
      <template #footer>
        <div
          class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end"
        >
          <HoppButtonSecondary
            v-focus
            :label="t('action.cancel')"
            :aria-label="t('action.cancel')"
            :disabled="isLoggingOut"
            outline
            filled
            class="justify-center"
            @click="hideModal"
          />
          <HoppButtonPrimary
            :label="isLoggingOut ? t('auth.logging_out') : t('auth.logout')"
            :aria-label="
              isLoggingOut ? t('auth.logging_out') : t('auth.logout')
            "
            :icon="IconLogOut"
            :loading="isLoggingOut"
            :disabled="isLoggingOut"
            :aria-busy="isLoggingOut"
            class="justify-center"
            @click="logout"
          />
        </div>
      </template>
    </HoppSmartModal>
  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef } from "vue"
import IconLogOut from "~icons/lucide/log-out"
import IconUserRound from "~icons/lucide/user-round"
import IconShieldCheck from "~icons/lucide/shield-check"
import { useToast } from "@composables/toast"
import { useI18n } from "@composables/i18n"
import { platform } from "~/platform"
import type { HoppUser } from "~/platform/auth"
import { defineActionHandler } from "~/helpers/actions"
import { useRouter } from "vue-router"

defineProps({
  outline: {
    type: Boolean,
    default: false,
  },
  shortcut: {
    type: Array,
    default: () => [],
  },
})

const emit = defineEmits<{
  (e: "confirm-logout"): void
}>()

const confirmLogout = ref(false)
const isLoggingOut = ref(false)
const logoutFailed = ref(false)
const logoutUser = shallowRef<HoppUser | null>(null)
const supportsOIDC = platform.auth.additionalLoginItems?.some(
  (item) => item.id === "OIDC" || item.id.startsWith("OIDC:")
)

const toast = useToast()
const t = useI18n()
const router = useRouter()

const logout = async () => {
  if (isLoggingOut.value) return
  isLoggingOut.value = true
  logoutFailed.value = false

  try {
    await platform.auth.signOutUser()
    confirmLogout.value = false
    toast.success(t("auth.logged_out"))

    const { organization } = platform

    if (!organization) {
      return
    }

    if (!organization.isDefaultCloudInstance) {
      router.push({
        name: "orgs-login-required",
      })

      window.location.reload()
    }
  } catch (e) {
    console.error(e)
    logoutFailed.value = true
    toast.error(t("auth.logout_failure"))
  } finally {
    isLoggingOut.value = false
  }
}

const openLogoutModal = () => {
  if (confirmLogout.value || isLoggingOut.value) return
  logoutUser.value = platform.auth.getCurrentUser()
  logoutFailed.value = false
  emit("confirm-logout")
  confirmLogout.value = true
}

const hideModal = () => {
  if (isLoggingOut.value) return
  confirmLogout.value = false
}

defineActionHandler("user.logout", () => {
  openLogoutModal()
})
</script>

<style scoped lang="scss">
.logout-welcome {
  @apply flex flex-col items-center px-4 pb-6 pt-3 text-center;
}

.logout-account {
  @apply flex items-center gap-3 rounded-xl border border-divider p-4;
  border-color: color-mix(
    in srgb,
    var(--accent-color) 40%,
    var(--divider-color)
  );
  background: var(--primary-light-color);
  background: color-mix(in srgb, var(--accent-color) 7%, var(--primary-color));
}

.logout-account-icon {
  @apply flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primaryLight text-accent;
  background: color-mix(in srgb, var(--accent-color) 12%, var(--primary-color));
}

.logout-note {
  @apply flex items-start gap-2 px-3 pb-1 pt-4 text-xs leading-relaxed;
}
</style>
