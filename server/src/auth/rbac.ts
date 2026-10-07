/**
 * Controle de acesso baseado em funções (RBAC).
 *
 * Princípio: DENY BY DEFAULT. Uma permissão só é concedida se estiver
 * listada explicitamente para a função. Esta matriz é a fonte da verdade;
 * ela é copiada para a tabela `roles` apenas para exibição no painel.
 */
export const PERMISSIONS = [
  'dashboard:read',
  'appointments:read', // ver agenda (PROFESSIONAL: somente a própria)
  'appointments:write', // criar / remarcar / cancelar / editar
  'appointments:status', // alterar status (PROFESSIONAL: somente os próprios)
  'patients:read',
  'patients:anonymize',
  'blocks:write', // bloquear horários
  'professionals:write',
  'services:write',
  'schedules:write',
  'holidays:write',
  'settings:write',
  'templates:write',
  'notifications:read',
  'notifications:write',
  'users:read',
  'users:write',
  'audit:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'RECEPTION' | 'PROFESSIONAL';
export const ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'RECEPTION', 'PROFESSIONAL'];

const ALL = [...PERMISSIONS];

export const ROLE_DEFS: Record<Role, { name: string; description: string; permissions: Permission[] }> = {
  SUPER_ADMIN: {
    name: 'Super administrador',
    description: 'Acesso total ao sistema, incluindo administradores.',
    permissions: ALL,
  },
  ADMIN: {
    name: 'Administrador',
    description: 'Gerencia a clínica: agenda, profissionais, serviços, mensagens e configurações.',
    permissions: ALL,
  },
  RECEPTION: {
    name: 'Recepção',
    description: 'Gerencia agendamentos e bloqueios. Sem acesso a configurações críticas.',
    permissions: [
      'dashboard:read',
      'appointments:read',
      'appointments:write',
      'appointments:status',
      'patients:read',
      'blocks:write',
      'notifications:read',
      'notifications:write',
    ],
  },
  PROFESSIONAL: {
    name: 'Profissional',
    description: 'Vê a própria agenda e marca atendimentos como concluídos ou falta.',
    permissions: ['dashboard:read', 'appointments:read', 'appointments:status'],
  },
};

export function hasPermission(role: string, perm: Permission): boolean {
  const def = ROLE_DEFS[role as Role];
  if (!def) return false; // função desconhecida => nega
  return def.permissions.includes(perm);
}

/** Quais funções um usuário pode criar/editar. ADMIN não gerencia ADMIN/SUPER_ADMIN. */
export function manageableRoles(actorRole: string): Role[] {
  if (actorRole === 'SUPER_ADMIN') return [...ROLES];
  if (actorRole === 'ADMIN') return ['RECEPTION', 'PROFESSIONAL'];
  return [];
}
