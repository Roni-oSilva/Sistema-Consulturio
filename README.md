# Sistema de Agendamento — Centro Clínico JR Saúde

Sistema web de agendamento de consultas e exames: o paciente agenda pelo celular em poucos toques, sem criar conta, e a clínica controla a agenda inteira por um painel. As mensagens de confirmação, lembrete e aviso saem sozinhas.

> **Foco:** agendamento. Não é prontuário médico.
> **Prioridades:** segurança, simplicidade, confiabilidade e velocidade.

---

## Sumário

1. [O que foi extraído do vídeo](#1-o-que-foi-extraído-do-vídeo)
2. [O que o sistema faz](#2-o-que-o-sistema-faz)
3. [Automação de mensagens (WhatsApp, e-mail, SMS)](#3-automação-de-mensagens)
4. [Segurança](#4-segurança)
5. [Privacidade e LGPD](#5-privacidade-e-lgpd)
6. [Colocar no ar (produção)](#6-colocar-no-ar-produção)
7. [Checklist antes de abrir para os pacientes](#7-checklist-antes-de-abrir-para-os-pacientes)
8. [Backup e restauração](#8-backup-e-restauração)
9. [Desenvolvimento e testes](#9-desenvolvimento-e-testes)
10. [Estrutura e API](#10-estrutura-e-api)

---

## 1. O que foi extraído do vídeo

| Item | Conteúdo no sistema |
|---|---|
| Nome | **Centro Clínico JR Saúde** (fachada), "JR Saúde" como nome curto |
| Identidade visual | Brasão com monograma **JR**, estetoscópio e linha de batimento cardíaco (redesenhado em vetor). Paleta azul-marinho, dourado champanhe e creme. Tipografia serifada. Também: ripas de mármore, linhas de LED douradas e as placas das portas, que viraram os botões de serviço do site. |
| Frases | "Profissionais preparados para cuidar da sua saúde com atenção e qualidade." · "Um ambiente preparado para cuidar de você e da sua família." · "Será um prazer receber você." |
| Consultas | Pediatria, Dermatologia, Ortopedia, Ginecologia, Cardiologia |
| Atendimentos | Endocrinologia, Nutrologia, Gastroenterologia, Fisioterapia |
| Exames | Eletrocardiograma (ECG), MAPA 24h, Holter 24h, Ultrassonografia, Coleta de exames laboratoriais |

**O vídeo não traz** endereço, telefone, WhatsApp, horário de funcionamento nem nomes dos profissionais. O telefone que aparece na fachada é da loja vizinha, então não foi usado. Preencha esses dados no painel (veja o [checklist](#7-checklist-antes-de-abrir-para-os-pacientes)).

Cada serviço já vem com descrição, duração e instruções de preparo (ex.: jejum na coleta, banho antes do Holter). As instruções são enviadas automaticamente ao paciente. Exames ficam como "o sistema escolhe o profissional", então o paciente pula essa etapa.

---

## 2. O que o sistema faz

### Paciente (site público, pensado para o celular)
- **Página inicial:** logo, nome, descrição, botão **AGENDAR CONSULTA**, especialidades e exames, profissionais com dias de atendimento, endereço, telefone/WhatsApp e horário.
- **Agendamento em etapas:** Serviço → Profissional (pulada quando não é necessária) → Data e horário → Seus dados → Confirmar → Pronto.
  - O calendário mostra **só datas com horário livre**. Datas passadas, feriados, dias sem expediente, férias, folgas e bloqueios ficam riscados.
  - Atalhos com as datas mais próximas. Horários divididos em manhã, tarde e noite, com botões grandes.
  - Dados pedidos: nome, telefone e e-mail (opcional). CPF e data de nascimento só aparecem se a clínica exigir.
- **Tela de sucesso:** número do agendamento, resumo, endereço e preparo, além dos botões *Adicionar ao calendário* (Google ou arquivo .ics para iPhone/Outlook), *Enviar confirmação pelo WhatsApp*, *Compartilhar com um familiar* e *Cancelar*.
- **Meus agendamentos:** o paciente consulta com **telefone + código** ou **e-mail + código**, ou pelo **link seguro** que recebe na mensagem. Pela página ele confirma presença, **remarca** ou **cancela**, sempre respeitando a regra de antecedência da clínica.

### Clínica (painel em `/admin`)
- **Hoje:** consultas do dia, confirmadas, pendentes, horários livres, próximas e canceladas, com ações rápidas (Confirmar, Concluído, Faltou, WhatsApp). Também mostra os avisos de configuração pendente e de mensagens a enviar.
- **Agenda:** visões **dia** (uma coluna por profissional), **semana**, **mês** e **lista** (ideal no celular). Faixas cinzas marcam o horário fora do expediente; as vermelhas, os bloqueios. Clicar em um espaço vazio abre um agendamento já preenchido. Há busca por nome, telefone ou código.
- **Detalhes do agendamento:** contato (WhatsApp/ligar), confirmar, concluir, falta, **remarcar** (com horários livres ou **encaixe**), cancelar com motivo, reativar, anotação interna, link do paciente, mensagens enviadas e histórico completo.
- **Novo agendamento pela recepção:** busca o paciente já cadastrado, mostra os horários livres e permite encaixe. O encaixe pode ficar fora do expediente, mas **nunca sobreposto** a outro horário.
- **Profissionais:** dados, foto, serviços (com duração própria opcional), grade semanal (ex.: seg 08–12 e 14–18, com botão "copiar segunda para seg–sex"), horários especiais por data e WhatsApp/e-mail para a agenda diária automática.
- **Serviços:** nome, tipo, duração (15/30/45/60...), preparo, valor opcional, se o paciente escolhe o profissional, ativo ou inativo.
- **Bloqueios e feriados:** bloqueia um horário, dia ou período (férias, folga, reunião, manutenção, outro) para um profissional ou para a clínica inteira. Antes de salvar, o sistema **mostra quem já está agendado** e pode **cancelar e avisar esses pacientes automaticamente**. Feriados nacionais (fixos e móveis até 2028) já vêm cadastrados.
- **Mensagens:** fila de envio em 1 clique, histórico, automações e editor de modelos com pré-visualização.
- **Pacientes:** busca, histórico, consentimentos, exportação de dados e anonimização (LGPD).
- **Usuários:** funções Super administrador, Administrador, Recepção e Profissional (este vê só a própria agenda). A senha temporária é obrigatoriamente trocada no primeiro acesso.
- **Auditoria:** login, logout, tentativas negadas, criação de usuários, mudanças de permissão, profissionais, horários, bloqueios, cancelamentos e alterações. Registra quem, o quê, quando, o recurso e o resultado.
- **Configurações:** nome, logo, telefones, endereço, mapa, horário, regras (duração padrão, antecedência mínima e máxima, prazo de cancelamento, remarcação pelo paciente), dados exigidos, limites contra abuso, fuso horário e política de privacidade.

---

## 3. Automação de mensagens

Tudo que dava para automatizar foi automatizado:

| Mensagem | Quando | Para quem |
|---|---|---|
| **Confirmação do agendamento** | Na hora, com código, endereço, preparo e link | Paciente |
| **Lembrete com confirmação de presença** | X horas antes (padrão 24h). O paciente confirma, remarca ou cancela pelo link | Paciente |
| **Lembrete de última hora** | X horas antes (padrão 2h) | Paciente |
| **Consulta confirmada** | Quando a recepção confirma | Paciente |
| **Remarcação** | Quando o horário muda (pela clínica ou pelo paciente) | Paciente |
| **Cancelamento** | Quando cancela, com motivo e link para reagendar | Paciente |
| **Pós-atendimento** | Após "Concluído", com link de avaliação no Google | Paciente |
| **Falta** | Após "Não compareceu", com convite para remarcar | Paciente |
| **Aviso à recepção** | Novo agendamento online, cancelamento ou remarcação feitos pelo paciente | Clínica |
| **Agenda do dia** | Todo dia no horário escolhido (padrão 07:00), com a lista de pacientes | Cada profissional |

Automações de agenda (opcionais, desligadas por padrão, ativadas em *Mensagens → Automação*):
- **Liberar horário de quem não confirmou:** cancela o PENDENTE que não confirmou presença depois do lembrete e avisa o paciente.
- **Concluir atendimentos automaticamente:** marca como concluídos os confirmados após o horário e dispara o pós-atendimento.

Como funciona por dentro: as mensagens entram numa **fila no banco, dentro da mesma transação** do agendamento. Nenhuma se perde e nenhuma sai de um agendamento que não foi salvo. Um processo em segundo plano envia e **tenta de novo** em caso de falha (2, 4, 8, 16 min). Lembretes de agendamentos cancelados ou remarcados **nunca são enviados**. Os textos são editáveis em *Mensagens → Modelos*, com variáveis como `{{primeiro_nome}}`, `{{data}}`, `{{hora}}` e `{{link}}`.

### Como ligar o WhatsApp automático

Sem nenhuma API, o sistema já funciona no **modo manual**. As mensagens ficam prontas em *Mensagens → Para enviar*, e o botão **Enviar pelo WhatsApp** abre o WhatsApp com o texto preenchido. É só tocar em enviar.

Para envio **100% automático**, contrate um provedor e configure no `.env`. As chaves ficam só no servidor, nunca no painel nem no navegador.

| Provedor | `WHATSAPP_PROVIDER` | Variáveis |
|---|---|---|
| Evolution API (auto-hospedado, popular no Brasil) | `evolution` | `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE` |
| Z-API | `zapi` | `ZAPI_INSTANCE_ID`, `ZAPI_TOKEN`, `ZAPI_CLIENT_TOKEN` |
| Twilio | `twilio` | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` |
| WhatsApp Cloud API (Meta) | `meta` | `META_WA_TOKEN`, `META_WA_PHONE_NUMBER_ID` (*) |
| Qualquer outro (n8n, Make, gateway próprio) | `webhook` | `WHATSAPP_WEBHOOK_URL`, `WHATSAPP_WEBHOOK_TOKEN`. Recebe `POST {channel, to, body}` |

(*) A API oficial da Meta só aceita texto livre dentro da janela de 24h de conversa. Fora dela, exige modelos aprovados.

- **E-mail:** `EMAIL_PROVIDER=smtp` + `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e `EMAIL_FROM`. Funciona com Gmail Workspace, Zoho, Brevo, SES...
- **SMS:** `SMS_PROVIDER=twilio` (com `TWILIO_SMS_FROM`) ou `webhook`.

Depois de configurar, use *Mensagens → Automação → Testar envio*.

---

## 4. Segurança

| Ameaça / requisito | Como foi tratado |
|---|---|
| **Reserva dupla / concorrência** | 1) trava consultiva por profissional e por telefone dentro da **transação**; 2) disponibilidade **recalculada no servidor** dentro da transação; 3) **constraint de exclusão no PostgreSQL** (`EXCLUDE USING gist`), que recusa dois agendamentos ativos sobrepostos para o mesmo profissional, mesmo por SQL direto. O segundo paciente recebe: *"Esse horário acabou de ser reservado. Escolha outro horário."* Testado com 12 reservas simultâneas: só 1 passa. |
| **Nunca confiar no navegador** | O servidor valida serviço ativo, profissional ativo e vinculado, data, antecedência, expediente, horário especial, feriado, bloqueio, grade de horários e sobreposição. Horários "inventados" (ex.: 10:07) são recusados. |
| **Senhas** | **Argon2id** (parâmetros OWASP), política mínima (10+ caracteres, letras e números), troca obrigatória da senha temporária. Nunca em texto puro. |
| **Sessões** | Token aleatório no cookie **HttpOnly + Secure + SameSite=Strict** (prefixo `__Host-` em HTTPS). No banco fica só o hash. Expira por **inatividade (30 min)** e por **tempo máximo (12 h)**. Logout apaga no servidor. Trocar senha, mudar função ou desativar o usuário encerra as sessões. Proteção contra fixação de sessão. |
| **CSRF** | SameSite=Strict + **token CSRF** obrigatório em toda alteração + checagem de `Origin`. |
| **Força bruta / credential stuffing** | Bloqueio progressivo por e-mail (5 falhas) e por IP, mensagem genérica (não revela se o e-mail existe), tempo de resposta constante e rate limit no login. |
| **Autorização (RBAC)** | **Deny by default**: toda rota administrativa exige sessão e declara a permissão. Validação no backend, não só na tela. Administrador não cria Super administrador. Profissional só acessa a própria agenda. Negações vão para a auditoria. |
| **IDOR / enumeração** | O agendamento só abre com **token secreto** (link) ou token temporário assinado (HMAC) após conferir **código + telefone/e-mail**. Erros idênticos para código ou contato errado. Rate limit na consulta. Códigos de 8 caracteres (~10¹² combinações). |
| **SQL Injection** | 100% consultas parametrizadas. |
| **XSS** | React escapa todo texto. Sem `dangerouslySetInnerHTML`. E-mails com HTML escapado. **CSP** restritiva. Uploads só JPG/PNG/WebP verificados pela assinatura do arquivo (SVG recusado). |
| **Mass assignment** | Validação com lista explícita de campos (zod). Campos extras são ignorados (testado com `status`, `source`, `id`...). |
| **Spam / robôs** | Rate limit por IP (criação, consulta, cancelamento), limite de agendamentos futuros **por telefone**, limite diário **por conexão** com registro na auditoria, campo isca (*honeypot*) e **Cloudflare Turnstile** opcional (`TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY`). Limites calibrados para não barrar usuários legítimos. |
| **Cabeçalhos** | CSP, HSTS (produção), X-Frame-Options, X-Content-Type-Options, Referrer-Policy e Permissions-Policy. CORS fechado por padrão. |
| **Segredos** | Só em variáveis de ambiente. O servidor **recusa iniciar em produção** com o segredo de desenvolvimento. Os logs nunca registram cookies, tokens ou query string. |
| **Auditoria** | Quem, ação, data/hora, recurso, resultado e IP. Senhas, tokens e CPF são filtrados automaticamente. |

---

## 5. Privacidade e LGPD

- Coleta mínima: nome e telefone. E-mail é opcional. CPF e nascimento só se a clínica exigir. Nenhum dado de saúde é pedido.
- Nada de dados pessoais em páginas públicas. Para o paciente, o telefone aparece mascarado: `(91) 9****-7777`.
- **Consentimento registrado** (política de privacidade + mensagens), com versão e data.
- **Política de privacidade** pronta e editável em *Configurações*.
- No painel, CPF completo só para administradores. Recepção vê o CPF mascarado.
- **Direitos do titular:** exportar os dados do paciente (JSON) e **anonimizar**, que apaga os dados pessoais e mantém o histórico estatístico.
- O IP de quem agenda é guardado só como hash (para detectar abuso).
- Agendamentos nunca são apagados: o status muda e o histórico interno fica.

---

## 6. Colocar no ar (produção)

Requisitos: um servidor (VPS) com **Docker** e um **domínio** apontando para ele (ex.: `agendamento.jrsaude.com.br`).

```bash
git clone <este repositório> jrsaude && cd jrsaude
cp .env.example .env
nano .env        # preencha DOMAIN, POSTGRES_PASSWORD, APP_SECRET e INITIAL_ADMIN_EMAIL
#  gerar segredos:  openssl rand -base64 48
docker compose up -d --build
docker compose logs app | grep -A3 "administrador"   # senha temporária do admin (se não definiu INITIAL_ADMIN_PASSWORD)
```

O `docker-compose.yml` sobe:
- **db**: PostgreSQL 16, sem acesso pela internet.
- **app**: o sistema. No primeiro início, ele cria sozinho os serviços, feriados, modelos de mensagem e o administrador.
- **caddy**: HTTPS automático (Let's Encrypt).
- **backup**: backup diário às 03:15, com retenção.

Acesse `https://SEU_DOMINIO/admin`, entre com o administrador e troque a senha.

Sem Docker: Node.js 20+ e PostgreSQL 14+. Rode `npm ci && npm run build`, configure o `.env` (com `DATABASE_URL`) e use `npm start` atrás de um proxy HTTPS com `TRUST_PROXY=1`.

Para atualizar: `git pull && docker compose up -d --build`. As migrações do banco rodam sozinhas.

---

## 7. Checklist antes de abrir para os pacientes

1. **Configurações:** endereço, link do Google Maps, telefone, WhatsApp, horário de funcionamento, Instagram (o painel avisa o que falta).
2. **Profissionais:** cadastre os **profissionais reais** com foto, registro (CRM/CREFITO...), serviços e grade semanal. As "equipes" de exame (Coleta, Exames Cardiológicos, Ultrassonografia) já vêm criadas. Ajuste os horários delas.
3. **Serviços:** revise durações, preparos e quais exames precisam de escolha de profissional.
4. **Feriados:** inclua os municipais e estaduais.
5. **Regras:** prazo de cancelamento (padrão 2h), antecedência mínima e máxima.
6. **Mensagens:** configure o provedor de WhatsApp (ou use o modo manual), o WhatsApp da recepção e o link de avaliação do Google.
7. **Usuários:** crie um usuário para cada pessoa da recepção (não compartilhe senha).
8. **Privacidade:** revise a política com o responsável jurídico e preencha o contato do encarregado.
9. Recomendado: ative o **Cloudflare Turnstile** (gratuito) contra robôs.

> Os profissionais com nomes fictícios ("Dra. Ana Silva" etc.) existem **só** quando você roda `npm run seed:demo` em desenvolvimento. A instalação de produção não os cria.

---

## 8. Backup e restauração

- **Automático** (serviço `backup`): um backup por dia, verificado com `pg_restore --list`. Guarda 14 diários, 8 semanais (domingo) e 12 mensais (dia 1) em `./backups`.
- **Manual:** `docker compose exec backup /scripts/backup.sh`
- **Restaurar** (cria antes um backup de segurança do estado atual):
  ```bash
  docker compose stop app
  docker compose run --rm -e CONFIRM=SIM backup /scripts/restore.sh /backups/daily/clinica-AAAAMMDD-HHMMSS.dump
  docker compose start app
  ```
- **Fora do servidor (recomendado):** copie `./backups` diariamente para outro local, como Google Drive ou S3 via `rclone`, ou um storage com retenção/imutabilidade. Backup no mesmo disco não protege contra perda do servidor.
- **Teste a restauração** periodicamente em outro ambiente.
- **Proteção contra exclusão acidental:** o sistema não apaga agendamentos, só muda o status. Profissionais e serviços são desativados, não excluídos. Toda remoção de bloqueio ou feriado fica na auditoria.
- Backup não substitui segurança: mantenha o servidor atualizado, o firewall liberando apenas as portas 80 e 443, e o acesso SSH só por chave.

---

## 9. Desenvolvimento e testes

```bash
npm install
cp .env.example .env    # ajuste DATABASE_URL para seu PostgreSQL local e NODE_ENV=development
npm run seed:demo       # banco + dados base + profissionais fictícios
npm run dev             # API em :3000 e site em http://localhost:5173
```

Testes:

```bash
npm test                # 46 testes de integração (API + PostgreSQL real)
npm run test:e2e        # testes no navegador (celular Pixel 7 e desktop) com Playwright
```

Cenários cobertos: agendamento normal · horário ocupado · **12 reservas simultâneas** (só 1 passa) · cancelamento (libera o horário, mantém histórico, respeita prazo) · bloqueio de horário e feriado · alteração de agenda e horário especial · login (cookie seguro, hash Argon2id, mensagem genérica) · força bruta · acesso sem permissão (recepção, profissional, escalada de privilégio, IDOR, CSRF) · expiração de sessão (inatividade e tempo máximo) · validação de dados · rate limiting e limites por telefone/IP · automações (agenda diária, lembrete de cancelado, liberação de não confirmados, conclusão automática) · fluxo completo no celular sem rolagem horizontal.

A CI (GitHub Actions) roda typecheck, testes de integração, build e E2E a cada push.

---

## 10. Estrutura e API

```
server/   API (Node.js + Fastify + PostgreSQL)
  src/routes/public.ts          rotas públicas
  src/routes/admin/*            rotas do painel (autenticação + RBAC)
  src/services/availability.ts  motor de disponibilidade
  src/services/appointments.ts  agendar / remarcar / cancelar (transações)
  src/services/notifications/*  modelos, fila, provedores e envio
  src/jobs/scheduler.ts         automações em segundo plano
  src/db/migrations/*.sql       estrutura do banco
web/      Frontend (React + Vite) — site do paciente e painel /admin
e2e/      Testes de ponta a ponta (Playwright)
scripts/  backup.sh / restore.sh
```

Entidades: `users`, `roles`, `sessions`, `patients`, `professionals`, `services`, `professional_services`, `schedules`, `schedule_overrides`, `blocked_times`, `holidays`, `appointments`, `appointment_events`, `consents`, `notifications`, `message_templates`, `audit_logs`, `clinic_settings`.

Status do agendamento: `PENDING` · `CONFIRMED` · `COMPLETED` · `CANCELLED` · `NO_SHOW`.

**API pública:** `GET /api/public/clinic` · `GET /api/services` · `GET /api/professionals?serviceId=` · `GET /api/availability/dates?serviceId&professionalId&month` · `GET /api/availability?serviceId&professionalId&date` · `POST /api/appointments` · `POST /api/appointments/lookup` · `GET /api/appointments/:id` · `POST /api/appointments/:id/confirm|cancel|reschedule` · `GET /api/appointments/:id/calendar.ics` (as rotas `/:id` exigem o token de acesso)

**API administrativa** (sessão + CSRF + permissão): `POST /api/admin/login|logout` · `GET /api/admin/me` · `GET /api/admin/dashboard` · `GET|POST /api/admin/appointments` · `POST /api/admin/appointments/:id/status|cancel|reschedule` · `GET|POST|PUT /api/admin/professionals` · `PUT /api/admin/professionals/:id/schedule` · `POST /api/admin/professionals/:id/overrides` · `GET|POST|PUT /api/admin/services` · `GET|POST|DELETE /api/admin/block-times` · `GET|POST|DELETE /api/admin/holidays` · `GET|PUT /api/admin/settings` · `GET|PUT /api/admin/templates` · `GET /api/admin/notifications` · `GET|POST|PUT /api/admin/users` · `GET /api/admin/audit-logs` · `GET /api/admin/patients`

Criar ou recuperar um administrador pelo terminal: `docker compose exec app node dist/db/create-admin-cli.js email@clinica.com SUPER_ADMIN "Nome"`
