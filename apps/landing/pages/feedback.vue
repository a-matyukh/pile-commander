<script setup lang="ts">
const { backendUrl } = useAppLinks();

useSeoMeta({
  title: "Feedback",
  description:
    "Tell us what is broken, what you want, or anything else about Pile Commander. We read every note.",
  ogTitle: "Feedback — Pile Commander",
  ogDescription:
    "Send a bug, an idea, or a note. We keep the email so we can write back.",
  ogImage: "/app-icon.png",
  twitterCard: "summary",
});

const MESSAGE_MAX = 4000;
const ATTACHMENT_MAX = 5;
const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
const ATTACHMENT_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/jpg"]);

const categories = [
  { label: "Bug", value: "bug" },
  { label: "Idea", value: "idea" },
  { label: "Other", value: "other" },
];

type Preview = { file: File; url: string };
type UploadTicket = { path: string; token: string; signedUrl: string };

const email = ref("");
const category = ref<"bug" | "idea" | "other">("idea");
const message = ref("");
const website = ref("");
const files = ref<Preview[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);
const pending = ref(false);
const status = ref<"idle" | "success" | "error" | "rate_limited">("idle");
const errorText = ref("");

const messageLength = computed(() => message.value.length);
const trimmedMessage = computed(() => message.value.trim());
const canSubmit = computed(
  () =>
    !pending.value &&
    status.value !== "success" &&
    trimmedMessage.value.length > 0 &&
    trimmedMessage.value.length <= MESSAGE_MAX,
);

onUnmounted(() => {
  for (const preview of files.value) URL.revokeObjectURL(preview.url);
});

function addFiles(list: FileList | null) {
  if (!list) return;
  const next = [...files.value];
  let refused = false;
  for (const file of list) {
    if (next.length >= ATTACHMENT_MAX) break;
    if (!ATTACHMENT_MIMES.has(file.type) || file.size < 1 || file.size > ATTACHMENT_MAX_BYTES) {
      refused = true;
      continue;
    }
    next.push({ file, url: URL.createObjectURL(file) });
  }
  files.value = next;
  if (fileInput.value) fileInput.value.value = "";
  if (refused) {
    errorText.value = "Screenshots must be JPEG, PNG, WebP or GIF, up to 5 MB each.";
  } else if (errorText.value.startsWith("Screenshots must be")) {
    errorText.value = "";
  }
}

function removeFile(index: number) {
  const gone = files.value[index];
  if (gone) URL.revokeObjectURL(gone.url);
  files.value = files.value.filter((_, i) => i !== index);
}

async function submit() {
  if (!canSubmit.value) return;
  pending.value = true;
  status.value = "idle";
  errorText.value = "";
  try {
    const created = await $fetch<{ ok: boolean; uploads?: UploadTicket[] }>(
      `${backendUrl}/feedback`,
      {
        method: "POST",
        body: {
          email: email.value,
          category: category.value,
          message: message.value,
          website: website.value,
          attachments: files.value.map((preview) => ({
            mime: preview.file.type,
            size: preview.file.size,
          })),
        },
      },
    );
    const uploads = created.uploads ?? [];
    for (let i = 0; i < uploads.length; i++) {
      const preview = files.value[i];
      const ticket = uploads[i];
      if (!preview || !ticket) continue;
      const put = await fetch(ticket.signedUrl, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${ticket.token}`,
          "Content-Type": preview.file.type,
          "x-upsert": "false",
        },
        body: preview.file,
      });
      if (!put.ok) {
        status.value = "error";
        errorText.value =
          "We have the note. A screenshot did not upload — try sending it again, or skip it.";
        return;
      }
    }
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
      errorText.value = "Please check your email, category, message, and screenshots.";
    } else {
      status.value = "error";
      errorText.value = "Could not send that. Try again.";
    }
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <div>
    <section class="px-5 pt-16 pb-10 md:pt-20">
      <div class="mx-auto max-w-3xl text-center">
        <p class="mb-3 text-xs font-semibold tracking-[0.08em] text-pc-600 uppercase">
          Feedback
        </p>
        <h1 class="text-4xl tracking-tight text-slate-900 md:text-5xl">
          Tell us what to fix or build next
        </h1>
        <p class="mx-auto mt-5 max-w-xl text-base leading-relaxed text-slate-600 md:text-lg">
          A bug, an idea, or anything else. Leave an email so we can write back —
          we do not use it for anything else.
        </p>
      </div>
    </section>

    <section class="px-5 pb-20">
      <div
        class="mx-auto max-w-xl rounded-2xl border border-[var(--pc-gray-border)] bg-white p-6 md:p-8"
      >
        <p
          v-if="status === 'success'"
          class="text-center text-sm font-medium text-pc-600"
          role="status"
        >
          Thanks. We have the note and will read it.
        </p>

        <form v-else class="flex flex-col gap-5" @submit.prevent="submit">
          <div>
            <label class="mb-1.5 block text-sm font-medium text-slate-700" for="feedback-email">
              Email
            </label>
            <UInput
              id="feedback-email"
              v-model="email"
              type="email"
              name="email"
              autocomplete="email"
              required
              placeholder="you@example.com"
              size="lg"
              class="w-full"
            />
          </div>

          <div>
            <p id="feedback-category-label" class="mb-2 text-sm font-medium text-slate-700">
              What is this about
            </p>
            <URadioGroup
              v-model="category"
              :items="categories"
              value-key="value"
              orientation="horizontal"
              aria-labelledby="feedback-category-label"
            />
          </div>

          <div>
            <div class="mb-1.5 flex items-baseline justify-between gap-3">
              <label class="text-sm font-medium text-slate-700" for="feedback-message">
                Message
              </label>
              <p class="text-xs text-slate-500" aria-live="polite">
                {{ messageLength }} / {{ MESSAGE_MAX }}
              </p>
            </div>
            <UTextarea
              id="feedback-message"
              v-model="message"
              name="message"
              required
              :maxlength="MESSAGE_MAX"
              :rows="7"
              autoresize
              placeholder="What happened, or what you wish the app did."
              class="w-full"
            />
          </div>

          <div>
            <div class="mb-1.5 flex items-baseline justify-between gap-3">
              <label class="text-sm font-medium text-slate-700" for="feedback-files">
                Screenshots
              </label>
              <p class="text-xs text-slate-500">
                {{ files.length }} / {{ ATTACHMENT_MAX }} · 5 MB each
              </p>
            </div>
            <p class="mb-2 text-xs leading-relaxed text-slate-500">
              Optional. JPEG, PNG, WebP, or GIF.
            </p>
            <input
              id="feedback-files"
              ref="fileInput"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              class="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-pc-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-pc-700 hover:file:bg-pc-100"
              :disabled="files.length >= ATTACHMENT_MAX || pending"
              @change="addFiles(($event.target as HTMLInputElement).files)"
            />
            <ul v-if="files.length" class="mt-3 grid grid-cols-5 gap-2">
              <li v-for="(preview, index) in files" :key="preview.url" class="relative">
                <img
                  :src="preview.url"
                  :alt="preview.file.name"
                  class="aspect-square w-full rounded-lg object-cover ring-1 ring-[var(--pc-gray-border)]"
                />
                <button
                  type="button"
                  class="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-slate-800 text-xs text-white"
                  :aria-label="`Remove ${preview.file.name}`"
                  @click="removeFile(index)"
                >
                  ×
                </button>
              </li>
            </ul>
          </div>

          <div class="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden="true">
            <label>
              Website
              <input v-model="website" type="text" name="website" tabindex="-1" autocomplete="off" />
            </label>
          </div>

          <UButton
            type="submit"
            color="primary"
            size="lg"
            :loading="pending"
            :disabled="!canSubmit"
          >
            Send
          </UButton>
        </form>

        <p
          v-if="errorText"
          class="mt-3 text-center text-sm text-red-600"
          role="alert"
        >
          {{ errorText }}
        </p>

        <p class="mt-5 text-center text-xs leading-relaxed text-slate-500">
          We keep the email, the category, the message, and any screenshots so we
          can follow up. Details on the
          <NuxtLink to="/privacy" class="text-pc-600 underline">Privacy</NuxtLink>
          page.
        </p>
      </div>
    </section>
  </div>
</template>
