<script setup lang="ts">
definePageMeta({ layout: "final" })

const { clientUrl, desktopAppLink } = useAppLinks();

/**
 * The page's copy of the grid (pile-commander-product, «Монетизация/План
 * запуска тарифов.md»). Polar holds the prices people pay and
 * private.plan_defaults the limits; change all three together.
 */
type Interval = "year" | "month";

/** Until Polar approves the account the paid buttons lead to sign-up */
const PAYMENTS_OPEN = false;

/** One file size on every paid plan (the plan's open question 1) */
const PAID_FILE = "1 GB";

const interval = ref<Interval>("year");

/**
 * Every card names its room first, on a line of its own with the number in
 * bold, then "Everything in Pro" where a plan has it: the room is what the
 * plans differ in
 */
type Plan = {
  id: string;
  name: string;
  tagline: string;
  month: number;
  year: number;
  storage: string;
  inherits?: string;
  feats: string[];
};

/** What every cloud plan has: chips above the grid, so the cards list only what differs */
const everyPlan = [
  { icon: "i-tabler-devices", text: "Your cloud folders on all your devices" },
  { icon: "i-tabler-refresh", text: "In sync with folders on your disk" },
  { icon: "i-tabler-users", text: "Shared with people" },
  { icon: "i-tabler-link", text: "Published by link" },
];

const free = {
  storage: "100 MB",
  feats: ["Files up to 25 MB", "Publish up to 3 folders on the Hub"],
};

const paid: Plan[] = [
  {
    id: "pro",
    name: "Pro",
    tagline: "Your everyday folders",
    month: 10,
    year: 96,
    storage: "50 GB",
    feats: [`Files up to ${PAID_FILE}`, "Publish on the Hub without a limit"],
  },
  {
    id: "studio",
    name: "Studio",
    tagline: "Image-heavy work",
    month: 16,
    year: 156,
    storage: "200 GB",
    inherits: "Everything in Pro",
    feats: [],
  },
  {
    id: "max",
    name: "Max",
    tagline: "Large media libraries",
    month: 24,
    year: 228,
    storage: "500 GB",
    inherits: "Everything in Pro",
    feats: [],
  },
];

/** Under the grid, a card of its own: the most room, not a fifth column */
const ultra: Plan = {
  id: "ultra",
  name: "Ultra",
  tagline: "The largest libraries",
  month: 36,
  year: 348,
  storage: "1 TB",
  inherits: "Everything in Pro",
  feats: [],
};

/** The big number: a month's price, for a year it is the year split by 12 */
function perMonth(plan: { month: number; year: number }) {
  return interval.value === "year" ? plan.year / 12 : plan.month;
}

function money(value: number) {
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

function billed(plan: { year: number }) {
  return interval.value === "year" ? `billed yearly, $${plan.year}` : "billed monthly";
}

/** Sign-up for now; once PAYMENTS_OPEN, the app link that starts the checkout */
const paidHref = clientUrl;

const notes = [
  {
    icon: "i-lucide-user-check",
    title: "The owner pays",
    body: "The people you share a folder with don't need a plan of their own.",
  },
  {
    icon: "i-lucide-calendar-check",
    title: "Cancel anytime",
    body: "Your plan runs to the end of the period you paid for, then you're on Free.",
  },
  {
    icon: "i-lucide-undo-2",
    title: "14-day refund",
    body: "Changed your mind? Ask within 14 days of your first payment and we'll refund it in full.",
  },
  {
    icon: "i-lucide-shield-check",
    title: "Nothing is deleted right away",
    body: "Over the limit after a downgrade, your files stay for 90 days, and we email you before anything is removed.",
  },
];

const faq = [
  {
    q: "Why is local storage free?",
    a: "Files in your home folder on your computer, or in the browser's storage in the web app, cost us nothing to keep. Working with them is free for good and needs no account. You pay only for the room your files take in our cloud.",
  },
  {
    q: "What counts toward my storage?",
    a: "Everything in your cloud folders, including the trash, which keeps files for 30 days. Folders that others share with you count toward their owner's plan, not yours.",
  },
  {
    q: "What if I use more than my plan allows?",
    a: "Nothing is deleted right away. You can open, download, move and delete your files; you can't add new ones until you're back under the limit or move to a bigger plan. If you're still over the limit 90 days after a downgrade, we may delete the folders changed longest ago until the account fits, and we email you 30 days and 7 days before.",
  },
  {
    q: "Can I change plans later?",
    a: "Yes, any time. A bigger plan starts right away, and you pay the difference for the rest of the period. A smaller one starts with your next billing period.",
  },
  {
    q: "What if a payment fails?",
    a: "Your plan stays while the payment is retried, for up to three weeks. You can update your card in the billing portal at any time. If it still doesn't go through, the account moves to Free, and nothing is deleted right away.",
  },
  {
    q: "Can I get a refund?",
    a: "Yes — ask within 14 days of your first payment and we'll refund it. Renewals aren't refunded, but you can cancel any time and keep the plan to the end of the period.",
  },
  {
    q: "Who handles payments and taxes?",
    a: "Polar, our merchant of record. They take the payment, send the receipt and handle sales tax and VAT. Prices are in US dollars; the tax for your country is shown at checkout.",
  },
];

useSeoMeta({
  title: "Pricing",
  description:
    "Local storage is free: your home folder on your computer or the browser's storage. You pay only for the cloud: Free with 100 MB, Pro with 50 GB from $8 a month, Studio with 200 GB, Max with 500 GB, Ultra with 1 TB.",
  ogTitle: "Pricing — Pile Commander",
  ogDescription:
    "Local storage is free. You pay only for the cloud, with more room from $8 a month.",
  ogImage: "/app-icon.png",
  twitterCard: "summary",
});
</script>

<template>
  <div class="lf-page">
    <div class="lf-wrap">
      <header class="head">
        <h1 class="rule">Local storage is free. You pay only for the cloud.</h1>

        <div class="split">
          <section class="half" aria-labelledby="local-title">
            <div class="half-top">
              <span class="ptile free"><UIcon name="i-tabler-device-desktop" class="pti" /></span>
              <span class="ptile free"><UIcon name="i-tabler-database" class="pti" /></span>
              <span class="tag free">Free forever</span>
            </div>
            <h2 id="local-title" class="half-h">Local storage</h2>
            <p class="half-b">The home folder on your computer, or the browser's storage in the web app. No account needed.</p>
            <div class="half-acts">
              <NuxtLink v-bind="desktopAppLink" class="lf-btn lf-btn-sm lf-btn-secondary">
                <UIcon name="i-lucide-download" class="size-[1.05em]" />
                Download
              </NuxtLink>
              <a :href="clientUrl" target="_blank" rel="noopener noreferrer" class="lf-btn lf-btn-sm lf-btn-secondary">Open web app</a>
            </div>
          </section>
          <section class="half" aria-labelledby="cloud-tile-title">
            <div class="half-top">
              <span class="ptile paid"><UIcon name="i-tabler-cloud" class="pti" /></span>
              <span class="tag paid">100 MB free</span>
            </div>
            <h2 id="cloud-tile-title" class="half-h">Cloud</h2>
            <p class="half-b">Your cloud folders on all your devices, kept in sync with folders on your disk, shared with people and published by link. More room from $8 a month.</p>
            <div class="half-acts">
              <a href="#plans" class="lf-btn lf-btn-sm lf-btn-secondary">
                See plans
                <UIcon name="i-lucide-arrow-down" class="size-[1.05em]" />
              </a>
            </div>
          </section>
        </div>
      </header>

      <section id="plans" class="cloud" aria-labelledby="cloud-title">
        <div class="cloud-head">
          <h2 id="cloud-title" class="cloud-h">In the cloud</h2>
          <div class="every">
            <p id="every-label" class="every-label">On all plans</p>
            <ul class="every-list" aria-labelledby="every-label">
              <li v-for="item in everyPlan" :key="item.text" class="every-chip">
                <UIcon :name="item.icon" class="every-i" />{{ item.text }}
              </li>
            </ul>
          </div>
          <fieldset class="toggle">
            <legend class="sr-only">Billing period</legend>
            <label :class="{ on: interval === 'year' }">
              <input v-model="interval" type="radio" name="interval" value="year">
              Yearly <span class="save">save 20%</span>
            </label>
            <label :class="{ on: interval === 'month' }">
              <input v-model="interval" type="radio" name="interval" value="month">
              Monthly
            </label>
          </fieldset>
          <p v-if="!PAYMENTS_OPEN" class="soon">
            <UIcon name="i-lucide-clock" class="soon-i" />
            Paid plans open in the next few days. Start on Free — everything you upload stays when you upgrade.
          </p>
        </div>

        <div class="plans">
          <article class="lf-card plan">
            <p class="pname">Free</p>
            <p class="tagline">To try the cloud</p>
            <p class="price"><span class="amt">$0</span></p>
            <p class="lf-small per">A lasting plan, not a trial</p>
            <a :href="clientUrl" target="_blank" rel="noopener noreferrer" class="lf-btn lf-btn-secondary cta">Open web app</a>
            <ul class="feats">
              <li class="room">
                <span class="room-chip"><UIcon name="i-tabler-cloud" class="room-i" />{{ free.storage }}</span>
                <span>in the cloud</span>
              </li>
              <li v-for="item in free.feats" :key="item">
                <UIcon name="i-lucide-check" class="ck" />
                <span>{{ item }}</span>
              </li>
            </ul>
          </article>

          <article v-for="plan in paid" :key="plan.id" class="lf-card plan">
            <p class="pname">{{ plan.name }}</p>
            <p class="tagline">{{ plan.tagline }}</p>
            <p class="price">
              <span class="amt">{{ money(perMonth(plan)) }}</span>
              <span class="unit">/ month</span>
            </p>
            <p class="lf-small per">{{ billed(plan) }}</p>
            <a :href="paidHref" target="_blank" rel="noopener noreferrer" class="lf-btn lf-btn-primary cta">Get {{ plan.name }}</a>
            <ul class="feats">
              <li class="room">
                <span class="room-chip"><UIcon name="i-tabler-cloud" class="room-i" />{{ plan.storage }}</span>
                <span>in the cloud</span>
              </li>
              <li v-if="plan.inherits">
                <UIcon name="i-lucide-check" class="ck" />
                <span>{{ plan.inherits }}</span>
              </li>
              <li v-for="item in plan.feats" :key="item">
                <UIcon name="i-lucide-check" class="ck" />
                <span>{{ item }}</span>
              </li>
            </ul>
          </article>
        </div>

        <article class="lf-card ultra">
          <div class="u-name">
            <p class="pname">{{ ultra.name }}</p>
            <p class="tagline">{{ ultra.tagline }}</p>
          </div>
          <div class="u-price">
            <p class="price">
              <span class="amt">{{ money(perMonth(ultra)) }}</span>
              <span class="unit">/ month</span>
            </p>
            <p class="lf-small per">{{ billed(ultra) }}</p>
          </div>
          <ul class="feats">
            <li class="room">
              <span class="room-chip"><UIcon name="i-tabler-cloud" class="room-i" />{{ ultra.storage }}</span>
              <span>in the cloud</span>
            </li>
            <li>
              <UIcon name="i-lucide-check" class="ck" />
              <span>{{ ultra.inherits }}</span>
            </li>
          </ul>
          <a :href="paidHref" target="_blank" rel="noopener noreferrer" class="lf-btn lf-btn-primary cta">Get {{ ultra.name }}</a>
        </article>
      </section>

      <ul class="notes">
        <li v-for="note in notes" :key="note.title" class="note">
          <span class="nic"><UIcon :name="note.icon" class="nii" /></span>
          <span>
            <span class="nt">{{ note.title }}</span>
            <span class="nb">{{ note.body }}</span>
          </span>
        </li>
      </ul>

      <section class="faq" aria-labelledby="faq-title">
        <h2 id="faq-title" class="faq-h">Questions</h2>
        <details v-for="item in faq" :key="item.q" class="qa">
          <summary>
            <span>{{ item.q }}</span>
            <UIcon name="i-lucide-chevron-down" class="chev" />
          </summary>
          <p>{{ item.a }}</p>
        </details>
      </section>
    </div>
  </div>
</template>

<style scoped>
.lf-page {
  --free-bg: rgb(22 163 74 / 0.1);
  --free-ink: #15803d;
  --paid-bg: rgb(36 83 255 / 0.08);
  --paid-ink: var(--lf-accent);
}

/* The header: one line of the rule, then two tiles — free and the cloud */
.head {
  max-width: 60rem;
  margin: 0 auto;
  text-align: center;
}

.rule {
  margin: 0;
  color: var(--lf-ink);
  font-size: clamp(1.0625rem, 1.6vw, 1.25rem);
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.45;
  text-wrap: balance;
}

.split {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  margin-top: 1.75rem;
  text-align: left;
}

@media (max-width: 700px) {
  .split {
    grid-template-columns: minmax(0, 1fr);
  }
}

.half {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--lf-line-strong);
  border-radius: 12px;
  background: var(--lf-surface);
  padding: 1.25rem;
}

.half-top {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.half-top .tag {
  margin-left: auto;
}

.ptile {
  display: inline-grid;
  width: 2.75rem;
  height: 2.75rem;
  flex: none;
  place-items: center;
  border-radius: 10px;
}

.ptile.free {
  background: var(--free-bg);
  color: var(--free-ink);
}

.ptile.paid {
  background: var(--paid-bg);
  color: var(--paid-ink);
}

.pti {
  width: 1.4rem;
  height: 1.4rem;
}

.tag {
  display: inline-block;
  border-radius: 99em;
  padding: 0.15rem 0.6rem;
  font-size: 0.8125rem;
  font-weight: 600;
  white-space: nowrap;
}

.tag.free {
  background: var(--free-bg);
  color: var(--free-ink);
}

.tag.paid {
  background: var(--paid-bg);
  color: var(--paid-ink);
}

.half-h {
  margin: 1rem 0 0;
  font-size: 1.125rem;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.half-b {
  flex: 1;
  margin: 0.35rem 0 0;
  color: var(--lf-ink-2);
  font-size: 0.9375rem;
  line-height: 1.5;
}

.half-acts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 1rem;
}

/* The cloud: its title, what every plan has, Yearly / Monthly, and the note
   while payments are not open yet */
.cloud-head {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin: clamp(2.75rem, 5vw, 3.75rem) auto 1.5rem;
  text-align: center;
}

.cloud-h {
  margin: 0;
  font-size: clamp(1.75rem, 3vw, 2.25rem);
  font-weight: 700;
  letter-spacing: -0.025em;
  line-height: 1.1;
}

/* What every cloud plan has: "On all plans", then white chips with an
   accent icon each; the label goes above the chips when they wrap */
.every {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0.5rem 0.75rem;
  width: 100%;
  max-width: 72rem;
  margin: 1.25rem 0 0;
}

.every-label {
  margin: 0;
  color: var(--lf-ink-2);
  font-size: 0.9375rem;
  font-weight: 600;
}

.every-list {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.every-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  border: 1px solid var(--lf-line-strong);
  border-radius: 99em;
  background: var(--lf-surface);
  padding: 0.35rem 0.85rem 0.35rem 0.7rem;
  color: var(--lf-ink);
  font-size: 0.9375rem;
  font-weight: 500;
  line-height: 1.3;
}

.every-i {
  width: 1.05rem;
  height: 1.05rem;
  flex: none;
  color: var(--lf-accent);
}

.toggle {
  display: inline-flex;
  margin: 1.5rem 0 0;
  border: 1px solid var(--lf-line-strong);
  border-radius: 999px;
  background: var(--lf-surface);
  padding: 0.25rem;
}

.toggle label {
  display: inline-flex;
  min-height: 2.25rem;
  align-items: center;
  gap: 0.4rem;
  border-radius: 999px;
  padding: 0 1rem;
  color: var(--lf-ink-2);
  font-size: 0.9375rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.toggle label.on {
  background: var(--lf-ink);
  color: #fff;
}

.toggle label:has(input:focus-visible) {
  outline: 2px solid var(--lf-accent);
  outline-offset: 2px;
}

.toggle input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.save {
  border-radius: 99em;
  background: rgb(36 83 255 / 0.1);
  padding: 0.05rem 0.45rem;
  color: var(--lf-accent);
  font-size: 0.75rem;
  font-weight: 600;
}

.toggle label.on .save {
  background: rgb(255 255 255 / 0.18);
  color: #fff;
}

.soon {
  display: inline-flex;
  align-items: flex-start;
  gap: 0.5rem;
  max-width: 40rem;
  margin: 0.875rem 0 0;
  color: var(--lf-ink-2);
  font-size: 0.9375rem;
  line-height: 1.45;
  text-align: left;
}

.soon-i {
  width: 1.05rem;
  height: 1.05rem;
  flex: none;
  margin-top: 0.15rem;
  color: var(--lf-accent);
}

/* Four cards; two by two on a tablet, one column on a phone */
.plans {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1rem;
  max-width: 72rem;
  margin-inline: auto;
}

@media (max-width: 1080px) {
  .plans {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 600px) {
  .plans {
    grid-template-columns: minmax(0, 1fr);
  }
}

.plan {
  display: flex;
  flex-direction: column;
}

.pname {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.tagline {
  margin: 0.2rem 0 0;
  color: var(--lf-ink-2);
  font-size: 0.9375rem;
}

.price {
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
  margin: 1.25rem 0 0.15rem;
}

.amt {
  font-size: 2.5rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
  line-height: 1.1;
}

.unit {
  color: var(--lf-ink-2);
  font-size: 0.9375rem;
  font-weight: 500;
}

.per {
  min-height: 1.3em;
}

.cta {
  margin-top: 1.25rem;
}

.feats {
  display: grid;
  flex: 1;
  align-content: start;
  gap: 0.65rem;
  margin: 1.25rem 0 0;
  border-top: 1px solid var(--lf-line);
  padding: 1.25rem 0 0;
  list-style: none;
  color: var(--lf-ink-2);
  font-size: 0.9375rem;
  line-height: 1.45;
}

.feats li {
  display: flex;
  gap: 0.55rem;
}

.ck {
  width: 1.1rem;
  height: 1.1rem;
  flex: none;
  margin-top: 0.1rem;
  color: var(--lf-accent);
}

/* The room of a plan: the amount with the cloud on a blue chip, the words
   after it with some air */
.room {
  align-items: center;
  gap: 0.75rem;
}

.room-chip {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 0.35rem;
  border: 1px solid rgb(36 83 255 / 0.18);
  border-radius: 8px;
  background: var(--paid-bg);
  padding: 0.2rem 0.6rem 0.2rem 0.5rem;
  color: var(--paid-ink);
  font-size: 1.0625rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
  line-height: 1.25;
  white-space: nowrap;
}

.room-i {
  width: 1.05rem;
  height: 1.05rem;
}

/* Ultra: a white card under the grid, its parts in the grid's four columns */
.ultra {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  align-items: center;
  gap: 1rem;
  max-width: 72rem;
  margin: 1rem auto 0;
}

.ultra .price {
  margin-top: 0;
}

.ultra .feats {
  margin: 0;
  border-top: 0;
  padding: 0;
}

.ultra .cta {
  margin-top: 0;
}

@media (max-width: 1080px) {
  .ultra {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    row-gap: 1.25rem;
  }
}

@media (max-width: 600px) {
  .ultra {
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
  }

  .ultra .price {
    margin-top: 1.25rem;
  }

  .ultra .cta {
    margin-top: 1.25rem;
  }

  .ultra .feats {
    order: 1;
    margin-top: 1.25rem;
    border-top: 1px solid var(--lf-line);
    padding-top: 1.25rem;
  }
}

/* The notes: as the landing's facts, an icon tile and two lines */
.notes {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1.5rem;
  max-width: 72rem;
  margin: clamp(2.5rem, 5vw, 3.5rem) auto 0;
  padding: 0;
  list-style: none;
}

@media (max-width: 1080px) {
  .notes {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 600px) {
  .notes {
    grid-template-columns: minmax(0, 1fr);
  }
}

.note {
  display: flex;
  gap: 0.875rem;
}

.nic {
  display: grid;
  width: 2.25rem;
  height: 2.25rem;
  flex: none;
  place-items: center;
  border: 1px solid var(--lf-line-strong);
  border-radius: 8px;
  background: var(--lf-surface);
}

.nii {
  width: 1.15rem;
  height: 1.15rem;
}

.nt {
  display: block;
  font-weight: 600;
}

.nb {
  display: block;
  margin-top: 0.2rem;
  color: var(--lf-ink-2);
  font-size: 0.9375rem;
  line-height: 1.5;
}

/* Questions: one white card of rows that open */
.faq {
  max-width: 46rem;
  margin: clamp(3rem, 6vw, 4.5rem) auto 0;
}

.faq-h {
  margin: 0 0 1rem;
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  text-align: center;
}

.qa {
  border: 1px solid var(--lf-line-strong);
  border-bottom-width: 0;
  background: var(--lf-surface);
}

.qa:first-of-type {
  border-radius: 12px 12px 0 0;
}

.qa:last-of-type {
  border-bottom-width: 1px;
  border-radius: 0 0 12px 12px;
}

.qa summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.25rem;
  font-weight: 600;
  list-style: none;
  cursor: pointer;
}

.qa summary::-webkit-details-marker {
  display: none;
}

.qa summary:focus-visible {
  outline: 2px solid var(--lf-accent);
  outline-offset: -2px;
}

.chev {
  width: 1.1rem;
  height: 1.1rem;
  flex: none;
  color: var(--lf-ink-3);
  transition: transform 0.15s ease;
}

.qa[open] .chev {
  transform: rotate(180deg);
}

.qa p {
  margin: 0;
  padding: 0 1.25rem 1.1rem;
  color: var(--lf-ink-2);
  font-size: 0.9375rem;
  line-height: 1.55;
}

@media (prefers-reduced-motion: reduce) {
  .toggle label,
  .chev {
    transition: none;
  }
}
</style>
