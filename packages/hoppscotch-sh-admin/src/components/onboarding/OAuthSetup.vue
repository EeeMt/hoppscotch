<template>
  <div class="space-y-2 flex flex-col my-4">
    <UiAccordion
      v-for="[provider, value] in Object.entries(currentConfigs.oAuthProviders)"
      :key="provider"
      :initial-open="shouldOpenProvider(provider as OAuthProvider)"
    >
      <template v-slot:header="{ isOpen, toggleAccordion }">
        <div class="flex items-center justify-between flex-1">
          <span class="font-semibold text-[.8rem] capitalize">{{
            provider === 'OIDC'
              ? 'OpenID Connect'
              : provider.toLocaleLowerCase()
          }}</span>
          <span>
            <HoppSmartToggle
              :on="isOpen"
              @change="
                () => {
                  toggleAccordion();
                  emit('toggleConfig', provider as EnabledConfig);
                }
              "
            />
          </span>
        </div>
      </template>
      <template v-slot:content>
        <div class="flex flex-col space-y-4 w-full flex-1 py-4">
          <template v-for="(_, key) in value" :key="key">
            <div
              v-if="
                [
                  'OIDC_TOKEN_ENDPOINT_AUTH_METHOD',
                  'OIDC_ALLOW_INSECURE_HTTP',
                ].includes(String(key))
              "
              class="flex flex-col gap-2"
            >
              <label :for="String(key)" class="text-secondaryLight">{{
                t(
                  String(key) === 'OIDC_ALLOW_INSECURE_HTTP'
                    ? 'configs.auth_providers.oidc_allow_insecure_http'
                    : 'configs.auth_providers.oidc_token_endpoint_auth_method',
                )
              }}</label>
              <select
                :id="String(key)"
                v-model="
                  currentConfigs.oAuthProviders[provider as OAuthProvider][key]
                "
                class="w-full min-w-0 rounded border border-divider bg-primaryLight p-2"
                :aria-describedby="`${String(key)}-help`"
              >
                <option
                  v-for="option in String(key) === 'OIDC_ALLOW_INSECURE_HTTP'
                    ? ['false', 'true']
                    : ['client_secret_basic', 'client_secret_post']"
                  :key="option"
                  :value="option"
                >
                  {{
                    t(
                      OIDC_OPTION_LABELS[
                        option as keyof typeof OIDC_OPTION_LABELS
                      ],
                    )
                  }}
                </option>
              </select>
              <p
                :id="`${String(key)}-help`"
                class="text-tiny text-secondaryLight"
              >
                {{
                  t(
                    String(key) === 'OIDC_ALLOW_INSECURE_HTTP'
                      ? 'configs.auth_providers.oidc_http_help'
                      : 'configs.auth_providers.oidc_auth_method_help',
                  )
                }}
              </p>
            </div>
            <HoppSmartInput
              v-else-if="isCallbackUrl(key as string)"
              v-model="
                currentConfigs.oAuthProviders[provider as OAuthProvider][key]
              "
              :label="makeReadableKey(key as string, true)"
              input-styles="floating-input !border-0"
              :autofocus="false"
              class="!my-2 !bg-primaryLight flex-1 rounded border border-divider"
              :disabled="true"
            >
              <template
                #button
                v-if="
                  currentConfigs.oAuthProviders[provider as OAuthProvider][key]
                "
              >
                <HoppSmartItem
                  v-tippy="{ theme: 'tooltip' }"
                  :icon="IconLucideCopy"
                  :title="'Copy to clipboard'"
                  @click="
                    () =>
                      copyCallbackUrl(
                        currentConfigs.oAuthProviders[
                          provider as OAuthProvider
                        ][key],
                      )
                  "
                  class="hover:bg-transparent"
                />
              </template>
            </HoppSmartInput>
            <HoppSmartInput
              v-else
              :type="String(key).endsWith('SECRET') ? 'password' : 'text'"
              v-model="
                currentConfigs.oAuthProviders[provider as OAuthProvider][key]
              "
              :label="makeReadableKey(key as string, true)"
              input-styles="floating-input"
              :autofocus="false"
              class="!my-2 !bg-primaryLight flex-1"
            />
          </template>
        </div>
      </template>
    </UiAccordion>
  </div>
</template>

<script lang="ts" setup>
import { HoppSmartItem } from '@hoppscotch/ui';
import { useVModel } from '@vueuse/core';
import { useI18n } from '~/composables/i18n';
import { useToast } from '~/composables/toast';
import {
  Configs,
  EnabledConfig,
  OAuthProvider,
} from '~/composables/useOnboardingConfigHandler';
import { copyToClipboard } from '~/helpers/utils/clipboard';
import { makeReadableKey } from '~/helpers/utils/readableKey';
import { OIDC_OPTION_LABELS } from '~/helpers/configs';
import IconLucideCopy from '~icons/lucide/copy';

const t = useI18n();
const toast = useToast();

const props = defineProps<{
  currentConfigs: Configs;
  enabledConfigs: EnabledConfig[];
}>();

const emit = defineEmits<{
  (e: 'toggleConfig', provider: EnabledConfig): void;
}>();

const currentConfigs = useVModel(props, 'currentConfigs');

// A provider accordion should auto-expand if it's in enabledConfigs OR if the
// backend has returned a saved CLIENT_ID for it. Checking CLIENT_ID is a
// direct, reliable signal independent of enabledConfigs propagation timing —
// if the backend has data for the provider, it was configured before.
const shouldOpenProvider = (provider: OAuthProvider): boolean => {
  if (props.enabledConfigs.includes(provider)) return true;
  // Each provider's config object has a `${provider}_CLIENT_ID` key, but
  // TS cannot narrow the union literal here — cast is intentional.
  const providerConfig = props.currentConfigs.oAuthProviders[
    provider
  ] as Record<string, string>;
  return !!providerConfig[`${provider}_CLIENT_ID`];
};

// check if the key is a callback URL
const isCallbackUrl = (key: string): boolean => {
  return key.toLowerCase().includes('callback');
};

const copyCallbackUrl = (callbackURL: string): void => {
  if (!callbackURL) return;
  copyToClipboard(callbackURL);

  toast.success(`${t('state.copied_to_clipboard')}`);
};
</script>
