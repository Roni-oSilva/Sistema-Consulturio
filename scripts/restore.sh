#!/bin/sh
# =====================================================================
# Restaura um backup no banco. ATENÇÃO: substitui os dados atuais.
# Uso (com docker compose):
#   docker compose stop app
#   docker compose run --rm -e CONFIRM=SIM backup /scripts/restore.sh /backups/daily/clinica-AAAAMMDD-HHMMSS.dump
#   docker compose start app
# Antes de restaurar, um backup de segurança do estado atual é criado.
# =====================================================================
set -eu
FILE="${1:-}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "Informe o arquivo de backup. Disponíveis:"; ls -1t "${BACKUP_DIR:-/backups}"/*/*.dump 2>/dev/null | head -20
  exit 1
fi
if [ "${CONFIRM:-}" != "SIM" ]; then
  echo "Isto vai SUBSTITUIR o banco atual por $FILE."
  echo "Execute novamente com CONFIRM=SIM para prosseguir."
  exit 1
fi
pg_restore --list "$FILE" > /dev/null
SAFETY="${BACKUP_DIR:-/backups}/pre-restore-$(date +%Y%m%d-%H%M%S).dump"
echo "[restore] backup de segurança do estado atual -> $SAFETY"
pg_dump --format=custom --no-owner --file="$SAFETY"
echo "[restore] restaurando $FILE ..."
pg_restore --clean --if-exists --no-owner --single-transaction --dbname="$PGDATABASE" "$FILE"
echo "[restore] concluído. Reinicie a aplicação: docker compose start app"
