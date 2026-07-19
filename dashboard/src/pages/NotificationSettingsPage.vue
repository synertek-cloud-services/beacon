<template>
  <div class="pf-page">
    <nav class="pf-crumb"><span class="pf-crumb-current">Notifications</span></nav>
    <div class="pf-topbar"><h1 class="pf-title">Notifications</h1></div>
    <div v-if="loading" class="pf-state">Loading…</div>

    <div v-else class="pf-body">
      <!-- Webhooks -->
      <div class="pf-group">
        <label class="pf-label">Webhooks</label>
        <p class="field-hint" style="margin-top:-4px">Every alert.triggered / alert.resolved event is POSTed as JSON to each enabled URL below — point this at Hookdeck, Zapier, or your own endpoint.</p>
        <div class="pf-monitors">
          <div v-if="!webhooks.length" class="pf-mon-empty"><p>No webhooks yet.</p></div>
          <div v-for="wh in webhooks" :key="wh.id" class="pf-mon-row">
            <span class="pf-mon-desc mono" style="flex:1">{{ wh.url }}</span>
            <span class="text-muted text-xs">{{ wh.enabled ? 'Enabled' : 'Disabled' }}</span>
            <div class="pf-mon-actions">
              <button class="btn-text" @click="toggleWebhook(wh)">{{ wh.enabled ? 'Disable' : 'Enable' }}</button>
              <button class="btn-text danger" @click="removeWebhook(wh.id)">Remove</button>
            </div>
          </div>
        </div>
        <div class="pf-row" style="margin-top:10px;gap:8px">
          <input v-model="newWebhookUrl" class="pf-input" placeholder="https://…" style="max-width:360px" @keyup.enter="addWebhook" />
          <button class="btn btn-ghost btn-sm" :disabled="!newWebhookUrl.trim()" @click="addWebhook">Add Webhook</button>
        </div>
        <div v-if="webhookError" class="error-banner">{{ webhookError }}</div>
      </div>

      <!-- Email provider -->
      <div class="pf-group">
        <label class="pf-label">Email Provider</label>
        <p class="field-hint" style="margin-top:-4px">One active provider at a time. Fill in every field for the provider you're configuring — a partial credential update isn't supported.</p>

        <div class="seg-bar">
          <button v-for="p in providerTypes" :key="p" :class="['seg-btn', { active: emailForm.provider === p }]" @click="emailForm.provider = p">{{ providerLabel(p) }}</button>
        </div>

        <template v-if="emailForm.provider === 'ses'">
          <div class="pf-field-row"><label class="pf-sublabel">Access Key ID</label><input v-model="emailForm.ses.accessKeyId" class="pf-input" :placeholder="emailSettings?.hasConfig ? '•••• configured — leave blank to keep' : 'AKIA…'" /></div>
          <div class="pf-field-row"><label class="pf-sublabel">Secret Access Key</label><input v-model="emailForm.ses.secretAccessKey" type="password" class="pf-input" :placeholder="emailSettings?.hasConfig ? '•••• configured — leave blank to keep' : 'value'" /></div>
          <div class="pf-field-row"><label class="pf-sublabel">Region</label><input v-model="emailForm.ses.region" class="pf-input" placeholder="us-east-1" /></div>
        </template>
        <template v-else-if="emailForm.provider === 'resend'">
          <div class="pf-field-row"><label class="pf-sublabel">API Key</label><input v-model="emailForm.resend.apiKey" type="password" class="pf-input" :placeholder="emailSettings?.hasConfig ? '•••• configured — leave blank to keep' : 're_…'" /></div>
        </template>
        <template v-else-if="emailForm.provider === 'mailgun'">
          <div class="pf-field-row"><label class="pf-sublabel">API Key</label><input v-model="emailForm.mailgun.apiKey" type="password" class="pf-input" :placeholder="emailSettings?.hasConfig ? '•••• configured — leave blank to keep' : 'key-…'" /></div>
          <div class="pf-field-row"><label class="pf-sublabel">Domain</label><input v-model="emailForm.mailgun.domain" class="pf-input" placeholder="mg.example.com" /></div>
          <div class="pf-field-row">
            <label class="pf-sublabel">Region</label>
            <div class="seg-bar">
              <button :class="['seg-btn', { active: emailForm.mailgun.region === 'us' }]" @click="emailForm.mailgun.region = 'us'">US</button>
              <button :class="['seg-btn', { active: emailForm.mailgun.region === 'eu' }]" @click="emailForm.mailgun.region = 'eu'">EU</button>
            </div>
          </div>
        </template>

        <div class="pf-field-row"><label class="pf-sublabel">From Address</label><input v-model="emailForm.fromAddress" type="email" class="pf-input" placeholder="alerts@example.com" /></div>
        <div class="pf-field-row">
          <label class="pf-sublabel">Enabled</label>
          <div class="seg-bar">
            <button :class="['seg-btn', 'seg-primary', { active: emailForm.enabled }]" @click="emailForm.enabled = true">Enabled</button>
            <button :class="['seg-btn', { active: !emailForm.enabled }]" @click="emailForm.enabled = false">Disabled</button>
          </div>
        </div>

        <div class="pf-row" style="margin-top:4px">
          <button class="btn btn-primary btn-sm" :disabled="emailSaving" @click="saveEmailSettings">{{ emailSaving ? 'Saving…' : 'Save' }}</button>
        </div>
        <div v-if="emailError" class="error-banner">{{ emailError }}</div>
      </div>

      <!-- Recipients -->
      <div class="pf-group">
        <label class="pf-label">Recipients</label>
        <p class="field-hint" style="margin-top:-4px">Both sources are unioned — opted-in Beacon accounts, plus any standalone addresses below (a shared mailbox, a ticketing system's inbound address, etc.).</p>

        <div class="pf-monitors">
          <div class="pf-tbl-head"><span style="flex:1">User</span><span>Role</span><span>Alerts</span></div>
          <div v-if="!users.length" class="pf-mon-empty"><p>No users yet.</p></div>
          <div v-for="u in users" :key="u.id" class="pf-mon-row">
            <span class="pf-mon-desc" style="flex:1"><strong>{{ u.displayName || u.email }}</strong> <span class="text-muted" style="margin-left:6px">{{ u.email }}</span></span>
            <span :class="['role-chip', 'role-' + u.role]">{{ u.role }}</span>
            <label style="display:flex;align-items:center"><input type="checkbox" :checked="u.receivesAlerts" @change="toggleUserAlerts(u)" /></label>
          </div>
        </div>

        <label class="pf-sublabel" style="display:block;margin-top:14px;margin-bottom:6px">Standalone Addresses</label>
        <div class="pf-monitors">
          <div v-if="!notificationEmails.length" class="pf-mon-empty"><p>No standalone addresses yet.</p></div>
          <div v-for="ne in notificationEmails" :key="ne.id" class="pf-mon-row">
            <span class="pf-mon-desc" style="flex:1">{{ ne.email }}</span>
            <span class="text-muted text-xs">{{ ne.enabled ? 'Enabled' : 'Disabled' }}</span>
            <div class="pf-mon-actions">
              <button class="btn-text" @click="toggleNotificationEmail(ne)">{{ ne.enabled ? 'Disable' : 'Enable' }}</button>
              <button class="btn-text danger" @click="removeNotificationEmail(ne.id)">Remove</button>
            </div>
          </div>
        </div>
        <div class="pf-row" style="margin-top:10px;gap:8px">
          <input v-model="newRecipientEmail" type="email" class="pf-input" placeholder="ops@example.com" style="max-width:280px" @keyup.enter="addNotificationEmail" />
          <button class="btn btn-ghost btn-sm" :disabled="!newRecipientEmail.trim()" @click="addNotificationEmail">Add Address</button>
        </div>
        <div v-if="recipientError" class="error-banner">{{ recipientError }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue';
import { api, type WebhookEndpoint, type NotificationEmail, type EmailSettings, type EmailProviderType, type AppUser } from '../api';

const loading = ref(true);

const webhooks = ref<WebhookEndpoint[]>([]);
const newWebhookUrl = ref('');
const webhookError = ref('');

const emailSettings = ref<EmailSettings | null>(null);
const providerTypes: EmailProviderType[] = ['ses', 'resend', 'mailgun'];
const emailForm = reactive<{
  provider: EmailProviderType;
  fromAddress: string;
  enabled: boolean;
  ses: { accessKeyId: string; secretAccessKey: string; region: string };
  resend: { apiKey: string };
  mailgun: { apiKey: string; domain: string; region: 'us' | 'eu' };
}>({
  provider: 'resend',
  fromAddress: '',
  enabled: false,
  ses: { accessKeyId: '', secretAccessKey: '', region: 'us-east-1' },
  resend: { apiKey: '' },
  mailgun: { apiKey: '', domain: '', region: 'us' },
});
const emailSaving = ref(false);
const emailError = ref('');

const users = ref<AppUser[]>([]);
const notificationEmails = ref<NotificationEmail[]>([]);
const newRecipientEmail = ref('');
const recipientError = ref('');

function providerLabel(p: EmailProviderType) { return p === 'ses' ? 'Amazon SES' : p === 'resend' ? 'Resend' : 'Mailgun'; }

onMounted(async () => {
  const [wh, es, ne, us] = await Promise.all([
    api.webhooks.list(),
    api.emailSettings.get().catch(() => null),
    api.notificationEmails.list(),
    api.users.list(),
  ]);
  webhooks.value = wh;
  notificationEmails.value = ne;
  users.value = us;
  emailSettings.value = es;
  if (es) {
    if (es.provider) emailForm.provider = es.provider;
    emailForm.fromAddress = es.fromAddress ?? '';
    emailForm.enabled = es.enabled;
  }
  loading.value = false;
});

// ── Webhooks ─────────────────────────────────────────────────
async function addWebhook() {
  if (!newWebhookUrl.value.trim()) return;
  webhookError.value = '';
  try {
    await api.webhooks.create(newWebhookUrl.value.trim());
    webhooks.value = await api.webhooks.list();
    newWebhookUrl.value = '';
  } catch (e) { webhookError.value = e instanceof Error ? e.message : 'Could not add webhook.'; }
}
async function toggleWebhook(wh: WebhookEndpoint) {
  await api.webhooks.update(wh.id, { enabled: !wh.enabled });
  wh.enabled = !wh.enabled;
}
async function removeWebhook(id: string) {
  await api.webhooks.delete(id);
  webhooks.value = webhooks.value.filter(w => w.id !== id);
}

// ── Email provider ───────────────────────────────────────────
function buildConfigPayload(): Record<string, string> | undefined {
  if (emailForm.provider === 'ses') {
    const { accessKeyId, secretAccessKey, region } = emailForm.ses;
    if (!accessKeyId && !secretAccessKey) return undefined;
    return { accessKeyId, secretAccessKey, region };
  }
  if (emailForm.provider === 'resend') {
    if (!emailForm.resend.apiKey) return undefined;
    return { apiKey: emailForm.resend.apiKey };
  }
  const { apiKey, domain, region } = emailForm.mailgun;
  if (!apiKey && !domain) return undefined;
  return { apiKey, domain, region };
}
async function saveEmailSettings() {
  emailError.value = '';
  emailSaving.value = true;
  try {
    await api.emailSettings.update({
      provider: emailForm.provider,
      fromAddress: emailForm.fromAddress.trim(),
      enabled: emailForm.enabled,
      config: buildConfigPayload(),
    });
    emailSettings.value = await api.emailSettings.get();
    emailForm.ses.secretAccessKey = '';
    emailForm.resend.apiKey = '';
    emailForm.mailgun.apiKey = '';
  } catch (e) { emailError.value = e instanceof Error ? e.message : 'Could not save email settings.'; }
  finally { emailSaving.value = false; }
}

// ── Recipients ───────────────────────────────────────────────
async function toggleUserAlerts(u: AppUser) {
  await api.users.update(u.id, { receivesAlerts: !u.receivesAlerts });
  u.receivesAlerts = !u.receivesAlerts;
}
async function addNotificationEmail() {
  if (!newRecipientEmail.value.trim()) return;
  recipientError.value = '';
  try {
    await api.notificationEmails.create(newRecipientEmail.value.trim());
    notificationEmails.value = await api.notificationEmails.list();
    newRecipientEmail.value = '';
  } catch (e) { recipientError.value = e instanceof Error ? e.message : 'Could not add address.'; }
}
async function toggleNotificationEmail(ne: NotificationEmail) {
  await api.notificationEmails.update(ne.id, { enabled: !ne.enabled });
  ne.enabled = !ne.enabled;
}
async function removeNotificationEmail(id: string) {
  await api.notificationEmails.delete(id);
  notificationEmails.value = notificationEmails.value.filter(n => n.id !== id);
}
</script>

<style scoped>
.pf-page { display: flex; flex-direction: column; min-height: 100%; }
.pf-crumb { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--color-text-muted); margin-bottom: 14px; }
.pf-crumb-current { color: var(--color-text-subtle); }
.pf-topbar { display: flex; align-items: center; gap: 12px; margin-bottom: 28px; }
.pf-title { font-size: 20px; font-weight: 700; color: var(--color-text-primary); flex: 1; margin: 0; }
.pf-state { padding: 40px; text-align: center; color: var(--color-text-muted); }

.pf-body { display: flex; flex-direction: column; gap: 0; }
.pf-group {
  display: flex; flex-direction: column; gap: 10px;
  padding: 20px 0; border-bottom: 1px solid var(--color-border);
  max-width: 760px;
}
.pf-group:last-child { border-bottom: none; }
.pf-label { font-size: 15px; font-weight: 600; color: var(--color-text-primary); }
.pf-field-row { display: flex; flex-direction: column; gap: 4px; }
.pf-sublabel { font-size: 11px; font-weight: 600; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: .05em; }
.pf-input {
  width: 100%; max-width: 480px;
  padding: 9px 12px;
  background: var(--color-surface-raised); border: 1px solid var(--color-border-strong);
  border-radius: 6px; color: var(--color-text-primary); font-size: 13px; font-family: var(--font);
  outline: none; transition: border-color .12s; box-sizing: border-box;
}
.pf-input:focus { border-color: var(--color-primary); }
.pf-row { display: flex; align-items: center; gap: 8px; }
.field-hint { display: block; font-size: 11px; color: var(--color-text-muted); margin-top: 4px; }

.seg-bar { display: inline-flex; border: 1px solid var(--color-border-strong); border-radius: 6px; overflow: hidden; align-self: flex-start; }
.seg-btn {
  padding: 7px 18px; font-size: 13px; font-weight: 500; font-family: var(--font);
  background: var(--color-surface-raised); color: var(--color-text-subtle); border: none; cursor: pointer;
  transition: background .12s, color .12s;
}
.seg-btn + .seg-btn { border-left: 1px solid var(--color-border-strong); }
.seg-btn.active { background: var(--color-surface); color: var(--color-text-primary); }
.seg-btn.seg-primary.active { background: var(--color-primary); color: #fff; }

.pf-monitors { border: 1px solid var(--color-border); border-radius: 7px; overflow: hidden; background: var(--color-surface); }
.pf-tbl-head {
  display: flex; align-items: center; gap: 8px; padding: 8px 14px;
  background: var(--color-surface-raised); border-bottom: 1px solid var(--color-border);
  font-size: 11px; font-weight: 700; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: .05em;
}
.pf-mon-empty { padding: 24px; text-align: center; }
.pf-mon-empty p { font-size: 12px; color: var(--color-text-muted); margin: 0; }
.pf-mon-row { display: flex; align-items: center; gap: 12px; padding: 9px 14px; border-bottom: 1px solid var(--color-border); }
.pf-mon-row:last-of-type { border-bottom: none; }
.pf-mon-desc { font-size: 12px; color: var(--color-text-primary); }
.pf-mon-actions { display: flex; gap: 4px; flex-shrink: 0; }

.btn-text { background: none; border: none; color: var(--color-primary); font-size: 12px; font-weight: 500; cursor: pointer; padding: 2px 4px; }
.btn-text:hover { text-decoration: underline; }
.btn-text.danger { color: var(--color-danger); }

.role-chip {
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
  padding: 2px 8px; border-radius: 10px; flex-shrink: 0;
}
.role-admin      { background: rgba(232,86,106,.14); color: var(--color-danger); }
.role-technician { background: rgba(78,126,247,.14); color: var(--color-primary); }
.role-readonly   { background: var(--color-surface-raised); color: var(--color-text-subtle); }
</style>
