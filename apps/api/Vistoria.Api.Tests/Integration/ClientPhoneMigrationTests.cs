using AwesomeAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Vistoria.Api.Model.Context;
using Vistoria.Api.Tests.Support;

namespace Vistoria.Api.Tests.Integration;

/// <summary>
/// A migração dos telefones (ADR 0063), num banco próprio parado na migração de antes: os clientes entram com o
/// telefone como a API os aceitava, e a migração seguinte grava o canônico só no que se encaixa.
/// </summary>
public class ClientPhoneMigrationTests
{
    private const string Before = "20261110150604_AddInspectionCompletedBy";

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Migration_StoresTheCanonicalPhone_AndLeavesTheRestAsItWas()
    {
        var connectionString = await SqlServerContainer.ConnectionStringAsync($"vistoria_phone_{Guid.NewGuid():N}");
        var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(connectionString).Options;
        await using var db = new AppDbContext(options, TimeProvider.System);
        var migrator = db.GetService<IMigrator>();
        await migrator.MigrateAsync(Before, cancellationToken: Ct);

        string?[] phones =
        [
            "(71) 3333-0000",     // fixo com máscara
            "(71) 99999-0000",    // celular com máscara
            "+55 11 91234-5678",  // com o país
            "5571999990000",      // com o país, sem máscara
            "71 9 9999.0000",     // separadores misturados
            "71999990000",        // já canônico
            "+1 415 555 0100",    // de fora do Brasil
            "(10) 3333-0000",     // DDD que não existe
            "(71) 9999-0000",     // celular antigo, sem o 9
            "ramal 12",           // não é telefone
            "",                   // vazio
            null,                 // sem telefone
        ];
        var ids = new List<Guid>();
        var ownerId = Guid.CreateVersion7();
        foreach (var phone in phones)
        {
            var id = Guid.CreateVersion7();
            ids.Add(id);
            await db.Database.ExecuteSqlAsync(
                $"""
                INSERT INTO clients (Id, Name, Phone, CreatedAt, UpdatedAt, OwnerId)
                VALUES ({id}, {"Cliente"}, {phone}, SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET(), {ownerId})
                """,
                Ct);
        }

        var before = await Rows(db, ownerId);
        await migrator.MigrateAsync(cancellationToken: Ct);
        var after = await Rows(db, ownerId);

        string?[] expected =
        [
            "7133330000",
            "71999990000",
            "11912345678",
            "71999990000",
            "71999990000",
            "71999990000",
            "+1 415 555 0100",
            "(10) 3333-0000",
            "(71) 9999-0000",
            "ramal 12",
            "",
            null,
        ];
        ids.Select(id => after[id].Phone).Should().Equal(expected);
        for (var i = 0; i < ids.Count; i++)
        {
            var changed = phones[i] != expected[i];
            after[ids[i]].Version.SequenceEqual(before[ids[i]].Version).Should().Be(
                !changed, $"o rowversion de \"{phones[i]}\" só muda se o telefone mudou");
        }
    }

    private static async Task<Dictionary<Guid, (string? Phone, byte[] Version)>> Rows(AppDbContext db, Guid ownerId)
    {
        var rows = await db.Clients.IgnoreQueryFilters().AsNoTracking()
            .Where(c => c.OwnerId == ownerId)
            .Select(c => new { c.Id, c.Phone, c.Version })
            .ToListAsync(Ct);
        return rows.ToDictionary(row => row.Id, row => (row.Phone, row.Version));
    }
}
