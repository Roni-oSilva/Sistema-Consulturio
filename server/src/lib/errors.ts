/** Erro de negócio com código HTTP e mensagem segura para o usuário final. */
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, code = 'BAD_REQUEST', details?: unknown) => new AppError(400, code, msg, details);
export const unauthorized = (msg = 'Faça login para continuar.', code = 'UNAUTHORIZED') => new AppError(401, code, msg);
export const forbidden = (msg = 'Você não tem permissão para esta ação.') => new AppError(403, 'FORBIDDEN', msg);
export const notFound = (msg = 'Não encontrado.') => new AppError(404, 'NOT_FOUND', msg);
export const conflict = (msg: string, code = 'CONFLICT') => new AppError(409, code, msg);
export const tooMany = (msg = 'Muitas tentativas. Aguarde alguns minutos e tente novamente.') =>
  new AppError(429, 'TOO_MANY_REQUESTS', msg);
