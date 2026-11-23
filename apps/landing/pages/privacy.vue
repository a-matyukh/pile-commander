<script setup lang="ts">
definePageMeta({ layout: "final" })

const { operatorName, operatorLocation, abuseEmail } = useSiteLegal()

useSeoMeta({
  title: "Privacy",
  description:
    "What Pile Commander stores, where it is stored, who else processes it (payments included), what other people can see, and how long it is kept.",
})
</script>

<template>
  <LegalArticle
    title="Privacy"
    updated="23 November 2026"
    note="Written against what the code actually does. It changes when the product does."
  >
    <p>
      The app on your computer needs no account and sends us nothing. This page
      is about the cloud service: what we store once you sign up, where it sits,
      and how to get rid of it.
    </p>

    <h2>Who is responsible</h2>
    <p>
      <a href="https://www.kmcn-lab.com/" target="_blank" rel="noopener noreferrer">{{ operatorName }}</a>, established in {{ operatorLocation }}, decides what is
      collected here and why. Questions, requests, complaints:
      <a :href="`mailto:${abuseEmail}`">{{ abuseEmail }}</a>.
    </p>

    <h2>What we store</h2>
    <ul>
      <li>
        <strong>Your account</strong> — email address, password (hashed; the
        sign-in system holds it, we never see it), username and display name if
        you set them.
      </li>
      <li>
        <strong>What you put in cloud folders</strong> — files, notes, ink,
        connectors, names, and file attributes.
      </li>
      <li>
        <strong>Sharing</strong> — the email addresses you type into an invite
        (a pending invite expires after 14 days), and who is a member of what,
        with their role.
      </li>
      <li>
        <strong>Hub publications</strong> — slug, description, tags, the cover image
        you upload, and how many times the folder was copied by others.
      </li>
      <li>
        <strong>Reports</strong> — who reported which publication and the text
        they wrote. Visible to moderators, not to other visitors.
      </li>
      <li>
        <strong>How the product is used</strong> — when an upload to the cloud
        starts, stalls, or finishes, and when you hit a storage or file-size
        ceiling: sizes, file counts, file types, and whatever you type into the
        free-text box on those screens. It is how the 100 MB and 25 MB numbers
        get decided without a survey.
      </li>
      <li>
        <strong>Metering</strong> — per day, the number of bytes served from
        your public folders to people they are not shared with, and the bytes
        your account downloads from other people’s public folders.
      </li>
      <li>
        <strong>Technical records</strong> — server logs and the counters that
        enforce rate limits, keyed by IP address. The fair-use share on a public
        link is counted per IPv4 address or IPv6 /64.
      </li>
      <li>
        <strong>Billing</strong> — if you buy a paid plan: the plan, monthly or
        yearly, its status (active, payment failed, canceled), the end of the
        current period, and the identifier of your subscription at Polar. We
        also log the billing events Polar sends us: their type and time, the
        subscription, its status, and the product. Card details go to Polar and
        Stripe; we never see them.
      </li>
      <li>
        <strong>Feedback</strong> — if you send a note from the app, we keep the email,
        the category (bug, idea, or other), the message, and any screenshots
        you attach (up to five), so we can read it and write back.
      </li>
    </ul>

    <h2>Where it is stored</h2>
    <p>
      The database and the sign-in system run on Supabase in Ireland
      (<code>eu-west-1</code>). The files in your cloud folders sit in a private Backblaze
      B2 bucket in the United States (<code>us-east-005</code>) and are served
      only through links that we sign for one reader at a time. Screenshots
      attached to a feedback note stay in the same Irish
      Supabase project as the note, not in that US bucket. By using the cloud
      service you accept that the files in your cloud folders are stored in the US.
    </p>

    <h2>Who else processes it</h2>
    <ul>
      <li>Supabase — database, accounts, live updates, and feedback screenshots (Ireland).</li>
      <li>Backblaze B2 — file storage (United States).</li>
      <li>Render — the API server.</li>
      <li>Vercel — hosting for the app and this site.</li>
      <li>Plunk — sign-in, invite, and moderation email.</li>
      <li>
        Polar — the merchant of record for paid plans: checkout, payments, sales
        tax and VAT, receipts, and the billing portal. When you start a
        checkout, we pass it your account’s email address and an internal
        account ID; what you enter at checkout goes to Polar directly. Polar
        processes cards through Stripe, and its own privacy policy covers that
        data.
      </li>
      <li>
        Have I Been Pwned — when a password is set or used to sign in, the
        sign-in system sends the first five characters of its SHA-1 hash there
        to reject known leaked passwords. The password itself is not sent.
      </li>
    </ul>
    <p>
      There are no advertising or analytics trackers on this site or in the app.
      We do not sell anything to anyone.
    </p>

    <h2>What other people see</h2>
    <p>
      A private cloud folder is visible to you and the people you share it
      with. An
      unlisted public link is visible to anyone who has the URL, live, as you
      keep writing. A Hub publication is visible in the public gallery, with your
      username and display name on it. Reports are not shown to other visitors.
    </p>
    <p>
      Two things are easy to miss. Everyone who shares a folder with you can
      see the email address of every other person in it, including yours. And
      preview images are generated only for folders that are public — a
      private one is never rendered on our servers.
    </p>

    <h2>Cookies and browser storage</h2>
    <p>
      The app keeps your sign-in session in your browser so you do not log in
      twice a day. This site stores one cookie for the light/dark setting. No
      third-party cookies, no tracking pixels.
    </p>

    <h2>How long we keep it</h2>
    <ul>
      <li>
        Trash: rows are removed for good 30 days after you delete them; the
        files behind them are cleared from storage a day or two later, which is
        also the window for undoing an accidental delete.
      </li>
      <li>Pending invites: 14 days, then the row goes.</li>
      <li>
        Over a plan’s limit: if an account is still over its limit 90 days after
        moving to a smaller plan or to Free, its cloud folders may be deleted,
        starting with those changed longest ago, until it fits. We write 30 days
        and 7 days before.
      </li>
      <li>
        Deleting a cloud folder deletes what is inside it. Deleting your account
        (in the app, after a fresh sign-in) removes the account and everything
        attached to it, including usage records and metering counters.
      </li>
      <li>
        Server logs: a short operational window. Backups at our providers
        linger a little longer.
      </li>
      <li>
        Feedback notes and their screenshots: until we have acted on them, or
        until you ask us to drop them.
      </li>
      <li>
        Billing: your plan and subscription details live as long as the account.
        The billing event log holds no card or contact details and stays after
        the account is deleted, for accounting and refunds. Polar keeps its
        payment records as long as tax and accounting law requires.
      </li>
    </ul>

    <h2>Your choices</h2>
    <p>
      You can read and correct your profile in the app, export a whole folder
      as a <code>.pile</code>, delete a cloud folder, and
      delete the account itself.
      For anything you cannot do from the app — a copy of what we hold, a
      correction, an objection, or a deletion you want confirmed — write to
      <a :href="`mailto:${abuseEmail}`">{{ abuseEmail }}</a>. If you are in the
      EU or the UK you also have the right to complain to your data protection
      authority.
    </p>

    <h2>Children</h2>
    <p>
      The service is not meant for anyone under 13, and where local law sets a
      higher age for agreeing to data processing, that age applies. If we learn
      an account belongs to someone younger, we delete it.
    </p>

    <h2>Security</h2>
    <p>
      Access is enforced in the database itself, row by row, not only in the
      app. The file bucket is private: downloads go through links that expire
      (15 minutes by default), and passwords are handled by the sign-in system,
      never stored by us. If you find a hole, the
      <NuxtLink to="/support">Support</NuxtLink> page says where to write.
    </p>

    <h2>Changes</h2>
    <p>
      When this page changes, the date at the top changes with it. For anything
      material we write to the address on your account.
    </p>
  </LegalArticle>
</template>
