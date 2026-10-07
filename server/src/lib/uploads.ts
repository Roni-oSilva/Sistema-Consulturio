import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { randomToken } from './crypto.js';
import { badRequest } from './errors.js';

/**
 * Upload de imagem seguro: só aceita JPEG/PNG/WebP verificando a assinatura
 * real do arquivo (não confia na extensão nem no Content-Type), tamanho
 * máximo de 2 MB e nome aleatório. SVG é recusado (pode conter scripts).
 */
function detect(buf: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

export async function saveImageUpload(req: FastifyRequest, prefix: string): Promise<string> {
  const file = await req.file();
  if (!file) throw badRequest('Envie uma imagem.');
  const buf = await file.toBuffer();
  if (file.file.truncated) throw badRequest('Imagem muito grande (máximo 2 MB).');
  const ext = detect(buf);
  if (!ext) throw badRequest('Formato não suportado. Envie JPG, PNG ou WebP.');
  const name = `${prefix}-${randomToken(12)}.${ext}`;
  await writeFile(join(resolve(config().UPLOAD_DIR), name), buf, { mode: 0o644 });
  return `/uploads/${name}`;
}
