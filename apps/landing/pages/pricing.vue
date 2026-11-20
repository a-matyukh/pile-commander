<script setup lang="ts">
definePageMeta({ layout: "final" })

const { clientUrl, desktopAppLink } = useAppLinks();

useSeoMeta({
  title: "Pricing",
  description:
    "Local use is free forever. Cloud Free is 100 MB, files up to 25 MB, invites, unlisted links, and Hub for up to 3 workspaces. Paid plans will sit next to Free later.",
  ogTitle: "Pricing — Pile Commander",
  ogDescription:
    "Work on your computer for free. Cloud Free is a lasting plan — paid tiers open after beta.",
  ogImage: "/app-icon.png",
  twitterCard: "summary",
});

const localFeatures = [
  "Everything the app can do without the cloud",
  "No account required",
  "Your files stay on your computer",
];

const cloudFeatures = [
  "100 MB in the cloud (workspaces and trash)",
  "Files up to 25 MB",
  "Your own cloud workspaces",
  "Invite people and join other workspaces",
  "Unlisted public live link",
  "Hub — up to 3 workspaces",
];

const notes = [
  {
    icon: "i-lucide-user-check",
    title: "The owner pays",
    body: "The person who owns the workspace pays. Invited people do not need their own plan.",
  },
  {
    icon: "i-lucide-shield-check",
    title: "Nothing gets locked",
    body: "Paid plans will open after this beta and sit next to Free. We will not silently lock or delete what you uploaded.",
  },
  {
    icon: "i-lucide-infinity",
    title: "Free stays",
    body: "Free is a lasting plan, not a beta trial. 100 MB across workspaces and trash; one original up to 25 MB.",
  },
];
</script>

<template>
  <div class="lf-page">
    <div class="lf-wrap">
      <header class="lf-page-head">
        <p class="badge"><span class="bdot" />Local and Cloud Free stay free after beta</p>
        <h1 class="lf-page-title">Free on your computer. Cloud when you need it.</h1>
        <p class="lf-lede">
          Work on your computer without an account, or sign in for a free
          cloud plan. Paid plans will sit next to them after beta — we are
          not quoting their prices yet.
        </p>
      </header>

      <div class="plans">
        <article class="lf-card plan">
          <span class="pic"><UIcon name="i-lucide-laptop" class="pii" /></span>
          <p class="pname">On your computer or browser</p>
          <p class="price">Free</p>
          <p class="lf-small">Always, no account</p>
          <ul class="feats">
            <li v-for="item in localFeatures" :key="item">
              <UIcon name="i-lucide-check" class="ck" />
              <span>{{ item }}</span>
            </li>
          </ul>
          <div class="acts">
            <NuxtLink v-bind="desktopAppLink" class="lf-btn lf-btn-primary">
              <UIcon name="i-lucide-download" class="size-[1.1em]" />
              Download desktop app
            </NuxtLink>
            <a :href="clientUrl" target="_blank" rel="noopener noreferrer" class="lf-btn lf-btn-secondary">Open web app</a>
          </div>
        </article>

        <article class="lf-card plan">
          <span class="pic accent"><UIcon name="i-lucide-cloud" class="pii" /></span>
          <p class="pname accent">Cloud Free</p>
          <p class="price">Free</p>
          <p class="lf-small">A lasting plan, not a trial</p>
          <ul class="feats">
            <li v-for="item in cloudFeatures" :key="item">
              <UIcon name="i-lucide-check" class="ck" />
              <span>{{ item }}</span>
            </li>
          </ul>
          <div class="acts">
            <a :href="clientUrl" target="_blank" rel="noopener noreferrer" class="lf-btn lf-btn-primary">Open web app</a>
          </div>
        </article>

        <article class="paid">
          <div class="paid-text">
            <span class="pic"><UIcon name="i-lucide-sparkles" class="pii" /></span>
            <div>
              <div class="paid-h">
                <h2 class="ph2">Paid plans</h2>
                <span class="chip">After beta</span>
              </div>
              <p class="pp">
                We will announce them after beta. Leave your email and we will
                write when they are ready — nothing else.
              </p>
            </div>
          </div>
          <PricingNotifyForm />
        </article>
      </div>

      <ul class="notes">
        <li v-for="note in notes" :key="note.title" class="note">
          <span class="nic"><UIcon :name="note.icon" class="nii" /></span>
          <span>
            <span class="nt">{{ note.title }}</span>
            <span class="nb">{{ note.body }}</span>
          </span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 1.25rem;
  border: 1px solid var(--lf-line-strong);
  border-radius: 99em;
  background: var(--lf-surface);
  padding: 0.3rem 0.8rem;
  color: var(--lf-ink-2);
  font-size: 0.8125rem;
  font-weight: 500;
}

.bdot {
  width: 0.4rem;
  height: 0.4rem;
  border-radius: 50%;
  background: var(--lf-accent);
}

.plans {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1.25rem;
  max-width: 64rem;
}

@media (max-width: 760px) {
  .plans {
    grid-template-columns: minmax(0, 1fr);
  }
}

.plan {
  display: flex;
  flex-direction: column;
}

.pic {
  display: grid;
  width: 2.5rem;
  height: 2.5rem;
  flex: none;
  place-items: center;
  border: 1px solid var(--lf-line);
  border-radius: 10px;
  background: var(--lf-bg);
  color: var(--lf-ink-2);
}

.pic.accent {
  border-color: rgb(36 83 255 / 0.2);
  background: rgb(36 83 255 / 0.06);
  color: var(--lf-accent);
}

.pii {
  width: 1.25rem;
  height: 1.25rem;
}

.pname {
  margin: 1.25rem 0 0;
  color: var(--lf-ink-2);
  font-size: 0.9375rem;
  font-weight: 600;
}

.pname.accent {
  color: var(--lf-accent);
}

.price {
  margin: 0.4rem 0 0.15rem;
  font-size: 2.5rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.1;
}

.feats {
  display: grid;
  flex: 1;
  align-content: start;
  gap: 0.7rem;
  margin: 1.5rem 0 0;
  border-top: 1px solid var(--lf-line);
  padding: 1.5rem 0 0;
  list-style: none;
  color: var(--lf-ink-2);
  font-size: 0.9375rem;
  line-height: 1.45;
}

.feats li {
  display: flex;
  gap: 0.6rem;
}

.ck {
  width: 1.1rem;
  height: 1.1rem;
  flex: none;
  margin-top: 0.1rem;
  color: var(--lf-accent);
}

.acts {
  display: grid;
  gap: 0.6rem;
  margin-top: 2rem;
}

/* Paid plans: not here yet, so a dashed card on the page's gray */
.paid {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: minmax(0, 1fr) minmax(0, 22rem);
  align-items: center;
  gap: 2rem 3rem;
  border: 1px dashed rgb(0 0 0 / 0.25);
  border-radius: 12px;
  padding: clamp(1.25rem, 3vw, 2rem);
}

@media (max-width: 760px) {
  .paid {
    grid-template-columns: minmax(0, 1fr);
  }
}

.paid-text {
  display: flex;
  gap: 1.25rem;
}

.paid .pic {
  background: var(--lf-surface);
}

.paid-h {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}

.ph2 {
  margin: 0;
  font-size: 1.3rem;
  font-weight: 700;
  letter-spacing: -0.015em;
}

.chip {
  border: 1px solid var(--lf-line-strong);
  border-radius: 99em;
  background: var(--lf-surface);
  padding: 0.15rem 0.65rem;
  color: var(--lf-ink-2);
  font-size: 0.75rem;
  font-weight: 600;
}

.pp {
  max-width: 28rem;
  margin: 0.5rem 0 0;
  color: var(--lf-ink-2);
  font-size: 0.9375rem;
  line-height: 1.5;
}

/* The notes: as the landing's facts, an icon tile and two lines */
.notes {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1.5rem;
  max-width: 64rem;
  margin: clamp(2.5rem, 5vw, 3.5rem) 0 0;
  padding: 0;
  list-style: none;
}

@media (max-width: 900px) {
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
</style>
