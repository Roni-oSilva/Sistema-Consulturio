import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../../config.js';

/**
 * Integrações modulares de envio. Cada canal tem um provedor escolhido por
 * variável de ambiente; trocar de provedor não exige mudar código.
 *
 *  WhatsApp: manual | evolution | zapi | twilio | meta | webhook | log
 *  E-mail:   none | smtp | log
 *  SMS:      none | twilio | webhook | log
 *
 * "manual": sem API contratada. A mensagem fica pronta no painel com o botão
 * "Enviar pelo WhatsApp", que abre o WhatsApp com o texto preenchido.
 */
export type SendResult = { status: 'SENT' | 'MANUAL'; provider: string; providerMessageId?: string };

const TIMEOUT_MS = 15_000;

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function twilioSend(from: string, to: string, body: string) {
  const c = config();
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(c.TWILIO_ACCOUNT_SID)}/Messages.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: 'Basic ' + Buffer.from(`${c.TWILIO_ACCOUNT_SID}:${c.TWILIO_AUTH_TOKEN}`).toString('base64'),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ From: from, To: to, Body: body }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
  if (!res.ok) throw new Error(`Twilio HTTP ${res.status}: ${json.message ?? ''}`);
  return json.sid ?? '';
}

export async function sendWhatsApp(to: string, body: string): Promise<SendResult> {
  const c = config();
  const provider = c.WHATSAPP_PROVIDER;
  switch (provider) {
    case 'manual':
      return { status: 'MANUAL', provider };
    case 'log':
      console.log(`[whatsapp:log] para ${to}\n${body}\n`);
      return { status: 'SENT', provider };
    case 'evolution': {
      if (!c.EVOLUTION_API_URL || !c.EVOLUTION_API_KEY || !c.EVOLUTION_INSTANCE) throw new Error('Evolution API não configurada');
      const url = `${c.EVOLUTION_API_URL.replace(/\/$/, '')}/message/sendText/${encodeURIComponent(c.EVOLUTION_INSTANCE)}`;
      const r = await postJson(url, { number: to, text: body, textMessage: { text: body } }, { apikey: c.EVOLUTION_API_KEY });
      const key = r.key as { id?: string } | undefined;
      return { status: 'SENT', provider, providerMessageId: key?.id ?? '' };
    }
    case 'zapi': {
      if (!c.ZAPI_INSTANCE_ID || !c.ZAPI_TOKEN) throw new Error('Z-API não configurada');
      const url = `https://api.z-api.io/instances/${encodeURIComponent(c.ZAPI_INSTANCE_ID)}/token/${encodeURIComponent(c.ZAPI_TOKEN)}/send-text`;
      const headers: Record<string, string> = c.ZAPI_CLIENT_TOKEN ? { 'Client-Token': c.ZAPI_CLIENT_TOKEN } : {};
      const r = await postJson(url, { phone: to, message: body }, headers);
      return { status: 'SENT', provider, providerMessageId: String(r.messageId ?? r.id ?? '') };
    }
    case 'twilio': {
      if (!c.TWILIO_ACCOUNT_SID || !c.TWILIO_WHATSAPP_FROM) throw new Error('Twilio WhatsApp não configurado');
      const sid = await twilioSend(`whatsapp:${c.TWILIO_WHATSAPP_FROM}`, `whatsapp:+${to}`, body);
      return { status: 'SENT', provider, providerMessageId: sid };
    }
    case 'meta': {
      if (!c.META_WA_TOKEN || !c.META_WA_PHONE_NUMBER_ID) throw new Error('WhatsApp Cloud API não configurada');
      const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(c.META_WA_PHONE_NUMBER_ID)}/messages`;
      const r = await postJson(
        url,
        { messaging_product: 'whatsapp', to, type: 'text', text: { preview_url: true, body } },
        { authorization: `Bearer ${c.META_WA_TOKEN}` },
      );
      const msgs = r.messages as { id?: string }[] | undefined;
      return { status: 'SENT', provider, providerMessageId: msgs?.[0]?.id ?? '' };
    }
    case 'webhook': {
      if (!c.WHATSAPP_WEBHOOK_URL) throw new Error('Webhook de WhatsApp não configurado');
      const headers: Record<string, string> = c.WHATSAPP_WEBHOOK_TOKEN ? { authorization: `Bearer ${c.WHATSAPP_WEBHOOK_TOKEN}` } : {};
      const r = await postJson(c.WHATSAPP_WEBHOOK_URL, { channel: 'whatsapp', to, body }, headers);
      return { status: 'SENT', provider, providerMessageId: String(r.id ?? '') };
    }
  }
}

let transporter: Transporter | null = null;

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

/** E-mail em HTML simples: o texto é escapado (sem risco de injeção) e os links ficam clicáveis. */
export function emailHtml(subject: string, body: string, clinicName: string) {
  const content = escapeHtml(body)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#1B2A47;font-weight:600">$1</a>')
    .replace(/\n/g, '<br>');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;background:#F5F1EA;font-family:Arial,Helvetica,sans-serif;color:#1F2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F1EA;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#1B2A47;color:#ffffff;padding:20px 24px;font-family:Georgia,serif;font-size:22px;letter-spacing:1px">${escapeHtml(clinicName)}</td></tr>
<tr><td style="padding:24px;font-size:16px;line-height:1.6">${content}</td></tr>
<tr><td style="padding:16px 24px;font-size:12px;color:#6B7280;border-top:1px solid #EEE">Mensagem automática do sistema de agendamento. Não responda este e-mail.</td></tr>
</table></td></tr></table></body></html>`;
}

export async function sendEmail(to: string, subject: string, body: string, clinicName: string): Promise<SendResult> {
  const c = config();
  if (c.EMAIL_PROVIDER === 'none') throw new Error('Envio de e-mail não configurado (EMAIL_PROVIDER=none)');
  if (c.EMAIL_PROVIDER === 'log') {
    console.log(`[email:log] para ${to} — ${subject}\n${body}\n`);
    return { status: 'SENT', provider: 'log' };
  }
  transporter ??= nodemailer.createTransport({
    host: c.SMTP_HOST,
    port: c.SMTP_PORT,
    secure: c.SMTP_SECURE,
    auth: c.SMTP_USER ? { user: c.SMTP_USER, pass: c.SMTP_PASS } : undefined,
  });
  const info = await transporter.sendMail({
    from: c.EMAIL_FROM || c.SMTP_USER,
    to,
    subject,
    text: body,
    html: emailHtml(subject, body, clinicName),
  });
  return { status: 'SENT', provider: 'smtp', providerMessageId: info.messageId };
}

export async function sendSms(to: string, body: string): Promise<SendResult> {
  const c = config();
  switch (c.SMS_PROVIDER) {
    case 'none':
      throw new Error('Envio de SMS não configurado (SMS_PROVIDER=none)');
    case 'log':
      console.log(`[sms:log] para ${to}: ${body}`);
      return { status: 'SENT', provider: 'log' };
    case 'twilio': {
      if (!c.TWILIO_SMS_FROM) throw new Error('Twilio SMS não configurado');
      const sid = await twilioSend(c.TWILIO_SMS_FROM, `+${to}`, body);
      return { status: 'SENT', provider: 'twilio', providerMessageId: sid };
    }
    case 'webhook': {
      if (!c.SMS_WEBHOOK_URL) throw new Error('Webhook de SMS não configurado');
      const headers: Record<string, string> = c.SMS_WEBHOOK_TOKEN ? { authorization: `Bearer ${c.SMS_WEBHOOK_TOKEN}` } : {};
      await postJson(c.SMS_WEBHOOK_URL, { channel: 'sms', to, body }, headers);
      return { status: 'SENT', provider: 'webhook' };
    }
  }
}

/** Situação dos canais (exibida no painel, sem revelar segredos). */
export function providerStatus() {
  const c = config();
  return {
    whatsapp: c.WHATSAPP_PROVIDER,
    email: c.EMAIL_PROVIDER,
    sms: c.SMS_PROVIDER,
  };
}
