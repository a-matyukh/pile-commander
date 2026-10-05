<script setup lang="ts">
const { operatorName, operatorLocation, governingLaw, abuseEmail } = useSiteLegal()

useSeoMeta({
  title: "Terms of use",
  description:
    "Terms of use for the Pile Commander cloud service: accounts, your content, limits, the Hub, and takedown.",
})
</script>

<template>
  <LegalArticle
    title="Terms of use"
    updated="16 September 2026"
    note="The cloud service is in beta. These terms will be revised before general availability."
  >
    <p>
      Pile Commander is a visual workspace. The app on your computer works
      without an account, and these terms do not govern what you do there. What
      follows covers the cloud service: workspaces you keep in the network,
      invites, public links, and optional listing on the Hub. It is not a
      general-purpose file host.
    </p>

    <h2>Who we are</h2>
    <p>
      The service is operated by {{ operatorName }}, established in
      {{ operatorLocation }}. Questions about these terms go to
      <a :href="`mailto:${abuseEmail}`">{{ abuseEmail }}</a>.
    </p>

    <h2>Accounts</h2>
    <p>
      You sign up with an email address and a password, and confirm the address
      before the account works. We also use it to carry the invites you send and
      to reach you about moderation. You must be at least 13, and old enough to
      agree to the processing of your data where you live — in much of the EU
      that is 16.
    </p>
    <p>
      You are responsible for what you upload and for who you invite. Do not
      share your password. You can delete the account in the app; it asks you to
      sign in again first. We may suspend an account that abuses the service or
      these terms.
    </p>

    <h2>Your content</h2>
    <p>
      What you upload stays yours. To run the service you let us store it, serve
      it to the people you share it with, keep the copies our providers hold in
      backups, and — for public workspaces only — generate preview images so
      visitors do not have to pull your originals.
    </p>
    <p>
      A public workspace is live: anyone with the link reads it as it is now,
      not a frozen copy. While “Allow forks and downloads” is on, visitors can
      copy that workspace into their own account or download it as a
      <code>.pile</code>. Taking a workspace off the Hub does not make it
      private — that is a separate switch in the app.
    </p>

    <h2>Prohibited content</h2>
    <p>
      You may not publish, share, or list on the Hub anything that is illegal
      where we operate, including (not only): child sexual abuse material;
      content that exploits or endangers minors; terrorist content; malware;
      non-consensual intimate imagery; doxxing; or material that infringes
      someone else’s copyright, trademark, or other rights.
    </p>

    <h2>Abuse of the service</h2>
    <p>
      Spam, phishing, and using the Hub as free file hosting for strangers are
      forbidden. So is working around the limits: bulk-downloading other
      people’s public workspaces, scripting the app to dodge quotas, rate
      limits, or the fair-use meter on public links, or opening extra accounts
      for the same purpose.
    </p>

    <h2>Limits and fair use</h2>
    <p>
      Free gives one account 100 MB across its workspaces, desktops, and trash;
      a single file up to 25 MB; and 3 Hub listings. Serving a public workspace
      to people who are not its members is metered per month against the
      owner’s allowance, and requests are rate-limited.
    </p>
    <p>
      We may change these numbers as the beta teaches us what they should be. We
      will not silently lock or delete what you have already uploaded. Paid
      plans open after the beta and sit next to Free; there is nothing to pay
      today, and no card is stored.
    </p>

    <h2>Reports, hiding, and takedown</h2>
    <p>
      We do not pre-moderate. Signed-in visitors can report a listed workspace
      from the app; anonymous reports and copyright notices go to the address on
      the <NuxtLink to="/support">Support</NuxtLink> page.
    </p>
    <p>
      Three reports from accounts older than seven days hide a Hub card until a
      moderator looks at it, and the owner is emailed. Hiding a card does not by
      itself take down the public link: we make a workspace private when its
      content is unlawful or a moderator decides it has to go. You can appeal by
      writing to that same address.
    </p>

    <h2>Suspension and termination</h2>
    <p>
      We can hide a listing, make a workspace private, or suspend an account
      that breaks these terms. Repeat copyright infringement ends the account.
      You can stop whenever you like: delete a workspace, or the whole account,
      in the app.
    </p>

    <h2>Beta, availability, and changes</h2>
    <p>
      The cloud service is in beta. It carries no uptime promise and it is not a
      backup service — keep your own copy of anything you cannot lose. The app
      on your computer works offline for exactly that reason. Features and
      limits will change while the beta runs.
    </p>
    <p>
      We may change these terms. The date at the top moves, and for anything
      material we write to the address on your account. Using the service after
      that is acceptance.
    </p>

    <h2>No warranty, and what we owe you</h2>
    <p>
      The service is provided as is, without warranties of any kind. To the
      extent the law allows, we are not liable for lost data, lost profits, or
      indirect damages, and our total liability for a service you pay nothing
      for is limited to what you have paid for it. Nothing here removes consumer
      rights that cannot be waived where you live.
    </p>

    <h2>Governing law and contact</h2>
    <p>
      These terms are governed by the law of {{ governingLaw }}. Questions:
      <a :href="`mailto:${abuseEmail}`">{{ abuseEmail }}</a>. How we handle your
      data is a separate page: <NuxtLink to="/privacy">Privacy</NuxtLink>.
    </p>
  </LegalArticle>
</template>
