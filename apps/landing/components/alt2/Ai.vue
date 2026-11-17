<!-- ② AI. The action names are the app's own (AiItems.vue): verb and object.
     Two ways in: a model the person connects (any OpenAI-compatible API,
     services/ai/presets.ts), or an agent through the desktop app's MCP server
     (macOS and Linux; it renames, adds notes and sorts, but has no tool to
     summarize). -->
<script setup lang="ts">
const providers = ["OpenAI", "OpenRouter", "DeepSeek", "Fireworks", "Ollama", "LM Studio", "Any OpenAI-compatible server"];

const facts = [
  {
    title: "Your OK first",
    text: "Names come as a list of old and new, ideas as cards on the board, folders as a plan with checkboxes. What you accept is ordinary files.",
  },
  {
    title: "Asks before the cloud",
    text: "A model on your computer sends nothing out. A cloud provider asks once before names and notes go, and again before images.",
  },
  {
    title: "Keys stay put",
    text: "In the desktop app the key goes to the system's password storage. In a browser it lives only in the open tab.",
  },
];
</script>

<template>
  <Alt2Section
    id="ai"
    :n="2"
    label="AI"
    title="AI with your model, or your agent."
    lede="Four actions in every folder: Rename files by content, Summarize this folder, Generate ideas, Sort into folders. Run them on any OpenAI-compatible model you connect, or let an agent like Claude or Cursor rename, add ideas and sort through the app's MCP server. You see a preview first, and nothing changes until you confirm."
    :facts="facts"
  >
    <Alt2AiScene />

    <div class="ways">
      <article class="way">
        <p class="way-label"><UIcon name="i-lucide-plug" class="size-4" />Your model</p>
        <h3 class="a2-h3">Connect a provider, or a model on your computer.</h3>
        <p class="way-text">
          In Settings → AI, pick a provider, add its key and press Test
          connection. A model that runs on your own computer needs no key.
        </p>
        <ul class="chips">
          <li v-for="provider in providers" :key="provider" class="chip">{{ provider }}</li>
        </ul>
        <p class="a2-small">In the desktop app and in the browser. Ollama and LM Studio work in the desktop app.</p>
        <Alt2ModelSettings />
      </article>

      <article class="way">
        <p class="way-label"><UIcon name="i-lucide-terminal" class="size-4" />Your agent</p>
        <h3 class="a2-h3">Let Claude or Cursor work on your folders.</h3>
        <p class="way-text">
          Turn on Agent access and add the app's config to Claude Desktop,
          Claude Code or Cursor. The agent reads your bookmarked folders and
          proposes new names, notes and folders. Each proposal opens in the
          app for you to confirm.
        </p>
        <Alt2AgentChat />
        <p class="a2-small agent-note">The desktop app on macOS and Linux, with folders on your disk.</p>
      </article>
    </div>
  </Alt2Section>
</template>

<style scoped>
.ways {
  display: grid;
  gap: 1.25rem;
  margin-top: clamp(2rem, 4vw, 3rem);
}

@media (min-width: 900px) {
  .ways {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1.5rem;
  }
}

.way {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--a2-line);
  border-radius: var(--a2-radius-l);
  background: var(--a2-surface);
  padding: clamp(1.25rem, 2.6vw, 2rem);
}

.way-label {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.75rem;
  color: var(--a2-accent);
  font-family: var(--a2-font-label);
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.way-text {
  margin: 0.625rem 0 0;
  font-size: 1rem;
  line-height: 1.55;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 1.25rem 0 1rem;
  padding: 0;
  list-style: none;
}

.chip {
  border: 1px solid var(--a2-line);
  border-radius: 999px;
  background: var(--a2-bg);
  padding: 0.3rem 0.75rem;
  color: var(--a2-ink);
  font-size: 0.875rem;
  font-weight: 500;
}

.agent-note {
  margin-top: 1rem;
}
</style>
