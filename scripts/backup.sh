#!/bin/sh
# =====================================================================
# Backup do banco de dados (PostgreSQL) com retenção automática.
#  - diário:   KEEP_DAILY   cópias (padrão 14)
#  - semanal:  KEEP_WEEKLY  cópias (domingo, padrão 8)
#  - mensal:   KEEP_MONTHLY cópias (dia 1, padrão 12)
# Cada arquivo é verificado (pg_restore --list) logo após ser criado.
# Variáveis: PGHOST PGUSER PGDATABASE PGPASSWORD BACKUP_DIR
# =====================================================================
set -eu
BACKUP_DIR="${BACKUP_DIR:-/backups}"
KEEP_DAILY="${KEEP_DAILY:-14}"
KEEP_WEEKLY="${KEEP_WEEKLY:-8}"
KEEP_MONTHLY="${KEEP_MONTHLY:-12}"
STAMP="$(date +%Y%m%d-%H%M%S)"
umask 077
mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly" "$BACKUP_DIR/monthly"

FILE="$BACKUP_DIR/daily/clinica-$STAMP.dump"
TMP="$FILE.partial"
echo "[backup] $(date -Iseconds) iniciando -> $FILE"
pg_dump --format=custom --compress=9 --no-owner --file="$TMP"
# verificação: o arquivo precisa ser legível pelo pg_restore
pg_restore --list "$TMP" > /dev/null
mv "$TMP" "$FILE"

[ "$(date +%u)" = "7" ] && cp "$FILE" "$BACKUP_DIR/weekly/"
[ "$(date +%d)" = "01" ] && cp "$FILE" "$BACKUP_DIR/monthly/"

prune() { # mantém os N arquivos mais recentes
  ls -1t "$1"/*.dump 2>/dev/null | tail -n +"$(( $2 + 1 ))" | while read -r old; do rm -f "$old"; done
}
prune "$BACKUP_DIR/daily" "$KEEP_DAILY"
prune "$BACKUP_DIR/weekly" "$KEEP_WEEKLY"
prune "$BACKUP_DIR/monthly" "$KEEP_MONTHLY"

echo "[backup] $(date -Iseconds) concluído ($(du -h "$FILE" | cut -f1))"
