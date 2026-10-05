<script setup lang="ts">
const { backendUrl } = useAppLinks();

const email = ref("");
const website = ref("");
const pending = ref(false);
const status = ref<"idle" | "success" | "error" | "rate_limited">("idle");
const errorText = ref("");

async function submit() {
  if (pending.value || status.value === "success") return;
  pending.value = true;
  status.value = "idle";
  errorText.value = "";
  try {
    await $fetch(`${backendUrl}/pricing/notify`, {
      method: "POST",
      body: { email: email.value, website: website.value },
    });
    status.value = "success";
  } catch (err: unknown) {
    const statusCode =
      typeof err === "object" && err && "statusCode" in err
        ? Number((err as { statusCode?: number }).statusCode)
        : 0;
    if (statusCode === 429) {
      status.value = "rate_limited";
      errorText.value = "Please try again later.";
    } else if (statusCode === 400) {
      status.value = "error";
      errorText.value = "That does not look like an email.";
    } else {
      status.value = "error";
      errorText.value = "Could not save your email. Try again.";
    }
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <div>
    <p
      v-if="status === 'success'"
      class="rounded-xl bg-white px-4 py-3 text-sm font-medium text-pc-600 ring-1 ring-pc-200"
      role="status"
    >
      You are on the list. We will write to this email when paid plans open.
    </p>

    <form v-else class="flex flex-col gap-2.5" @submit.prevent="submit">
      <label class="sr-only" for="pricing-notify-email">Email</label>
      <UInput
        id="pricing-notify-email"
        v-model="email"
        type="email"
        name="email"
        autocomplete="email"
        required
        placeholder="you@example.com"
        size="lg"
        class="w-full"
      />
      <div class="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden="true">
        <label>
          Website
          <input v-model="website" type="text" name="website" tabindex="-1" autocomplete="off" />
        </label>
      </div>
      <UButton
        type="submit"
        color="neutral"
        size="lg"
        icon="i-lucide-bell"
        :loading="pending"
        :disabled="pending"
        block
      >
        Notify me
      </UButton>
    </form>

    <p v-if="errorText" class="mt-2 text-sm text-red-600" role="alert">
      {{ errorText }}
    </p>

    <p class="mt-3 text-xs leading-relaxed text-slate-500">
      We keep your email only to send that one message, and drop it whenever
      you ask. More on the
      <NuxtLink to="/privacy" class="text-pc-600 underline">Privacy</NuxtLink>
      page.
    </p>
  </div>
</template>
