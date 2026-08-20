#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! (curl -sf localhost:5001/produtos >/dev/null && curl -sf localhost:5002/notas >/dev/null); then
  rm -f Estoque/estoque.db Faturamento/faturamento.db
  dotnet run --project Estoque > /tmp/estoque.log 2>&1 & E=$!
  dotnet run --project Faturamento > /tmp/faturamento.log 2>&1 & F=$!
  trap 'kill $E $F 2>/dev/null || true' EXIT
  for i in $(seq 40); do curl -sf localhost:5001/produtos >/dev/null && curl -sf localhost:5002/notas >/dev/null && break; sleep 1; done
fi

j() { curl -s -o /tmp/body -w '%{http_code}' "$@"; }
campo() { grep -o "\"$1\":[0-9]*" /tmp/body | head -1 | cut -d: -f2; }
falhou() { echo "FALHA: $1"; cat /tmp/body; echo; exit 1; }
COD="P-$RANDOM"
saldo() { curl -s localhost:5001/produtos/$PID -o /tmp/p; grep -o '"saldo":[0-9]*' /tmp/p | cut -d: -f2; }
nota() { # $1 = quantidade -> ecoa id da nota criada
  j -X POST localhost:5002/notas -H 'content-type: application/json' \
    -d "{\"itens\":[{\"produtoId\":$PID,\"codigo\":\"$COD\",\"descricao\":\"Teclado\",\"quantidade\":$1}]}" >/dev/null
  campo id
}

j -X POST localhost:5001/produtos -H 'content-type: application/json' -d "{\"codigo\":\"$COD\",\"descricao\":\"Teclado\",\"saldo\":10}" >/dev/null
PID=$(campo id)
[ -n "$PID" ] || falhou "cadastro de produto"
[ "$(j -X POST localhost:5001/produtos -H 'content-type: application/json' -d "{\"codigo\":\"$COD\",\"descricao\":\"Dup\",\"saldo\":1}")" = 409 ] || falhou "código duplicado aceito"

j -X PUT localhost:5001/produtos/$PID -H 'content-type: application/json' -d "{\"codigo\":\"$COD\",\"descricao\":\"Teclado ABNT2\",\"ativo\":true}" >/dev/null
grep -q 'Teclado ABNT2' /tmp/body || falhou "edição do produto"
[ "$(j -X POST localhost:5001/produtos/$PID/entrada -H 'content-type: application/json' -d '{"quantidade":5}')" = 200 ] || falhou "entrada de saldo"
[ "$(saldo)" = 15 ] || falhou "saldo esperado 15 após entrada, veio $(saldo)"
[ "$(j -X POST localhost:5001/produtos/$PID/entrada -H 'content-type: application/json' -d '{"quantidade":-1}')" = 400 ] || falhou "entrada negativa aceita"

NIA=$(nota 1)
j -X PUT localhost:5001/produtos/$PID -H 'content-type: application/json' -d "{\"codigo\":\"$COD\",\"descricao\":\"Teclado ABNT2\",\"ativo\":false}" >/dev/null
[ "$(j -X POST localhost:5002/notas/$NIA/imprimir)" = 409 ] || falhou "imprimiu com produto inativo"
j -X PUT localhost:5001/produtos/$PID -H 'content-type: application/json' -d "{\"codigo\":\"$COD\",\"descricao\":\"Teclado ABNT2\",\"ativo\":true}" >/dev/null
[ "$(j -X POST localhost:5002/notas/$NIA/imprimir)" = 200 ] || falhou "impressão após reativar"

NID=$(nota 2)
NUM=$(grep -o '"numero":[0-9]*' /tmp/body | head -1 | cut -d: -f2)
[ "$(j -X POST localhost:5002/notas/$NID/imprimir)" = 200 ] || falhou "impressão"
[ "$(saldo)" = 12 ] || falhou "saldo esperado 12, veio $(saldo)"
[ "$(j -X POST localhost:5002/notas/$NID/imprimir)" = 409 ] || falhou "nota Fechada foi impressa de novo"

j -X POST localhost:5001/baixas -H 'content-type: application/json' \
  -d "{\"chave\":\"NOTA-$NUM\",\"itens\":[{\"produtoId\":$PID,\"quantidade\":2}]}" >/dev/null
[ "$(saldo)" = 12 ] || falhou "baixa repetida alterou o saldo"

N2=$(nota 99)
[ "$(j -X POST localhost:5002/notas/$N2/imprimir)" = 409 ] || falhou "imprimiu sem saldo"

curl -sf -X POST 'localhost:5001/admin/falha?ativa=true' | grep -q '"falhaAtiva":true' || falhou "não consegui ligar a falha do Estoque"
[ "$(j -X POST localhost:5002/notas/$N2/imprimir)" = 503 ] || falhou "esperado 503 com o Estoque fora"
curl -s -X POST 'localhost:5001/admin/falha?ativa=false' >/dev/null
curl -s localhost:5002/notas/$N2 | grep -q '"status":"Aberta"' || falhou "nota deveria seguir Aberta"

for i in $(seq 8); do ids[$i]=$(nota 2); done
for i in $(seq 8); do curl -s -o /dev/null -X POST localhost:5002/notas/${ids[$i]}/imprimir & done; wait
[ "$(saldo)" -ge 0 ] || falhou "saldo negativo: $(saldo)"
echo "OK (saldo final de $COD: $(saldo))"
