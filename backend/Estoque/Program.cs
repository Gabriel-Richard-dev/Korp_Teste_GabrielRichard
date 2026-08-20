using System.Text.Json;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddDbContext<EstoqueDb>(o => o.UseSqlite(builder.Configuration.GetConnectionString("Default") ?? "Data Source=estoque.db"));
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));
builder.Services.AddProblemDetails();
builder.Services.AddHttpClient("ia", c =>
{
    c.BaseAddress = new Uri(builder.Configuration["Ia:BaseUrl"] ?? "http://localhost:11434");
    c.Timeout = TimeSpan.FromMinutes(3);
});

var app = builder.Build();
app.UseExceptionHandler();
app.UseCors();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<EstoqueDb>();
    db.Database.EnsureCreated();
}

var indisponivel = false;
app.MapPost("/admin/falha", (bool ativa) => Results.Ok(new { falhaAtiva = indisponivel = ativa }));
app.MapGet("/admin/falha", () => Results.Ok(new { falhaAtiva = indisponivel }));
app.Use(async (ctx, next) =>
{
    if (indisponivel && !ctx.Request.Path.StartsWithSegments("/admin"))
    {
        await Results.Problem("Estoque indisponível.", statusCode: 503).ExecuteAsync(ctx);
        return;
    }
    await next();
});

app.MapGet("/produtos", (EstoqueDb db) =>
    db.Produtos.OrderBy(p => p.Codigo).ToListAsync());

app.MapGet("/produtos/{id:int}", async (int id, EstoqueDb db) =>
    await db.Produtos.FindAsync(id) is { } p ? Results.Ok(p) : Results.NotFound());

async Task<(Produto? Produto, string? Erro)> NovoProduto(Produto p, EstoqueDb db)
{
    if (string.IsNullOrWhiteSpace(p.Codigo) || string.IsNullOrWhiteSpace(p.Descricao))
        return (null, "Código e descrição são obrigatórios.");
    if (p.Saldo < 0)
        return (null, "Saldo não pode ser negativo.");
    if (await db.Produtos.AnyAsync(x => x.Codigo == p.Codigo))
        return (null, $"Código {p.Codigo} já cadastrado.");

    db.Produtos.Add(p);
    await db.SaveChangesAsync();
    return (p, null);
}

app.MapPost("/produtos", async (Produto p, EstoqueDb db) =>
{
    var (produto, erro) = await NovoProduto(p, db);
    return erro is null
        ? Results.Created($"/produtos/{produto!.Id}", produto)
        : Results.Conflict(new { erro });
});

app.MapPut("/produtos/{id:int}", async (int id, Produto dados, EstoqueDb db) =>
{
    var produto = await db.Produtos.FindAsync(id);
    if (produto is null) return Results.NotFound(new { erro = "Produto não encontrado." });

    if (string.IsNullOrWhiteSpace(dados.Codigo) || string.IsNullOrWhiteSpace(dados.Descricao))
        return Results.BadRequest(new { erro = "Código e descrição são obrigatórios." });
    if (await db.Produtos.AnyAsync(x => x.Codigo == dados.Codigo && x.Id != id))
        return Results.Conflict(new { erro = $"Código {dados.Codigo} já cadastrado." });

    produto.Codigo = dados.Codigo;
    produto.Descricao = dados.Descricao;
    produto.Ativo = dados.Ativo;
    await db.SaveChangesAsync();
    return Results.Ok(produto);
});

app.MapPost("/produtos/{id:int}/entrada", async (int id, Movimento req, EstoqueDb db) =>
{
    if (req.Quantidade <= 0)
        return Results.BadRequest(new { erro = "Quantidade deve ser maior que zero." });

    var afetadas = await db.Database.ExecuteSqlInterpolatedAsync(
        $"UPDATE Produtos SET Saldo = Saldo + {req.Quantidade} WHERE Id = {id}");
    if (afetadas == 0) return Results.NotFound(new { erro = "Produto não encontrado." });

    return Results.Ok(await db.Produtos.AsNoTracking().FirstAsync(p => p.Id == id));
});

app.MapPost("/chat", async (Conversa req, EstoqueDb db, IHttpClientFactory http, IConfiguration cfg, ILogger<Program> log) =>
{
    if (req.Mensagens is not { Count: > 0 })
        return Results.BadRequest(new { erro = "Envie ao menos uma mensagem." });

    var catalogo = await db.Produtos.OrderBy(p => p.Codigo)
        .Select(p => new { p.Codigo, p.Descricao, p.Saldo, p.Ativo }).ToListAsync();

    var instrucoes = $$"""
        Você é o assistente de estoque de um sistema de notas fiscais. Responda em português.
        Ações: cadastrar (produto novo), entrada (somar saldo a produto existente), consultar (listar produtos), conversar (saudações, dúvidas e demais casos).
        Preencha sempre todos os campos: codigo (maiúsculas, invente um curto se o usuário não der), descricao (nome do produto), quantidade (o número de unidades citado, 0 se nenhum), resposta (uma frase curta para o usuário).
        Só use cadastrar ou entrada quando a mensagem atual do usuário pedir isso. Nunca repita os exemplos abaixo.
        Exemplo: "cadastre 20 teclados mecânicos código TEC20" -> {"acao":"cadastrar","codigo":"TEC20","descricao":"Teclado mecânico","quantidade":20,"resposta":"Cadastrando o teclado mecânico."}
        Exemplo: "chegaram mais 5 do TEC20" -> {"acao":"entrada","codigo":"TEC20","descricao":"","quantidade":5,"resposta":"Somando 5 ao saldo."}
        Exemplo: "bom dia" -> {"acao":"conversar","codigo":"","descricao":"","quantidade":0,"resposta":"Bom dia! Posso cadastrar produtos ou consultar o estoque."}
        Produtos atuais: {{JsonSerializer.Serialize(catalogo)}}
        """;

    var mensagens = new List<object> { new { role = "system", content = instrucoes } };
    mensagens.AddRange(req.Mensagens.TakeLast(10).Select(m => new
    {
        role = m.Papel == "assistant" ? "assistant" : "user",
        content = m.Texto
    }));

    Intencao? intencao;
    try
    {
        var resposta = await http.CreateClient("ia").PostAsJsonAsync("/api/chat", new
        {
            model = cfg["Ia:Modelo"] ?? "llama3.2:1b",
            stream = false,
            options = new { temperature = 0 },
            format = new
            {
                type = "object",
                properties = new
                {
                    acao = new { type = "string", @enum = new[] { "cadastrar", "entrada", "consultar", "conversar" } },
                    codigo = new { type = "string" },
                    descricao = new { type = "string" },
                    quantidade = new { type = "integer" },
                    resposta = new { type = "string" }
                },
                required = new[] { "acao", "codigo", "descricao", "quantidade", "resposta" }
            },
            messages = mensagens
        });

        if (!resposta.IsSuccessStatusCode)
            return Results.Problem("Assistente indisponível. Verifique se o serviço do modelo está no ar.", statusCode: 503);

        var corpo = await resposta.Content.ReadFromJsonAsync<OllamaResposta>();
        intencao = JsonSerializer.Deserialize<Intencao>(corpo?.Message?.Content ?? "",
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
    }
    catch (Exception ex)
    {
        log.LogError(ex, "Falha ao falar com o modelo");
        return Results.Problem("Assistente indisponível. Verifique se o serviço do modelo está no ar.", statusCode: 503);
    }

    if (intencao is null)
        return Results.Ok(new ChatResposta("Não entendi. Pode reescrever?", false));

    switch (intencao.Acao)
    {
        case "cadastrar":
        {
            var (produto, erro) = await NovoProduto(new Produto
            {
                Codigo = (intencao.Codigo ?? "").Trim().ToUpperInvariant(),
                Descricao = (intencao.Descricao ?? "").Trim(),
                Saldo = Math.Max(intencao.Quantidade ?? 0, 0)
            }, db);

            return Results.Ok(erro is null
                ? new ChatResposta($"Cadastrei {produto!.Codigo} - {produto.Descricao} com saldo {produto.Saldo}.", true)
                : new ChatResposta(erro, false));
        }
        case "entrada":
        {
            var codigo = (intencao.Codigo ?? "").Trim();
            var quantidade = intencao.Quantidade ?? 0;
            if (quantidade <= 0)
                return Results.Ok(new ChatResposta("Quantas unidades você quer somar ao saldo?", false));

            var alvo = await db.Produtos.FirstOrDefaultAsync(p => p.Codigo == codigo);
            if (alvo is null)
                return Results.Ok(new ChatResposta($"Não encontrei o produto {codigo}.", false));

            alvo.Saldo += quantidade;
            await db.SaveChangesAsync();
            return Results.Ok(new ChatResposta($"Somei {quantidade} ao saldo de {alvo.Descricao}. Novo saldo: {alvo.Saldo}.", true));
        }
        case "consultar":
        {
            var lista = catalogo.Count == 0
                ? "Não há produtos cadastrados."
                : string.Join("\n", catalogo.Select(p => $"{p.Codigo} - {p.Descricao}: {p.Saldo}" + (p.Ativo ? "" : " (inativo)")));
            return Results.Ok(new ChatResposta(lista, false));
        }
        default:
            return Results.Ok(new ChatResposta(intencao.Resposta ?? "Como posso ajudar com o estoque?", false));
    }
});

app.MapPost("/baixas", async (BaixaRequest req, EstoqueDb db) =>
{
    if (string.IsNullOrWhiteSpace(req.Chave) || req.Itens is not { Count: > 0 })
        return Results.BadRequest(new { erro = "Chave e itens são obrigatórios." });

    if (await db.Baixas.AnyAsync(b => b.Chave == req.Chave))
        return Results.Ok(new { idempotente = true });

    await using var tx = await db.Database.BeginTransactionAsync();
    foreach (var item in req.Itens)
    {
        if (item.Quantidade <= 0)
            return Results.BadRequest(new { erro = "Quantidade deve ser maior que zero." });

        var afetadas = await db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE Produtos SET Saldo = Saldo - {item.Quantidade} WHERE Id = {item.ProdutoId} AND Ativo = 1 AND Saldo >= {item.Quantidade}");
        if (afetadas == 0)
        {
            await tx.RollbackAsync();
            var prod = await db.Produtos.AsNoTracking().FirstOrDefaultAsync(p => p.Id == item.ProdutoId);
            return Results.Conflict(new
            {
                erro = prod is null
                    ? $"Produto {item.ProdutoId} não encontrado."
                    : !prod.Ativo
                        ? $"Produto {prod.Descricao} está inativo."
                        : $"Saldo insuficiente de {prod.Descricao}. Disponível: {prod.Saldo}."
            });
        }
    }
    db.Baixas.Add(new Baixa { Chave = req.Chave });
    await db.SaveChangesAsync();
    await tx.CommitAsync();
    return Results.Ok(new { idempotente = false });
});

app.Run();

public class Produto
{
    public int Id { get; set; }
    public string Codigo { get; set; } = "";
    public string Descricao { get; set; } = "";
    public int Saldo { get; set; }
    public bool Ativo { get; set; } = true;
}

public class Baixa
{
    public string Chave { get; set; } = "";
}

public record MensagemChat(string Papel, string Texto);
public record Conversa(List<MensagemChat> Mensagens);
public record ChatResposta(string Resposta, bool Recarregar);
public record Intencao(string? Acao, string? Codigo, string? Descricao, int? Quantidade, string? Resposta);
public record OllamaMensagem(string? Content);
public record OllamaResposta(OllamaMensagem? Message);
public record Movimento(int Quantidade);
public record BaixaItem(int ProdutoId, int Quantidade);
public record BaixaRequest(string Chave, List<BaixaItem> Itens);

public class EstoqueDb(DbContextOptions<EstoqueDb> options) : DbContext(options)
{
    public DbSet<Produto> Produtos => Set<Produto>();
    public DbSet<Baixa> Baixas => Set<Baixa>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Produto>().HasIndex(p => p.Codigo).IsUnique();
        b.Entity<Baixa>().HasKey(x => x.Chave);
    }
}
