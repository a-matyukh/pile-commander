<script setup lang="ts">
const { abuseEmail } = useSiteLegal()

useSeoMeta({
  title: "Support, reports, and DMCA",
  description:
    "Where to send account questions, abuse reports, copyright notices and counter-notices, and security reports for Pile Commander.",
})
</script>

<template>
  <LegalArticle title="Support, reports, and DMCA" updated="16 September 2026">
    <p>
      One address does all of it:
      <a :href="`mailto:${abuseEmail}`">{{ abuseEmail }}</a> — account
      questions, abuse reports, copyright notices, and security reports. It is a
      small team, so an answer can take a few business days; copyright notices
      and anything about a minor jump the queue.
    </p>

    <h2>Report a public workspace</h2>
    <p>
      Signed in, use Report on the Hub card or on the public workspace itself.
      The form takes up to 280 characters, you cannot report your own
      workspace, and there is a cap of 20 reports a day per account.
    </p>
    <p>
      Not signed in, send mail to the address above. Include the URL
      (<code>/username/slug</code>), what is wrong with it, and how we can reach
      you.
    </p>

    <h2>What happens after a report</h2>
    <p>
      Three reports from accounts older than seven days hide the Hub card and
      its cover image until a moderator looks at it; the owner is emailed when
      that happens. The public link keeps working until a moderator makes the
      workspace private, which is what we do when content is unlawful. Owners
      can appeal at the same address.
    </p>

    <h2>Copyright (DMCA)</h2>
    <p>
      Send a notice that identifies the work, the URL of the allegedly
      infringing workspace, your contact details, a statement that you have a
      good faith belief the use is not authorized, and a statement under penalty
      of perjury that you are the owner or authorized to act. We aim to review
      notices within two business days. Repeat infringement can lead to account
      termination. We may pass your notice, including your contact details, to
      the person who published the material.
    </p>

    <h2>Counter-notice</h2>
    <p>
      If we removed or hid something of yours and you believe that was a mistake
      or a misidentification, write to the same address with:
    </p>
    <ul>
      <li>your signature, physical or electronic;</li>
      <li>
        what was removed and where it was (the URL it had before it came down);
      </li>
      <li>
        a statement under penalty of perjury that you believe in good faith it
        was removed by mistake or misidentification;
      </li>
      <li>your name, address, and phone number;</li>
      <li>
        your consent to the jurisdiction of the federal court for the district
        of your address — or, if you are outside the United States, of any
        district in which we may be found — and that you will accept service of
        process from the person who sent the notice.
      </li>
    </ul>
    <p>
      We forward a valid counter-notice to the complainant. If they do not go to
      court, we may restore the material in 10 to 14 business days.
    </p>

    <h2>Account help</h2>
    <ul>
      <li>
        <strong>Getting your files out.</strong> In the desktop app, Export in
        the workspace menu writes the whole workspace — local or cloud — as a
        <code>.pile</code>. In the browser that item is off, because the writing
        is done by the desktop app. Someone else’s public workspace has
        Download as <code>.pile</code> instead, and only while its author leaves
        forks and downloads on.
      </li>
      <li>
        <strong>Deleting the account.</strong> It is in the app and it asks you
        to sign in again first — a stale session cannot delete an account.
      </li>
      <li>
        <strong>An invite that went nowhere.</strong> A pending invite expires
        after 14 days; the owner can simply send it again.
      </li>
      <li>
        <strong>Running into a limit.</strong> Free is 100 MB across your
        workspaces, desktops, and trash, one file up to 25 MB, and 3 Hub
        listings. A public link also has a monthly fair-use budget for what it
        serves to visitors. Details on
        <NuxtLink to="/pricing">Pricing</NuxtLink>.
      </li>
    </ul>

    <h2>Security reports</h2>
    <p>
      Found a way to read or change something you should not? Write to
      <a :href="`mailto:${abuseEmail}`">{{ abuseEmail }}</a> with the steps to
      reproduce it. Please test against your own account and your own data —
      not against other people’s workspaces — and give us a chance to fix it
      before you publish.
    </p>
  </LegalArticle>
</template>
