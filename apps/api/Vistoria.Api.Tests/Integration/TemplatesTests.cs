using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using AwesomeAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Vistoria.Api.Infrastructure.Errors;
using Vistoria.Api.Model;
using Vistoria.Api.Model.Context;
using Vistoria.Api.Tests.Support;

namespace Vistoria.Api.Tests.Integration;

// Dono, versão e idempotência são os do fluxo genérico, cobertos em OptimisticConcurrencyTests e IdempotencyTests;
// aqui ficam o formato do roteiro, os limites de ambientes e itens e a coluna JSON.
public class TemplatesTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task PutThenGet_PreservesIdsNamesPositionsAndOrder()
    {
        var client = factory.CreateAuthenticatedClient();
        var id = Guid.CreateVersion7();
        var body = ValidBody();

        var put = await Put(client, id, body);
        put.StatusCode.Should().Be(HttpStatusCode.Created);
        put.Headers.Location!.AbsolutePath.Should().Be(PathOf(id));

        var get = await client.GetAsync(PathOf(id), Ct);

        get.StatusCode.Should().Be(HttpStatusCode.OK);
        var stored = await Body(get);
        Version(stored).Should().Be(ETagOf(get)).And.Be(ETagOf(put));
        stored.GetProperty("id").GetGuid().Should().Be(id);
        stored.GetProperty("name").GetString().Should().Be("Apartamento");
        stored.GetProperty("createdAt").GetDateTimeOffset().Should().Be(factory.Time.GetUtcNow());
        stored.TryGetProperty("ownerId", out _).Should().BeFalse();
        RoomsOf(stored).Should().BeEquivalentTo(body.Rooms, o => o.WithStrictOrdering());
    }

    [Fact]
    public async Task Put_WithIfMatch_RewritesTheWholeList_InTheNewOrder()
    {
        var client = factory.CreateAuthenticatedClient();
        var id = Guid.CreateVersion7();
        var created = await Put(client, id, ValidBody());
        var original = ValidBody();

        // Cozinha sobe para o topo; o banheiro perde o primeiro item e ganha um novo.
        var bathroom = original.Rooms[2];
        var reordered = original with
        {
            Name = "Apartamento revisado",
            Rooms =
            [
                original.Rooms[1] with { Position = 0 },
                original.Rooms[0] with { Position = 1 },
                bathroom with { Items = [.. bathroom.Items.Skip(1), new ItemBody(Guid.CreateVersion7(), "Box", 9)] },
            ],
        };

        var updated = await Put(client, id, reordered, ETagOf(created));

        updated.StatusCode.Should().Be(HttpStatusCode.OK);
        var stored = await Body(await client.GetAsync(PathOf(id), Ct));
        stored.GetProperty("name").GetString().Should().Be("Apartamento revisado");
        RoomsOf(stored).Should().BeEquivalentTo(reordered.Rooms, o => o.WithStrictOrdering());
    }

    [Fact]
    public async Task Put_WithoutRooms_Creates_AnEmptyTemplate()
    {
        var response = await Put(factory.CreateAuthenticatedClient(), Guid.CreateVersion7(), new { name = "Vazio" });

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        (await Body(response)).GetProperty("rooms").GetArrayLength().Should().Be(0);
    }

    [Fact]
    public async Task Put_AtTheLimits_40RoomsWith60ItemsEach_Returns201()
    {
        var response = await Put(factory.CreateAuthenticatedClient(), Guid.CreateVersion7(),
            new TemplateBody("Galpão", Rooms(40, itemsPerRoom: 60)));

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var rooms = (await Body(response)).GetProperty("rooms");
        rooms.GetArrayLength().Should().Be(40);
        rooms.EnumerateArray().Should().AllSatisfy(r => r.GetProperty("items").GetArrayLength().Should().Be(60));
    }

    // Cada linha troca um trecho do corpo válido pelo caminho JSON; o erro sai só nesse caminho.
    public static TheoryData<string, object?> InvalidFields => new()
    {
        { "rooms", Rooms(41, itemsPerRoom: 1) },
        { "rooms", null },
        { "name", "" },
        { "name", new string('a', 61) },
        { "rooms[0].name", "" },
        { "rooms[0].name", new string('a', 61) },
        { "rooms[0].id", null },
        { "rooms[0].position", null },
        { "rooms[0].position", -1 },
        { "rooms[0].position", "1" },
        { "rooms[0].items", Items(61) },
        { "rooms[0].items", null },
        { "rooms[0].items[0].name", "" },
        { "rooms[0].items[0].name", "   " },
        { "rooms[0].items[0].name", new string('a', 61) },
        { "rooms[0].items[0].id", null },
        { "rooms[0].items[0].position", null },
        { "rooms[1]", null },
        { "rooms[1].items[1]", null },
        { "rooms[1].id", "0199a1b2-0000-7000-8000-000000000001" },
        { "rooms[2].items[0].id", "0199a1b2-0000-7000-8000-000000000011" },
    };

    [Theory]
    [MemberData(nameof(InvalidFields))]
    public async Task Put_InvalidField_Returns400OnTheField(string path, object? value)
    {
        var id = Guid.CreateVersion7();

        var response = await Put(factory.CreateAuthenticatedClient(), id, BodyWith(ValidBody(), path, value));

        await AssertProblem(response, HttpStatusCode.BadRequest, ProblemTypes.Validation);
        (await Body(response)).GetProperty("errors").EnumerateObject().Select(p => p.Name).Should().Equal(path);
        (await StoredOrNull(id)).Should().BeNull();
    }

    [Fact]
    public async Task RoomsAndItems_LiveInOneJsonColumnOfTheTemplatesTable_WithoutATableOfTheirOwn()
    {
        var client = factory.CreateAuthenticatedClient();
        var id = Guid.CreateVersion7();
        (await Put(client, id, ValidBody())).StatusCode.Should().Be(HttpStatusCode.Created);

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var column = await db.Database
            .SqlQuery<string>($"SELECT [Rooms] AS [Value] FROM [templates] WHERE [Id] = {id}")
            .SingleAsync(Ct);
        var rooms = JsonNode.Parse(column)!.AsArray();
        rooms.Should().HaveCount(3);
        rooms[0]!["Name"]!.GetValue<string>().Should().Be("Sala");
        rooms[0]!["Items"]!.AsArray().Should().HaveCount(2);

        var tables = await db.Database
            .SqlQuery<string>($"SELECT TABLE_NAME AS [Value] FROM INFORMATION_SCHEMA.TABLES")
            .ToListAsync(Ct);
        // rooms e inspection_items são da vistoria; do roteiro só existe a tabela dele.
        tables.Where(t => t.StartsWith("template", StringComparison.OrdinalIgnoreCase)).Should().Equal("templates");
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Get_MissingOrFromAnotherOwner_Returns404NotFound(bool otherOwner)
    {
        var id = Guid.CreateVersion7();
        if (otherOwner)
        {
            (await Put(factory.CreateAuthenticatedClient(), id, ValidBody())).StatusCode
                .Should().Be(HttpStatusCode.Created);
        }

        var response = await factory.CreateAuthenticatedClient().GetAsync(PathOf(id), Ct);

        await AssertProblem(response, HttpStatusCode.NotFound, ProblemTypes.NotFound);
    }

    [Fact]
    public async Task Put_FromAnotherOwner_Returns403Forbidden_AndKeepsTheRecord()
    {
        var id = Guid.CreateVersion7();
        var original = await Put(factory.CreateAuthenticatedClient(), id, ValidBody());

        var response = await Put(factory.CreateAuthenticatedClient(), id, ValidBody() with { Name = "Invasão", Rooms = [] });

        await AssertProblem(response, HttpStatusCode.Forbidden, ProblemTypes.Forbidden);
        var stored = (await StoredOrNull(id))!;
        stored.Name.Should().Be("Apartamento");
        stored.Rooms.Should().HaveCount(3);
        Convert.ToBase64String(stored.Version).Should().Be(ETagOf(original));
    }

    [Fact]
    public async Task Put_TakesOwnerFromTheToken_AndIdFromTheRoute()
    {
        var ownerId = Guid.CreateVersion7();
        var id = Guid.CreateVersion7();

        var response = await Put(factory.CreateAuthenticatedClient(ownerId), id, new
        {
            id = Guid.CreateVersion7(),
            ownerId = Guid.CreateVersion7(),
            name = "Casa",
        });

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        (await Body(response)).GetProperty("id").GetGuid().Should().Be(id);
        (await StoredOrNull(id))!.OwnerId.Should().Be(ownerId);
    }

    [Fact]
    public async Task WithoutToken_Returns401()
    {
        var client = factory.CreateClient();
        var id = Guid.CreateVersion7();

        await AssertProblem(await client.GetAsync(PathOf(id), Ct), HttpStatusCode.Unauthorized,
            ProblemTypes.Unauthorized);
        await AssertProblem(await Put(client, id, ValidBody()), HttpStatusCode.Unauthorized,
            ProblemTypes.Unauthorized);
    }

    private sealed record TemplateBody(string Name, List<RoomBody> Rooms);

    private sealed record RoomBody(Guid Id, string Name, int Position, List<ItemBody> Items);

    private sealed record ItemBody(Guid Id, string Name, int Position);

    // Ids fixos: a theory de id repetido copia o da sala (rooms[0]) e o do piso dela (rooms[0].items[0]). As posições
    // não seguem a ordem alfabética nem começam em zero, para a ida e volta provar que nada é reordenado.
    private static TemplateBody ValidBody() => new("Apartamento",
    [
        new(Guid.Parse("0199a1b2-0000-7000-8000-000000000001"), "Sala", 3,
        [
            new(Guid.Parse("0199a1b2-0000-7000-8000-000000000011"), "Piso", 2),
            new(Guid.Parse("0199a1b2-0000-7000-8000-000000000012"), "Janelas", 1),
        ]),
        new(Guid.Parse("0199a1b2-0000-7000-8000-000000000002"), "Cozinha", 5,
        [
            new(Guid.Parse("0199a1b2-0000-7000-8000-000000000021"), "Pia", 0),
            new(Guid.Parse("0199a1b2-0000-7000-8000-000000000022"), "Armários", 1),
        ]),
        new(Guid.Parse("0199a1b2-0000-7000-8000-000000000003"), "Banheiro", 4,
        [
            new(Guid.Parse("0199a1b2-0000-7000-8000-000000000031"), "Vaso", 0),
            new(Guid.Parse("0199a1b2-0000-7000-8000-000000000032"), "Chuveiro", 1),
        ]),
    ]);

    private static List<RoomBody> Rooms(int count, int itemsPerRoom) =>
        [.. Enumerable.Range(0, count).Select(r => new RoomBody(Guid.CreateVersion7(), $"Ambiente {r}", r, Items(itemsPerRoom)))];

    private static List<ItemBody> Items(int count) =>
        [.. Enumerable.Range(0, count).Select(i => new ItemBody(Guid.CreateVersion7(), $"Item {i}", i))];

    // O corpo como JSON, com o valor em `path` (ex.: rooms[0].items[0].name) trocado por outro, de qualquer tipo.
    private static JsonNode BodyWith(TemplateBody body, string path, object? value)
    {
        var root = JsonSerializer.SerializeToNode(body, JsonSerializerOptions.Web)!;
        var segments = path.Replace("]", "").Split('.', '[');
        var parent = root;
        foreach (var segment in segments[..^1])
        {
            parent = int.TryParse(segment, out var index) ? parent[index]! : parent[segment]!;
        }

        var replacement = JsonSerializer.SerializeToNode(value, JsonSerializerOptions.Web);
        if (int.TryParse(segments[^1], out var last))
        {
            parent[last] = replacement;
        }
        else
        {
            parent[segments[^1]] = replacement;
        }

        return root;
    }

    private static List<RoomBody> RoomsOf(JsonElement body) =>
        body.GetProperty("rooms").Deserialize<List<RoomBody>>(JsonSerializerOptions.Web)!;

    private static string PathOf(Guid id) => $"/api/v1/templates/{id}";

    // ifMatch é o base64 do ETag (como o ETagOf devolve); vai entre aspas, como ETag forte.
    private static Task<HttpResponseMessage> Put(HttpClient client, Guid id, object body, string? ifMatch = null)
    {
        var request = WriteRequests.Put(PathOf(id), body);
        if (ifMatch is not null)
        {
            request.Headers.TryAddWithoutValidation("If-Match", $"\"{ifMatch}\"");
        }

        return client.SendAsync(request, Ct);
    }

    private static async Task<JsonElement> Body(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync(Ct)).RootElement;

    private static string Version(JsonElement body) => body.GetProperty("version").GetString()!;

    // ETag forte: o base64 entre aspas. Devolve o base64, para comparar com o version do corpo.
    private static string ETagOf(HttpResponseMessage response)
    {
        var etag = response.Headers.ETag!;
        etag.IsWeak.Should().BeFalse();
        return etag.Tag.Trim('"');
    }

    private static async Task AssertProblem(HttpResponseMessage response, HttpStatusCode status, string type)
    {
        response.StatusCode.Should().Be(status);
        response.Content.Headers.ContentType!.MediaType.Should().Be("application/problem+json");
        (await Body(response)).GetProperty("type").GetString().Should().Be(type);
    }

    private async Task<Template?> StoredOrNull(Guid id)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.Templates.AsNoTracking().SingleOrDefaultAsync(t => t.Id == id, Ct);
    }
}
