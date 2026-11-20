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
    <p v-if="status === 'success'" class="done" role="status">
      You are on the list. We will write to this email when paid plans open.
    </p>

    <form v-else class="form" @submit.prevent="submit">
      <label class="sr-only" for="pricing-notify-email">Email</label>
      <input
        id="pricing-notify-email"
        v-model="email"
        type="email"
        name="email"
        autocomplete="email"
        required
        placeholder="you@example.com"
        class="field"
      >
      <div class="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden="true">
        <label>
          Website
          <input v-model="website" type="text" name="website" tabindex="-1" autocomplete="off">
        </label>
      </div>
      <button type="submit" class="lf-btn lf-btn-secondary" :disabled="pending">
        <UIcon :name="pending ? 'i-lucide-loader-circle' : 'i-lucide-bell'" class="size-[1.1em]" :class="{ 'animate-spin': pending }" />
        Notify me
      </button>
    </form>

    <p v-if="errorText" class="err" role="alert">
      {{ errorText }}
    </p>

    <p class="fine">
      We keep your email only to send that one message, and drop it whenever
      you ask. More on the
      <NuxtLink to="/privacy" class="fl">Privacy</NuxtLink>
      page.
    </p>
  </div>
</template>

<style scoped>
.form {
  display: grid;
  gap: 0.6rem;
}

.field {
  box-sizing: border-box;
  width: 100%;
  min-height: 2.875rem;
  border: 1px solid var(--lf-line-strong);
  border-radius: 999px;
  background: var(--lf-surface);
  padding: 0 1.25rem;
  color: var(--lf-ink);
  font: inherit;
  font-size: 1rem;
}

.field::placeholder {
  color: var(--lf-ink-3);
}

.field:focus {
  border-color: var(--lf-accent);
  outline: 2px solid rgb(36 83 255 / 0.2);
  outline-offset: 0;
}

.form .lf-btn {
  cursor: pointer;
}

.form .lf-btn:disabled {
  cursor: default;
  opacity: 0.6;
}

.done {
  margin: 0;
  border: 1px solid rgb(36 83 255 / 0.25);
  border-radius: 12px;
  background: var(--lf-surface);
  padding: 0.75rem 1rem;
  color: var(--lf-accent);
  font-size: 0.9375rem;
  font-weight: 500;
}

.err {
  margin: 0.5rem 0 0;
  color: #c4320a;
  font-size: 0.875rem;
}

.fine {
  margin: 0.75rem 0 0;
  color: var(--lf-ink-3);
  font-size: 0.8125rem;
  line-height: 1.5;
}

.fl {
  color: var(--lf-accent);
  text-decoration: underline;
  text-underline-offset: 0.2em;
}
</style>
