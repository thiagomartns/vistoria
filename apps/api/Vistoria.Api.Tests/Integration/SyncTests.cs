using System.Net;
using System.Text.Json;
using AwesomeAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Vistoria.Api.Configurations;
using Vistoria.Api.Infrastructure.Errors;
using Vistoria.Api.Model;
using Vistoria.Api.Model.Base;
using Vistoria.Api.Model.Context;
using Vistoria.Api.Tests.Support;

namespace Vistoria.Api.Tests.Integration;

// Banco próprio: MIN_ACTIVE_ROWVERSION() é do banco inteiro, e uma escrita em voo de outro teste no banco compartilhado
// seguraria a página deste. Os testes de uma classe rodam um por vez.
public class SyncTests(SyncTests.OwnDatabaseFactory factory) : IClassFixture<SyncTests.OwnDatabaseFactory>
{
    public class OwnDatabaseFactory : ApiFactory
    {
        public string Name { get; } = $"vistoria_sync_{Guid.NewGuid():N}";

        public CommandCounter Commands { get; } = new();

        protected override string Database => Name;

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.ConfigureTestServices(services =>
                services.ConfigureDbContext<AppDbContext>(options => options.AddInterceptors(Commands)));
        }
    }

    public static TheoryData<string> Entities => ["clients", "properties", "templates", "inspections"];

    // Os que têm ambientes e itens no corpo.
    public static TheoryData<string> Aggregates => ["templates", "inspections"];

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Theory]
    [MemberData(nameof(Entities))]
    public async Task Paging_UntilHasMoreIsFalse_ReturnsEachLiveRecordOnce_InVersionOrder(string entity)
    {
        var user = new User(factory);
        var created = new List<Guid>();
        for (var i = 0; i < 5; i++)
        {
            created.Add(await user.Create(entity));
        }

        var (items, cursor) = await user.SyncAll(entity, limit: 2);

        items.Select(Id).Should().Equal(created);
        items.Select(VersionOf).Should().BeInAscendingOrder(VersionOrder.Instance);

        // Regravar o primeiro sobe a versão dele: ele volta sozinho, depois do cursor.
        await user.Rewrite(entity, created[0]);
        var (again, _) = await user.SyncAll(entity, limit: 2, cursor);
        again.Select(Id).Should().Equal(created[0]);
    }

    [Theory]
    [MemberData(nameof(Entities))]
    public async Task WriteAfterTheCursor_ComesInTheNextCall_AndNothingOfAnotherOwner(string entity)
    {
        var user = new User(factory);
        var stranger = new User(factory);
        await user.Create(entity);
        await stranger.Create(entity);
        var (_, cursor) = await user.SyncAll(entity);

        var later = await user.Create(entity);
        await stranger.Create(entity);
        var page = await user.Page(entity, cursor);

        page.Items.Select(Id).Should().Equal(later);
        page.DeletedIds.Should().BeEmpty();
        page.HasMore.Should().BeFalse();
        (await stranger.SyncAll(entity)).Items.Select(Id).Should().NotContain(later);
    }

    [Fact]
    public async Task OpenTransaction_WithAVersionBelowACommittedOne_IsNotSkipped()
    {
        var user = new User(factory);
        await user.Create("clients");
        var (_, cursor) = await user.SyncAll("clients");

        // A transação aberta pega o rowversion antes do PUT, mas só confirma depois dele.
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await using var transaction = await db.Database.BeginTransactionAsync(Ct);
        var pending = new Client { Id = Guid.CreateVersion7(), OwnerId = user.Id, Name = "Em transação" };
        db.Clients.Add(pending);
        await db.SaveChangesAsync(Ct);
        var committed = await user.Create("clients");

        // Com timeout: se a leitura bloqueasse no lock da linha aberta, o teste falharia em vez de travar.
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(Ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(10));
        var during = await user.Page("clients", cursor, cancellationToken: timeout.Token);
        during.Items.Should().BeEmpty("a versão confirmada fica acima do teto enquanto a menor está aberta");
        during.HasMore.Should().BeFalse();

        await transaction.CommitAsync(Ct);
        var after = await user.Page("clients", during.NextCursor);
        after.Items.Select(Id).Should().Equal(pending.Id, committed);
    }

    [Theory]
    [MemberData(nameof(Entities))]
    public async Task Tombstone_GoesInDeletedIdsAndNotInItems_AndTheFirstSyncHasOnlyLiveRecords(string entity)
    {
        var user = new User(factory);
        var kept = await user.Create(entity);
        var removed = await user.Create(entity);
        var (_, cursor) = await user.SyncAll(entity);

        // Só a vistoria tem DELETE na V1: o tombstone vai direto no banco, como o SaveChanges o gravaria. O DELETE da
        // vistoria tem o teste dele.
        await user.MarkDeleted(entity, removed);

        var page = await user.Page(entity, cursor);
        page.Items.Should().BeEmpty();
        page.DeletedIds.Should().Equal(removed);

        var first = await user.SyncAll(entity);
        first.Items.Select(Id).Should().Equal(kept);
        (await user.Page(entity)).DeletedIds.Should().BeEmpty();
    }

    // Ambientes e itens vêm no delta como no GET: o mesmo DTO, campo a campo.
    [Theory]
    [MemberData(nameof(Aggregates))]
    public async Task Item_IsTheSameDtoAsTheGet_WithRoomsAndItems(string entity)
    {
        var user = new User(factory);
        var id = await user.Create(entity);

        var item = (await user.SyncAll(entity)).Items.Single();

        var rooms = item.GetProperty("rooms").EnumerateArray().ToList();
        rooms.Should().HaveCount(2);
        rooms[0].GetProperty("items").GetArrayLength().Should().Be(2);
        var get = await user.Http.GetAsync($"/api/v1/{entity}/{id}", Ct);
        item.GetRawText().Should().Be(await get.Content.ReadAsStringAsync(Ct));
    }

    // Regra do agregado: o item não tem versão; mudá-lo sobe a da vistoria, que volta inteira.
    [Fact]
    public async Task Inspection_ChangingOnlyAnItem_ComesBackInTheNextDelta_WithTheNewItem()
    {
        var user = new User(factory);
        var body = await user.InspectionBody();
        var id = await user.Create("inspections", body);
        var (_, cursor) = await user.SyncAll("inspections");

        var room = body.Rooms[0];
        await user.Update("inspections", id, body with
        {
            Rooms = [room with { Items = [room.Items[0], room.Items[1] with { Condition = "poor" }] }, body.Rooms[1]],
        });

        var page = await user.Page("inspections", cursor);
        page.Items.Select(Id).Should().Equal(id);
        var items = page.Items[0].GetProperty("rooms")[0].GetProperty("items");
        items[0].GetProperty("condition").GetString().Should().Be("good");
        items[1].GetProperty("condition").GetString().Should().Be("poor");
    }

    [Fact]
    public async Task Inspection_RemovedRoomOrItem_IsNotInIt()
    {
        var user = new User(factory);
        var body = await user.InspectionBody();
        var id = await user.Create("inspections", body);
        var (_, cursor) = await user.SyncAll("inspections");

        // Sai o primeiro item da sala e a cozinha inteira.
        var room = body.Rooms[0];
        await user.Update("inspections", id, body with { Rooms = [room with { Items = [room.Items[1]] }] });

        var delta = (await user.Page("inspections", cursor)).Items.Single();
        var first = (await user.SyncAll("inspections")).Items.Single();
        foreach (var inspection in new[] { delta, first })
        {
            var rooms = inspection.GetProperty("rooms").EnumerateArray().ToList();
            rooms.Select(Id).Should().Equal(room.Id);
            rooms[0].GetProperty("items").EnumerateArray().Select(Id).Should().Equal(room.Items[1].Id);
        }
    }

    [Fact]
    public async Task Inspection_Deleted_GoesInDeletedIds_AndCompleted_ComesInItems()
    {
        var user = new User(factory);
        var removed = await user.Create("inspections");
        var body = await user.InspectionBody();
        var completed = await user.Create("inspections", body);
        var (_, cursor) = await user.SyncAll("inspections");

        await user.Delete("inspections", removed);
        await user.Update("inspections", completed, body with { Status = "completed" });

        var page = await user.Page("inspections", cursor);
        page.DeletedIds.Should().Equal(removed);
        page.Items.Select(Id).Should().Equal(completed);
        page.Items[0].GetProperty("status").GetString().Should().Be("completed");
        page.Items[0].GetProperty("completedAt").GetDateTimeOffset().Should().Be(factory.Time.GetUtcNow());
    }

    // Sem N+1: raiz, ambientes e itens saem de uma consulta só, com uma vistoria na página ou cinco.
    [Fact]
    public async Task InspectionPage_RunsOneQuery_WhateverTheNumberOfInspections()
    {
        var user = new User(factory);
        for (var i = 0; i < 5; i++)
        {
            await user.Create("inspections");
        }

        foreach (var limit in new[] { 1, 5 })
        {
            factory.Commands.Reset();
            var page = await user.Page("inspections", limit: limit);
            var commands = factory.Commands.Count;

            page.Items.Should().HaveCount(limit);
            page.Items.Should().AllSatisfy(i => i.GetProperty("rooms").GetArrayLength().Should().Be(2));
            commands.Should().Be(1, $"a página com {limit} vistoria(s) faz uma consulta só");
        }
    }

    [Theory]
    [InlineData("isso não é base64!")]
    [InlineData("bm90IGpzb24")] // base64url de "not json"
    [InlineData("eyJ2ZXJzaW9uIjoiQUFBQUFBQUFBQT09IiwiaXNzdWVkQXQiOiIyMDI2LTEwLTIwVDEyOjAwOjAwWiJ9")] // versão com 7 bytes
    [InlineData("eyJpc3N1ZWRBdCI6IjIwMjYtMTAtMjBUMTI6MDA6MDBaIn0")] // sem versão
    public async Task UnreadableCursor_Returns400InvalidCursor(string cursor)
    {
        var response = await new User(factory).Get("clients", cursor);

        await AssertProblem(response, HttpStatusCode.BadRequest, ProblemTypes.InvalidCursor);
    }

    [Fact]
    public async Task CursorOlderThanTheTombstoneRetention_Returns410CursorExpired_AndAtTheLimitStillWorks()
    {
        var user = new User(factory);
        await user.Create("clients");
        var (_, cursor) = await user.SyncAll("clients");

        factory.Time.Advance(SyncConfig.TombstoneRetention);
        (await user.Get("clients", cursor)).StatusCode.Should().Be(HttpStatusCode.OK);

        factory.Time.Advance(TimeSpan.FromSeconds(1));
        await AssertProblem(await user.Get("clients", cursor), HttpStatusCode.Gone, ProblemTypes.CursorExpired);
    }

    [Fact]
    public async Task InTheMiddleOfPaging_TheExpiryCountsFromTheStart()
    {
        var user = new User(factory);
        for (var i = 0; i < 3; i++)
        {
            await user.Create("clients");
        }

        var first = await user.Page("clients", limit: 1);
        first.HasMore.Should().BeTrue();

        factory.Time.Advance(SyncConfig.TombstoneRetention + TimeSpan.FromSeconds(1));
        await AssertProblem(
            await user.Get("clients", first.NextCursor, limit: 1), HttpStatusCode.Gone, ProblemTypes.CursorExpired);
    }

    [Fact]
    public async Task CaughtUpCursor_IsRenewedOnEveryCall_EvenWithoutChanges()
    {
        var user = new User(factory);
        await user.Create("clients");
        var (_, start) = await user.SyncAll("clients");

        factory.Time.Advance(TimeSpan.FromDays(60));
        var renewed = await user.Page("clients", start);
        renewed.Items.Should().BeEmpty();

        factory.Time.Advance(TimeSpan.FromDays(60));
        (await user.Get("clients", renewed.NextCursor)).StatusCode.Should().Be(HttpStatusCode.OK);
        await AssertProblem(await user.Get("clients", start), HttpStatusCode.Gone, ProblemTypes.CursorExpired);
    }

    [Fact]
    public async Task Limit_Defaults500_AcceptsUpTo1000()
    {
        var user = new User(factory);
        await user.Seed(SyncConfig.DefaultPageSize + 1);

        var byDefault = await user.Page("clients");
        byDefault.Items.Should().HaveCount(SyncConfig.DefaultPageSize);
        byDefault.HasMore.Should().BeTrue();

        var max = await user.Page("clients", limit: SyncConfig.MaxPageSize);
        max.Items.Should().HaveCount(SyncConfig.DefaultPageSize + 1);
        max.HasMore.Should().BeFalse();
    }

    [Theory]
    [InlineData("0")]
    [InlineData("1001")]
    [InlineData("-1")]
    [InlineData("abc")]
    public async Task LimitOutOfRange_Returns400ValidationOnLimit(string limit)
    {
        var response = await new User(factory).Http.GetAsync($"/api/v1/sync/clients?limit={limit}", Ct);

        await AssertProblem(response, HttpStatusCode.BadRequest, ProblemTypes.Validation);
        (await Body(response)).GetProperty("errors").EnumerateObject().Select(p => p.Name).Should().Equal("limit");
    }

    [Theory]
    [MemberData(nameof(Entities))]
    public async Task WithoutToken_Returns401(string entity)
    {
        var response = await factory.CreateClient().GetAsync($"/api/v1/sync/{entity}", Ct);

        await AssertProblem(response, HttpStatusCode.Unauthorized, ProblemTypes.Unauthorized);
    }

    private sealed record Page(List<JsonElement> Items, List<Guid> DeletedIds, string NextCursor, bool HasMore);

    private sealed record InspectionBody(
        Guid PropertyId, string Kind, string Status, DateTimeOffset StartedAt, List<RoomBody> Rooms);

    private sealed record RoomBody(Guid Id, string Name, int Position, List<ItemBody> Items);

    private sealed record ItemBody(Guid Id, string Name, int Position, string? Condition);

    // Um usuário com o próprio token; o token sai de novo a cada chamada, porque os testes andam o relógio por meses.
    private sealed class User(OwnDatabaseFactory factory)
    {
        public Guid Id { get; } = Guid.CreateVersion7();

        public HttpClient Http => factory.CreateAuthenticatedClient(Id);

        private Guid? _owner;

        private Guid? _property;

        public Task<HttpResponseMessage> Get(
            string entity, string? cursor = null, int? limit = null, CancellationToken? cancellationToken = null)
        {
            var query = new List<string>();
            if (cursor is not null)
            {
                query.Add($"cursor={Uri.EscapeDataString(cursor)}");
            }

            if (limit is not null)
            {
                query.Add($"limit={limit}");
            }

            var path = $"/api/v1/sync/{entity}" + (query.Count > 0 ? "?" + string.Join('&', query) : "");
            return Http.GetAsync(path, cancellationToken ?? Ct);
        }

        public async Task<Page> Page(
            string entity, string? cursor = null, int? limit = null, CancellationToken? cancellationToken = null)
        {
            var response = await Get(entity, cursor, limit, cancellationToken);
            response.StatusCode.Should().Be(HttpStatusCode.OK);
            var body = await Body(response);
            return new Page(
                [.. body.GetProperty("items").EnumerateArray()],
                [.. body.GetProperty("deletedIds").EnumerateArray().Select(e => e.GetGuid())],
                body.GetProperty("nextCursor").GetString()!,
                body.GetProperty("hasMore").GetBoolean());
        }

        /// <summary>Repete a chamada com o <c>nextCursor</c> até <c>hasMore</c> falso, como o pull do front.</summary>
        public async Task<(List<JsonElement> Items, string Cursor)> SyncAll(
            string entity, int? limit = null, string? cursor = null)
        {
            var items = new List<JsonElement>();
            Page page;
            do
            {
                page = await Page(entity, cursor, limit);
                page.Items.Count.Should().BeLessThanOrEqualTo(limit ?? SyncConfig.DefaultPageSize);
                items.AddRange(page.Items);
                cursor = page.NextCursor;
            } while (page.HasMore);

            return (items, cursor);
        }

        public async Task<Guid> Create(string entity, object? body = null)
        {
            var id = Guid.CreateVersion7();
            var request = WriteRequests.Put($"/api/v1/{entity}/{id}", body ?? await BodyOf(entity));
            (await Http.SendAsync(request, Ct)).StatusCode.Should().Be(HttpStatusCode.Created);
            return id;
        }

        public async Task Rewrite(string entity, Guid id) => await Update(entity, id, await BodyOf(entity));

        /// <summary><c>PUT</c> a partir da versão atual (<c>If-Match</c> do <c>GET</c>).</summary>
        public async Task Update(string entity, Guid id, object body)
        {
            var request = WriteRequests.Put($"/api/v1/{entity}/{id}", body);
            request.Headers.TryAddWithoutValidation("If-Match", await ETagOf(entity, id));
            (await Http.SendAsync(request, Ct)).StatusCode.Should().Be(HttpStatusCode.OK);
        }

        public async Task Delete(string entity, Guid id)
        {
            var request = WriteRequests.Delete($"/api/v1/{entity}/{id}");
            request.Headers.TryAddWithoutValidation("If-Match", await ETagOf(entity, id));
            (await Http.SendAsync(request, Ct)).StatusCode.Should().Be(HttpStatusCode.NoContent);
        }

        public async Task MarkDeleted(string entity, Guid id)
        {
            await using var scope = factory.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var deletedAt = factory.Time.GetUtcNow();
            var updated = entity switch
            {
                "clients" => await Stamp(db.Clients),
                "properties" => await Stamp(db.Properties),
                "templates" => await Stamp(db.Templates),
                _ => await Stamp(db.Inspections),
            };
            updated.Should().Be(1);

            Task<int> Stamp<T>(IQueryable<T> set) where T : SyncEntity =>
                set.Where(e => e.Id == id).ExecuteUpdateAsync(s => s.SetProperty(e => e.DeletedAt, deletedAt), Ct);
        }

        /// <summary>
        /// Vistoria em andamento com todos os itens avaliados (só falta o status para concluir): a sala com piso e
        /// janelas, e a cozinha com a pia.
        /// </summary>
        public async Task<InspectionBody> InspectionBody() => new(
            _property ??= await Create("properties"), "moveIn", "inProgress", ApiFactory.Start,
            [
                new(Guid.CreateVersion7(), "Sala", 0,
                [
                    new(Guid.CreateVersion7(), "Piso", 0, "good"),
                    new(Guid.CreateVersion7(), "Janelas", 1, "fair"),
                ]),
                new(Guid.CreateVersion7(), "Cozinha", 1, [new(Guid.CreateVersion7(), "Pia", 0, "new")]),
            ]);

        public async Task Seed(int count)
        {
            await using var scope = factory.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Clients.AddRange(Enumerable.Range(0, count)
                .Select(i => new Client { Id = Guid.CreateVersion7(), OwnerId = Id, Name = $"Cliente {i}" }));
            await db.SaveChangesAsync(Ct);
        }

        private async Task<string> ETagOf(string entity, Guid id) =>
            (await Http.GetAsync($"/api/v1/{entity}/{id}", Ct)).Headers.ETag!.Tag;

        // O imóvel precisa de um cliente do mesmo dono, e a vistoria, de um imóvel; um só serve a todos do usuário.
        private async Task<object> BodyOf(string entity)
        {
            switch (entity)
            {
                case "clients":
                    return new { name = "Maria Locadora" };
                case "templates":
                    return new
                    {
                        name = "Apartamento padrão",
                        rooms = new[]
                        {
                            new
                            {
                                id = Guid.CreateVersion7(),
                                name = "Sala",
                                position = 0,
                                items = new[]
                                {
                                    new { id = Guid.CreateVersion7(), name = "Piso", position = 0 },
                                    new { id = Guid.CreateVersion7(), name = "Janelas", position = 1 },
                                },
                            },
                            new
                            {
                                id = Guid.CreateVersion7(),
                                name = "Cozinha",
                                position = 1,
                                items = new[] { new { id = Guid.CreateVersion7(), name = "Pia", position = 0 } },
                            },
                        },
                    };
                case "inspections":
                    return await InspectionBody();
            }

            _owner ??= await Create("clients");
            return new
            {
                clientId = _owner,
                street = "Avenida Paulista",
                number = "1578",
                district = "Bela Vista",
                city = "São Paulo",
                state = "SP",
                zipCode = "01310200",
                type = "apartment",
            };
        }
    }

    // O rowversion em base64 comparado como o SQL Server o ordena: byte a byte, sem sinal.
    private sealed class VersionOrder : IComparer<string>
    {
        public static readonly VersionOrder Instance = new();

        public int Compare(string? x, string? y) =>
            Convert.FromBase64String(x!).AsSpan().SequenceCompareTo(Convert.FromBase64String(y!));
    }

    private static Guid Id(JsonElement item) => item.GetProperty("id").GetGuid();

    private static string VersionOf(JsonElement item) => item.GetProperty("version").GetString()!;

    private static async Task<JsonElement> Body(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync(Ct)).RootElement;

    private static async Task AssertProblem(HttpResponseMessage response, HttpStatusCode status, string type)
    {
        response.StatusCode.Should().Be(status);
        response.Content.Headers.ContentType!.MediaType.Should().Be("application/problem+json");
        (await Body(response)).GetProperty("type").GetString().Should().Be(type);
    }
}
