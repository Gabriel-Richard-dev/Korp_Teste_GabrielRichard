# Sistema de emissão de Notas Fiscais

Angular 20 + PrimeNG no front e dois microsserviços .NET 8 no back, cada um com seu SQLite.

- `backend/Estoque` (porta 5001): produtos e saldos
- `backend/Faturamento` (porta 5002): notas fiscais e impressão
- `frontend` (porta 4200): telas de produtos e notas

## Como rodar

```bash
docker compose up --build
```

O compose sobe estoque, faturamento, frontend e o Ollama, que baixa o modelo `llama3.2:1b` (1,3 GB) na
primeira execução. Acesse http://localhost:4200. O nginx do container do front faz proxy de `/api/estoque` e
`/api/faturamento` para os serviços.

Sem Docker:

```bash
dotnet run --project backend/Estoque
dotnet run --project backend/Faturamento
cd frontend && npm install && npm start
```

Os bancos são criados na primeira execução.

### Variáveis de ambiente

Todas têm valor padrão e já vêm definidas no compose.

- `ConnectionStrings__Default`: banco de cada serviço. Padrão `Data Source=estoque.db` e
  `Data Source=faturamento.db`; no compose apontam para o volume em `/dados`.
- `Estoque__BaseUrl` (Faturamento): endereço do serviço de Estoque. Padrão `http://localhost:5001`,
  no compose `http://estoque:8080`.
- `Ia__BaseUrl` (Estoque): endereço do Ollama. Padrão `http://localhost:11434`, no compose
  `http://ollama:11434`.
- `Ia__Modelo` (Estoque): modelo usado no chat. Padrão `llama3.2:1b`.

O front não usa variável: chama caminhos relativos, resolvidos pelo nginx no Docker e pelo
`proxy.conf.json` no `ng serve`.

### Testes

`./backend/smoke.sh` sobe (ou reaproveita) os dois serviços e valida cadastro, impressão, baixa de
saldo, saldo insuficiente, idempotência, queda do Estoque e concorrência.

## Funcionalidades

- Cadastro de produtos com código único, descrição e saldo.
- Edição de produto, entrada de saldo e ativação/desativação. Produto inativo não entra em nota nova e
  bloqueia a impressão de notas que o contenham.
- Chat de estoque no canto da tela: cadastra produto, soma saldo e lista o estoque a partir de texto
  livre, rodando num modelo local.
- Cadastro de notas com numeração sequencial, status inicial Aberta e vários produtos por nota.
- Impressão com indicador de processamento. Ao concluir, a nota vira Fechada, o saldo dos produtos é
  debitado e o PDF da nota abre em outra aba. Nota que não está Aberta não imprime, mas o PDF continua
  disponível pelo botão "Ver PDF".
- Switch na tela de notas que derruba o serviço de Estoque para demonstrar o tratamento de falha.

## Detalhamento técnico

**Ciclos de vida do Angular.** `ngOnInit` nas duas telas para a carga inicial, que é o gancho certo
para I/O e mantém o construtor limpo. O estado é reativo com signals, então não houve necessidade de
`ngOnChanges` ou `ngDoCheck`. Sem `ngOnDestroy` porque as chamadas de `HttpClient` completam sozinhas.

**RxJS.** Usado sobre os observables do `HttpClient`: `catchError` com `throwError` em `api.ts`,
traduzindo qualquer `HttpErrorResponse` na mensagem que o usuário lê; `finalize` para desligar os
indicadores de loading no sucesso e no erro; `switchMap` na impressão, encadeando imprimir e
recarregar a lista numa assinatura só.

**Bibliotecas.** No front, PrimeNG com o tema Aura (`@primeuix/themes`) e `primeicons` para os
componentes visuais: `p-table` com linhas expansíveis, `p-dialog`, `p-select` com filtro,
`p-inputnumber`, `p-tag` de status, `p-toast` para feedback, `p-toggleswitch` e botões com loading.
Formulários com `FormsModule`, suficiente para o tamanho das telas. No back, EF Core 8 com provider
SQLite, `Microsoft.Extensions.Http.Resilience` para retry, timeout e circuit breaker na chamada entre
os serviços, e QuestPDF para gerar o PDF da nota em `GET /notas/{id}/pdf`.

**Framework no C#.** ASP.NET Core 8 com Minimal APIs. Cada serviço cabe em um `Program.cs` legível,
sem controllers nem camadas que não se pagam neste escopo.

**LINQ.** Usado nas consultas traduzidas para SQL (`OrderBy`, `Include`, `AnyAsync` para código
duplicado, `MaxAsync` para o próximo número da nota) e nas projeções em memória (`Select` montando os
itens, `Any` na validação de entrada). A exceção é a baixa de saldo, em SQL parametrizado pelo motivo
descrito abaixo.

**Erros e exceções.** Validação de entrada nos dois serviços devolve 400 ou 409 com mensagem pronta
para exibição. Regras de negócio viram status com significado: 409 para nota já fechada e para saldo
insuficiente, 404 para nota ou produto inexistente. A chamada ao Estoque é envolvida em `try/catch` e
tem o status inspecionado; qualquer indisponibilidade vira 503 com aviso de que a nota segue Aberta, e
o erro real vai para o `ILogger`. Como a nota só muda para Fechada depois da baixa confirmada, ela
nunca fica inconsistente. Exceções não previstas caem em `UseExceptionHandler` com `ProblemDetails`.

**IA.** O chat conversa com um modelo local (`llama3.2:1b` no Ollama, subido pelo próprio compose), sem
chave de API e sem serviço externo. O endpoint `POST /chat` manda o histórico junto do catálogo atual e
usa o structured output do Ollama: o schema JSON obriga a resposta a trazer `acao`
(cadastrar, entrada, consultar ou conversar), `codigo`, `descricao`, `quantidade` e `resposta`. Como o
modelo é pequeno, a classificação é guiada por exemplos no prompt e o schema exige todos os campos,
senão ele devolve só os obrigatórios. Quem executa a ação é o backend, pela mesma validação do cadastro
manual, então código duplicado ou produto inexistente são barrados igual. Modelo fora do ar vira 503 e o
chat mostra o aviso.

**Concorrência.** A baixa de saldo é uma instrução atômica
`UPDATE Produtos SET Saldo = Saldo - @q WHERE Id = @id AND Saldo >= @q` dentro de uma transação. Com
duas notas disputando o mesmo saldo, uma afeta a linha e a outra recebe zero linhas afetadas, faz
rollback e recebe 409 com o saldo real. Sem lost update e sem saldo negativo.

**Idempotência.** O Faturamento envia a chave `NOTA-{numero}` na baixa e o Estoque guarda as chaves já
aplicadas. Repetir a impressão, por duplo clique ou retry, devolve sucesso sem debitar de novo.
