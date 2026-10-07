import { expect, test, type Page } from '@playwright/test';

const SHOTS = process.env.SCREENSHOT_DIR ?? 'test-results/screens';

/** O layout não pode ter rolagem horizontal no celular. */
async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'página com rolagem horizontal no celular').toBeLessThanOrEqual(1);
}

test('12. Paciente agenda pelo celular, do início ao fim', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'JR SAÚDE' })).toBeVisible();
  await expect(page.getByText('Cardiologia').first()).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${SHOTS}/m01-home.png`, fullPage: true });

  await page.getByRole('link', { name: 'AGENDAR CONSULTA' }).click();
  await expect(page.getByRole('heading', { name: 'Qual atendimento você precisa?' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${SHOTS}/m02-servicos.png` });

  await page.getByRole('button', { name: /^Dermatologia/ }).click();
  // um único profissional: a etapa de escolha é pulada automaticamente
  await expect(page.getByRole('heading', { name: 'Escolha o dia e o horário' })).toBeVisible();
  await page.locator('.quick-date').first().click();
  await expect(page.locator('.slot').first()).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${SHOTS}/m03-horarios.png`, fullPage: true });
  await page.locator('.slot').first().click();

  await expect(page.getByRole('heading', { name: 'Seus dados' })).toBeVisible();
  // validação no navegador
  await page.getByRole('button', { name: /Revisar agendamento/ }).click();
  await expect(page.getByText('Informe o nome completo.')).toBeVisible();
  await page.getByLabel('Nome completo do paciente').fill('Maria Teste da Silva');
  await page.getByLabel('Telefone (WhatsApp)').fill('91988887777');
  await expect(page.getByLabel('Telefone (WhatsApp)')).toHaveValue('(91) 98888-7777');
  await page.getByRole('checkbox').check();
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${SHOTS}/m04-dados.png`, fullPage: true });
  await page.getByRole('button', { name: /Revisar agendamento/ }).click();

  await expect(page.getByRole('heading', { name: 'Confira e confirme' })).toBeVisible();
  await expect(page.getByText('Maria Teste da Silva')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/m05-confirmar.png`, fullPage: true });
  await page.getByRole('button', { name: /CONFIRMAR AGENDAMENTO/ }).click();

  await expect(page.getByRole('heading', { name: 'Agendamento confirmado!' })).toBeVisible();
  const code = (await page.locator('.code-box b').textContent())!.trim();
  expect(code).toMatch(/^[2-9A-Z]{4}-[2-9A-Z]{4}$/);
  await expect(page.getByRole('link', { name: /Adicionar ao calendário/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Enviar confirmação pelo WhatsApp/ })).toHaveAttribute('href', /wa\.me\/5591990000000/);
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${SHOTS}/m06-sucesso.png`, fullPage: true });

  // ---- Meus agendamentos: consulta com telefone + código e cancelamento
  await page.goto('/meus-agendamentos');
  await page.getByLabel('Número do agendamento').fill(code);
  await page.getByLabel('Telefone usado no agendamento').fill('91988887777');
  await page.getByRole('button', { name: /Ver meu agendamento/ }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Maria' })).toBeVisible();
  await expect(page.getByText('(91) 9****-7777')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/m07-meu-agendamento.png`, fullPage: true });

  await page.getByRole('button', { name: /CONFIRMAR MINHA PRESENÇA/ }).click();
  await expect(page.getByText('Presença confirmada', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: /Cancelar agendamento/ }).click();
  await page.getByRole('button', { name: 'Sim, cancelar' }).click();
  await expect(page.getByText('Agendamento cancelado', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Fazer novo agendamento/ })).toBeVisible();
});

test('Exame: o sistema escolhe o profissional e pula a etapa', async ({ page }) => {
  await page.goto('/agendar');
  await page.getByRole('button', { name: /^Eletrocardiograma/ }).click();
  await expect(page.getByRole('heading', { name: 'Escolha o dia e o horário' })).toBeVisible();
  await expect(page.getByText('Etapa 2 de 4')).toBeVisible();
});

test('Serviço com vários profissionais mostra a escolha', async ({ page }) => {
  await page.goto('/agendar');
  await page.getByRole('button', { name: /^Fisioterapia/ }).click();
  await expect(page.getByRole('heading', { name: 'Escolha o profissional' })).toBeVisible();
  await expect(page.getByText('Ft. Lucas Martins')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${SHOTS}/m08-profissionais.png`, fullPage: true });
});

test('Painel administrativo no celular', async ({ page }) => {
  await page.goto('/admin');
  await page.getByLabel('E-mail').fill('admin@jrsaude.com.br');
  await page.getByLabel('Senha').fill('Admin-E2E-2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.locator('.page-head h1')).toContainText(/Bom dia|Boa tarde|Boa noite/);
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${SHOTS}/m09-admin-hoje.png`, fullPage: true });
  await page.getByRole('navigation', { name: 'Atalhos' }).getByRole('link', { name: /Agenda/ }).click();
  await expect(page.getByRole('heading', { name: 'Agenda', exact: true })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/m10-admin-agenda.png`, fullPage: true });
});
