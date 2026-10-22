using AwesomeAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Vistoria.Api.Configurations;
using Vistoria.Api.Infrastructure.Background;
using Vistoria.Api.Model;
using Vistoria.Api.Model.Context;
using Vistoria.Api.Tests.Support;

namespace Vistoria.Api.Tests.Integration;

// Banco próprio: a limpeza apaga as chaves vencidas de todo mundo, e no banco compartilhado apagaria as dos outros testes.
public class CleanupServiceTests(CleanupServiceTests.OwnDatabaseFactory factory)
    : IClassFixture<CleanupServiceTests.OwnDatabaseFactory>
{
    public class OwnDatabaseFactory : ApiFactory
    {
        public string Name { get; } = $"vistoria_cleanup_{Guid.NewGuid():N}";

        protected override string Database => Name;
    }

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    // Várias rodadas, para as duas instâncias de fato disputarem as mesmas linhas.
    [Fact]
    public async Task TwoInstancesAtTheSameTime_RemoveEachExpiredKeyOnce_AndKeepTheValidOnes()
    {
        await using var otherHost = factory.WithWebHostBuilder(_ => { });
        var instances = new[] { Cleanup(factory), Cleanup(otherHost) };

        var now = factory.Time.GetUtcNow();
        for (var round = 0; round < 5; round++)
        {
            var expired = await Seed(200, now - IdempotencyConfig.KeyValidity - TimeSpan.FromSeconds(1));
            // No limite exato a chave ainda vale, como no IdempotencyFilter.
            var valid = await Seed(20, now - IdempotencyConfig.KeyValidity);

            var deleted = await Task.WhenAll(instances.Select(i => i.RunOnceAsync(Ct)));

            deleted.Sum().Should().Be(expired.Count);
            (await Remaining(expired)).Should().BeEmpty();
            (await Remaining(valid)).Should().BeEquivalentTo(valid);
        }
    }

    private static CleanupService Cleanup(WebApplicationFactory<Program> host) =>
        host.Services.GetRequiredService<CleanupService>();

    private async Task<List<Guid>> Seed(int count, DateTimeOffset createdAt)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var records = Enumerable.Range(0, count).Select(_ => new IdempotencyRecord
        {
            UserId = Guid.CreateVersion7(),
            Key = Guid.CreateVersion7(),
            RequestHash = new byte[32],
            State = IdempotencyState.Done,
            StatusCode = 201,
            CreatedAt = createdAt,
        }).ToList();
        db.IdempotencyRecords.AddRange(records);
        await db.SaveChangesAsync(Ct);
        return [.. records.Select(r => r.Key)];
    }

    private async Task<List<Guid>> Remaining(List<Guid> keys)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.IdempotencyRecords.Where(r => keys.Contains(r.Key)).Select(r => r.Key).ToListAsync(Ct);
    }
}
