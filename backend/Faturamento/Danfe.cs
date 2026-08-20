using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

public static class Danfe
{
    static readonly string LogoPath = Path.Combine(AppContext.BaseDirectory, "korp.png");

    public static byte[] Gerar(Nota nota) => Document.Create(doc =>
    {
        doc.Page(page =>
        {
            page.Size(PageSizes.A4);
            page.Margin(2, Unit.Centimetre);
            page.DefaultTextStyle(t => t.FontSize(10).FontColor("#2b3a44"));

            page.Header().Row(row =>
            {
                if (File.Exists(LogoPath))
                    row.ConstantItem(4, Unit.Centimetre).AlignMiddle().Image(LogoPath);

                row.RelativeItem().AlignRight().Column(col =>
                {
                    col.Item().Text("NOTA FISCAL").FontSize(16).Bold();
                    col.Item().Text($"Nº {nota.Numero:D6}").FontSize(12);
                    col.Item().Text($"Emitida em {nota.CriadaEm:dd/MM/yyyy HH:mm}");
                    col.Item().Text($"Status: {nota.Status}");
                });
            });

            page.Content().PaddingVertical(1, Unit.Centimetre).Table(table =>
            {
                table.ColumnsDefinition(c =>
                {
                    c.ConstantColumn(3, Unit.Centimetre);
                    c.RelativeColumn();
                    c.ConstantColumn(2.5f, Unit.Centimetre);
                });

                table.Header(h =>
                {
                    h.Cell().Element(Cabecalho).Text("Código");
                    h.Cell().Element(Cabecalho).Text("Descrição");
                    h.Cell().Element(Cabecalho).AlignRight().Text("Qtde");
                });

                foreach (var item in nota.Itens)
                {
                    table.Cell().Element(Celula).Text(item.Codigo);
                    table.Cell().Element(Celula).Text(item.Descricao);
                    table.Cell().Element(Celula).AlignRight().Text(item.Quantidade.ToString());
                }

                table.Cell().ColumnSpan(2).Element(Celula).AlignRight().Text("Total de itens").Bold();
                table.Cell().Element(Celula).AlignRight().Text(nota.Itens.Sum(i => i.Quantidade).ToString()).Bold();

                static IContainer Cabecalho(IContainer c) =>
                    c.Background("#2b3a44").PaddingVertical(5).PaddingHorizontal(6).DefaultTextStyle(t => t.FontColor("#ffffff").SemiBold());

                static IContainer Celula(IContainer c) =>
                    c.BorderBottom(1).BorderColor("#e2e6e9").PaddingVertical(5).PaddingHorizontal(6);
            });

            page.Footer().AlignCenter().Text(t =>
            {
                t.Span("Documento gerado pelo sistema de faturamento em ");
                t.Span($"{DateTime.Now:dd/MM/yyyy HH:mm}");
            });
        });
    }).GeneratePdf();
}
