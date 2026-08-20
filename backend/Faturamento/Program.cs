using System.Net;
using Microsoft.EntityFrameworkCore;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

QuestPDF.Settings.License = LicenseType.Community;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddDbContext<FaturamentoDb>(o => o.UseSqlite(builder.Configuration.GetConnectionString("Default") ?? "Data Source=faturamento.db"));
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));
builder.Services.AddProblemDetails();
builder.Services.AddHttpClient("estoque", c =>
{
    c.BaseAddress = new Uri(builder.Configuration["Estoque:BaseUrl"] ?? "http://localhost:5001");
}).AddStandardResilienceHandler();

var app = builder.Build();
app.UseExceptionHandler();
app.UseCors();

using (var scope = app.Services.CreateScope())
    scope.ServiceProvider.GetRequiredService<FaturamentoDb>().Database.EnsureCreated();

app.MapGet("/notas", (FaturamentoDb db) =>
    db.Notas.Include(n => n.Itens).OrderByDescending(n => n.Numero).ToListAsync());

app.MapGet("/notas/{id:int}", async (int id, FaturamentoDb db) =>
    await db.Notas.Include(n => n.Itens).FirstOrDefaultAsync(n => n.Id == id) is { } n
        ? Results.Ok(n) : Results.NotFound());

app.MapPost("/notas", async (NovaNota req, FaturamentoDb db) =>
{
    if (req.Itens is not { Count: > 0 })
        return Results.BadRequest(new { erro = "Informe ao menos um produto." });
    if (req.Itens.Any(i => i.Quantidade <= 0))
        return Results.BadRequest(new { erro = "Quantidade deve ser maior que zero." });

    await using var tx = await db.Database.BeginTransactionAsync();
    var nota = new Nota
    {
        Numero = await db.Notas.MaxAsync(n => (int?)n.Numero) + 1 ?? 1,
        Status = "Aberta",
        CriadaEm = DateTime.UtcNow,
        Itens = req.Itens.Select(i => new NotaItem
        {
            ProdutoId = i.ProdutoId, Codigo = i.Codigo, Descricao = i.Descricao, Quantidade = i.Quantidade
        }).ToList()
    };
    db.Notas.Add(nota);
    await db.SaveChangesAsync();
    await tx.CommitAsync();
    return Results.Created($"/notas/{nota.Id}", nota);
});

app.MapPost("/notas/{id:int}/imprimir", async (int id, FaturamentoDb db, IHttpClientFactory http, ILogger<Program> log) =>
{
    var nota = await db.Notas.Include(n => n.Itens).FirstOrDefaultAsync(n => n.Id == id);
    if (nota is null) return Results.NotFound(new { erro = "Nota não encontrada." });
    if (nota.Status != "Aberta")
        return Results.Conflict(new { erro = $"Nota {nota.Numero} está {nota.Status}. Só notas Abertas podem ser impressas." });

    HttpResponseMessage resp;
    try
    {
        resp = await http.CreateClient("estoque").PostAsJsonAsync("/baixas", new
        {
            chave = $"NOTA-{nota.Numero}",
            itens = nota.Itens.Select(i => new { produtoId = i.ProdutoId, quantidade = i.Quantidade })
        });
    }
    catch (Exception ex)
    {
        log.LogError(ex, "Estoque indisponível ao imprimir a nota {Numero}", nota.Numero);
        return Results.Problem("Estoque indisponível. A nota segue Aberta, tente novamente.", statusCode: 503);
    }

    if (resp.StatusCode == HttpStatusCode.Conflict)
    {
        var corpo = await resp.Content.ReadFromJsonAsync<ErroResposta>();
        return Results.Conflict(new { erro = corpo?.Erro ?? "Saldo insuficiente." });
    }
    if (!resp.IsSuccessStatusCode)
        return Results.Problem("Estoque indisponível. A nota segue Aberta, tente novamente.", statusCode: 503);

    nota.Status = "Fechada";
    nota.ImpressaEm = DateTime.UtcNow;
    await db.SaveChangesAsync();
    return Results.Ok(nota);
});

app.MapGet("/notas/{id:int}/pdf", async (int id, FaturamentoDb db) =>
{
    var nota = await db.Notas.Include(n => n.Itens).FirstOrDefaultAsync(n => n.Id == id);
    if (nota is null) return Results.NotFound(new { erro = "Nota não encontrada." });

    var pdf = Danfe.Gerar(nota);
    return Results.File(pdf, "application/pdf", $"nota-{nota.Numero}.pdf");
});

app.Run();

public class Nota
{
    public int Id { get; set; }
    public int Numero { get; set; }
    public string Status { get; set; } = "Aberta";
    public DateTime CriadaEm { get; set; }
    public DateTime? ImpressaEm { get; set; }
    public List<NotaItem> Itens { get; set; } = [];
}

public class NotaItem
{
    public int Id { get; set; }
    public int NotaId { get; set; }
    public int ProdutoId { get; set; }
    public string Codigo { get; set; } = "";
    public string Descricao { get; set; } = "";
    public int Quantidade { get; set; }
}

public record ItemEntrada(int ProdutoId, string Codigo, string Descricao, int Quantidade);
public record NovaNota(List<ItemEntrada> Itens);
public record ErroResposta(string Erro);

public class FaturamentoDb(DbContextOptions<FaturamentoDb> options) : DbContext(options)
{
    public DbSet<Nota> Notas => Set<Nota>();
    protected override void OnModelCreating(ModelBuilder b) =>
        b.Entity<Nota>().HasIndex(n => n.Numero).IsUnique();
}
