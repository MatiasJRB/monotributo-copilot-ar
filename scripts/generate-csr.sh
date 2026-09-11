#!/usr/bin/env bash
set -euo pipefail
ENVIRONMENT="${1:-homo}"
if [[ "$ENVIRONMENT" != "homo" && "$ENVIRONMENT" != "prod" ]]; then
  echo "Uso: $0 homo|prod" >&2
  exit 1
fi
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/secrets/$ENVIRONMENT"
mkdir -p "$OUT"
chmod 700 "$ROOT/secrets" "$OUT" || true
: "${ARCA_CUIT:?Definí ARCA_CUIT con los 11 dígitos del contribuyente}"
CUIT="$ARCA_CUIT"
NAME="${ARCA_CERT_NAME:-MonotributoCopilot${ENVIRONMENT}}"
ORG="${ARCA_CERT_ORG:-Contribuyente}"
KEY="$OUT/arca-$ENVIRONMENT.key"
CSR="$OUT/arca-$ENVIRONMENT.csr"
if [[ -f "$KEY" ]]; then
  echo "Ya existe key: $KEY" >&2
else
  openssl genrsa -out "$KEY" 2048
  chmod 600 "$KEY"
fi
openssl req -new -key "$KEY" -subj "/C=AR/O=$ORG/CN=$NAME/serialNumber=CUIT $CUIT" -out "$CSR"
chmod 600 "$CSR"
echo "CSR generado: $CSR"
echo "Key privada:  $KEY"
echo "Subí el contenido del CSR en ARCA y descargá el certificado como: $OUT/arca-$ENVIRONMENT.crt"
