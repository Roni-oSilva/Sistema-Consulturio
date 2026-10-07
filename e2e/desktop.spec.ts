import { expect, test, type APIRequestContext } from '@playwright/test';

const SHOTS = process.env.SCREENSHOT_DIR ?? 'test-results/screens';

/** Cria um agendamento pela API pública (como um paciente faria). */
async function bookCardiology(request: APIRequestContext, name: string, phone: string) {
  const services = await (await request.get('/api/services')).json();
  const svc = services.find((s: { slug: string }) => s.slug === 'cardiologia');
  const month = new Date().toISOString().slice(0, 7);
  let dates = (await (await request.get(`/api/availability/dates?serviceId=${svc.id}&month=${month}`)).json()).dates;
  if (!dates.length) {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    dates = (await (await request.get(`/api/availability/dates?serviceId=${svc.id}&month=${d.toISOString().slice(0, 7)}`)).json()).dates;
  }
  const slots = (await (await request.get(`/api/availability?serviceId=${svc.id}&date=${dates[0].date}`)).json()).slots;
  const pros = await (await request.get(`/api/professionals?serviceId=${svc.id}`)).json();
  const res = await request.post('/api/appointments', {
    data: { serviceId: svc.id, professionalId: pros[0].id, start: slots[0].start, name, phone, consent: true },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).appointment;
}

test('Painel: login, agenda, confirmação, mensagens e bloqueio', async ({ page, request }) => {
  const appt = await bookCardiology(request, 'Joana Cardoso Lima', '(91) 98111-2233');

  // área administrativa nunca fica acessível sem login
  const api401 = await request.get('/api/admin/dashboard');
  expect(api401.status()).toBe(401);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Painel da clínica' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/d01-login.png` });

  await page.getByLabel('E-mail').fill('admin@jrsaude.com.br');
  await page.getByLabel('Senha').fill('senha-errada-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('E-mail ou senha inválidos.')).toBeVisible();
  await page.getByLabel('Senha').fill('Admin-E2E-2026');
  await page.getByRole('button', { name: 'Entrar' }).click();

  await expect(page.locator('.page-head h1')).toContainText(/Bom dia|Boa tarde|Boa noite/);
  // a automação processa a fila em segundo plano
  await expect(async () => {
    await page.reload();
    await expect(page.getByText(/mensagem\(ns\) de WhatsApp pronta/)).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 20_000 });
  await page.screenshot({ path: `${SHOTS}/d02-dashboard.png`, fullPage: true });

  // agenda semanal com o agendamento
  await page.goto(`/admin/agenda?visao=semana&data=${appt.start.slice(0, 10)}`);
  await expect(page.getByRole('button', { name: new RegExp(`${appt.time} Joana Cardoso Lima`) })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/d03-agenda-semana.png`, fullPage: true });

  // abrir e confirmar
  await page.getByRole('button', { name: new RegExp(`${appt.time} Joana Cardoso Lima`) }).click();
  await expect(page.getByRole('dialog', { name: 'Detalhes do agendamento' })).toBeVisible();
  await page.waitForTimeout(400); // fim da animação do painel
  await page.screenshot({ path: `${SHOTS}/d04-detalhe.png` });
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Detalhes do agendamento' }).locator('.badge')).toHaveText('Confirmado');
  await page.getByRole('button', { name: 'Fechar' }).click();

  // visão do dia
  await page.goto(`/admin/agenda?visao=dia&data=${appt.start.slice(0, 10)}`);
  await page.screenshot({ path: `${SHOTS}/d05-agenda-dia.png`, fullPage: true });

  // fila de WhatsApp manual (1 clique)
  await page.goto('/admin/mensagens');
  await expect(page.getByRole('link', { name: /Enviar pelo WhatsApp/ }).first()).toHaveAttribute('href', /^https:\/\/wa\.me\/55/);
  await page.screenshot({ path: `${SHOTS}/d06-mensagens.png`, fullPage: true });
  await page.getByRole('tab', { name: 'Modelos de mensagem' }).click();
  await page.getByRole('button', { name: 'WhatsApp' }).first().click();
  await expect(page.locator('.wa-bubble')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/d07-modelos.png`, fullPage: true });

  // bloqueio de horário
  await page.goto('/admin/bloqueios');
  await page.getByRole('button', { name: 'Bloquear' }).click();
  await expect(page.getByText(/Horário bloqueado|Nenhum paciente agendado/).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/d08-bloqueios.png`, fullPage: true });

  await page.goto('/admin/profissionais');
  await page.getByText('Dra. Ana Silva').click();
  await page.getByRole('tab', { name: 'Horários', exact: true }).click();
  await page.screenshot({ path: `${SHOTS}/d09-profissional-horarios.png` });
  await page.keyboard.press('Escape');

  await page.goto('/admin/configuracoes');
  await page.screenshot({ path: `${SHOTS}/d10-configuracoes.png`, fullPage: true });

  await page.goto('/admin/auditoria');
  await expect(page.locator('table').getByText('Login recusado').first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/d11-auditoria.png` });

  // logout
  await page.getByRole('button', { name: 'Sair' }).first().click();
  await expect(page.getByText('Você saiu do painel com segurança.')).toBeVisible();
});

test('Home e fluxo no desktop', async ({ page }) => {
  await page.goto('/');
  await page.screenshot({ path: `${SHOTS}/d12-home.png`, fullPage: true });
  await page.goto('/agendar');
  await page.getByRole('button', { name: /^Cardiologia/ }).click();
  await page.locator('.quick-date').first().click();
  await expect(page.locator('.slot').first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/d13-agendar-horario.png`, fullPage: true });
});
