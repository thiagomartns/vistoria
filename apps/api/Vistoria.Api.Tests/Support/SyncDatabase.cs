using Microsoft.EntityFrameworkCore;
using Vistoria.Api.Model.Context;

namespace Vistoria.Api.Tests.Support;

/// <summary>
/// Banco próprio no <see cref="SqlServerContainer"/> com o modelo do <see cref="SyncTestDbContext"/>, sem subir a
/// API. Rowversion e filtro global só existem de verdade no SQL Server, não num banco em memória.
/// </summary>
public sealed class SyncDatabase : IAsyncLifetime
{
    private DbContextOptions<AppDbContext>? _options;

    public ManualTimeProvider Time { get; } = new(ApiFactory.Start);

    public async ValueTask InitializeAsync()
    {
        var connectionString = await SqlServerContainer.ConnectionStringAsync($"vistoria_sync_{Guid.NewGuid():N}");
        _options = new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(connectionString).Options;
        await using var db = CreateContext();
        await db.Database.EnsureCreatedAsync();
    }

    /// <summary>Contexto novo a cada chamada: ler por ele mostra o que foi gravado, não o que está em memória.</summary>
    public SyncTestDbContext CreateContext() =>
        new(_options ?? throw new InvalidOperationException("SyncDatabase não inicializado."), Time);

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}
