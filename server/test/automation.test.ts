import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, getPool } from '../src/db/pool.js';
import { autoCancelUnconfirmed, autoComplete, enqueueDailyAgendas, expireManual } from '../src/jobs/scheduler.js';
import { createAppointment, cancelAppointment } from '../src/services/appointments.js';
import { processDueNotifications } from '../src/services/notifications/worker.js';
import { invalidateSettings } from '../src/services/settings.js';
import { TZ, createFixture, freshPhone, setupApp, type Fixture } from './helpers.js';

let app: FastifyInstance;
let f: Fixture;

beforeAll(async () => {
  app = await setupApp();
  f = await createFixture('auto-jobs');
});

afterAll(async () => {
  await app.close();
  await closePool();
});

/** Agendamento pela recepção em qualquer horário (encaixe), útil para simular o passado. */
async function staffBooking(start: DateTime, status: 'PENDING' | 'CONFIRMED' = 'CONFIRMED') {
  const { appointment } = await createAppointment({
    serviceId: f.serviceId,
    professionalId: f.professionalId,
    start: start.toISO()!,
    patient: { name: 'Paciente Automação Teste', phone: freshPhone().replace(/\D/g, '').replace(/^/, '55') },
    source: 'ADMIN',
    allowOutsideSchedule: true,
    actor: { type: 'SYSTEM' },
  });
  if (status === 'PENDING') await getPool().query(`UPDATE appointments SET status = 'PENDING' WHERE id = $1`, [appointment.id]);
  return appointment;
}

describe('Automação de mensagens e agenda', () => {
  it('envia a agenda do dia ao profissional no horário configurado (sem duplicar)', async () => {
    const now = DateTime.now().setZone(TZ);
    const later = now.plus({ minutes: 40 }).startOf('minute');
    if (later.toISODate() !== now.toISODate()) return; // perto da meia-noite: sem como testar "hoje"
    await staffBooking(later);
    await getPool().query(`UPDATE professionals SET notify_phone = '5591977776666', daily_agenda = true WHERE id = $1`, [f.professionalId]);
    await getPool().query(`UPDATE clinic_settings SET daily_agenda_enabled = true, daily_agenda_time = $1`, [now.toFormat('HH:mm')]);
    invalidateSettings();

    expect(await enqueueDailyAgendas()).toBeGreaterThan(0);
    await enqueueDailyAgendas(); // segunda execução não duplica
    const { rows } = await getPool().query(`SELECT id FROM notifications WHERE type = 'DAILY_AGENDA' AND professional_id = $1`, [f.professionalId]);
    expect(rows).toHaveLength(1);

    await processDueNotifications(200);
    const { rows: sent } = await getPool().query(`SELECT status, body FROM notifications WHERE id = $1`, [rows[0].id]);
    expect(sent[0].status).toBe('MANUAL');
    expect(sent[0].body).toContain('Paciente Automação Teste');
    expect(sent[0].body).toContain(later.toFormat('HH:mm'));
  });

  it('lembrete de agendamento cancelado nunca é enviado', async () => {
    const start = DateTime.now().setZone(TZ).plus({ days: 3 }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
    const a = await staffBooking(start);
    await getPool().query(`UPDATE notifications SET scheduled_for = now() - interval '1 minute' WHERE appointment_id = $1 AND type = 'REMINDER'`, [a.id]);
    // simula falha de cancelamento em cascata: reativa o lembrete como pendente após cancelar
    await cancelAppointment(a.id, { type: 'STAFF' }, 'teste', { enforcePolicy: false });
    await getPool().query(`UPDATE notifications SET status = 'PENDING' WHERE appointment_id = $1 AND type = 'REMINDER'`, [a.id]);
    await processDueNotifications(200);
    const { rows } = await getPool().query(`SELECT status, last_error FROM notifications WHERE appointment_id = $1 AND type = 'REMINDER'`, [a.id]);
    expect(rows.every((r) => r.status === 'CANCELLED')).toBe(true);
  });

  it('libera o horário de quem não confirmou presença após o lembrete (opcional)', async () => {
    const start = DateTime.now().setZone(TZ).plus({ hours: 3 }).startOf('minute');
    const a = await staffBooking(start, 'PENDING');
    await getPool().query(
      `INSERT INTO notifications (appointment_id, type, channel, recipient, status, sent_at) VALUES ($1, 'REMINDER', 'WHATSAPP', '0', 'SENT', now() - interval '3 hours')`,
      [a.id],
    );
    await getPool().query(`UPDATE clinic_settings SET auto_cancel_unconfirmed_hours = 0`);
    invalidateSettings();
    expect(await autoCancelUnconfirmed()).toBe(0); // desligado por padrão
    await getPool().query(`UPDATE clinic_settings SET auto_cancel_unconfirmed_hours = 6`);
    invalidateSettings();
    expect(await autoCancelUnconfirmed()).toBeGreaterThan(0);
    const { rows } = await getPool().query(`SELECT status, cancelled_by FROM appointments WHERE id = $1`, [a.id]);
    expect(rows[0]).toMatchObject({ status: 'CANCELLED', cancelled_by: 'SYSTEM' });
    await getPool().query(`UPDATE clinic_settings SET auto_cancel_unconfirmed_hours = 0`);
    invalidateSettings();
  });

  it('conclui atendimentos confirmados já encerrados e agenda o pós-atendimento (opcional)', async () => {
    const start = DateTime.now().setZone(TZ).minus({ hours: 5 }).startOf('minute');
    const a = await staffBooking(start);
    await getPool().query(`UPDATE clinic_settings SET auto_complete_after_hours = 2, post_visit_enabled = true`);
    invalidateSettings();
    expect(await autoComplete()).toBeGreaterThan(0);
    const { rows } = await getPool().query(`SELECT status FROM appointments WHERE id = $1`, [a.id]);
    expect(rows[0].status).toBe('COMPLETED');
    const { rows: n } = await getPool().query(`SELECT 1 FROM notifications WHERE appointment_id = $1 AND type = 'POST_VISIT'`, [a.id]);
    expect(n.length).toBeGreaterThan(0);
    await getPool().query(`UPDATE clinic_settings SET auto_complete_after_hours = 0`);
    invalidateSettings();
  });

  it('mensagens manuais que perderam o sentido saem da fila', async () => {
    const start = DateTime.now().setZone(TZ).plus({ days: 4 }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
    const a = await staffBooking(start);
    await processDueNotifications(200);
    await getPool().query(`UPDATE appointments SET status = 'CANCELLED' WHERE id = $1`, [a.id]);
    await expireManual();
    const { rows } = await getPool().query(`SELECT status FROM notifications WHERE appointment_id = $1 AND type = 'BOOKING_CREATED'`, [a.id]);
    expect(rows.every((r) => r.status === 'CANCELLED')).toBe(true);
  });
});
