using System.Net;
using System.Text.Json;
using AwesomeAssertions;
using Vistoria.Api.Infrastructure.Errors;
using Vistoria.Api.Tests.Support;

namespace Vistoria.Api.Tests.Integration;

// A saída (backend.md, "Regra do agregado"; ADR 0051): nasce apontando para uma entrada concluída, viva, do mesmo
// imóvel e do mesmo dono, com a cópia da entrada nos itens. Kind, referência e cópias são da criação: o PUT de
// atualização os ignora. Banco próprio, como o SyncTests: o delta para no MIN_ACTIVE_ROWVERSION() do banco inteiro, e
// uma escrita em voo de outro teste esconderia a saída recém-criada.
public class InspectionMoveOutTests(InspectionMoveOutTests.OwnDatabaseFactory factory)
    : IClassFixture<InspectionMoveOutTests.OwnDatabaseFactory>
{
    public class OwnDatabaseFactory : ApiFactory
    {
        protected override string Database { get; } = $"vistoria_moveout_{Guid.NewGuid():N}";
    }

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task ValidMoveOut_Returns201WithReferenceAndCopies_AndGetAndDeltaBringThem()
    {
        var client = factory.CreateAuthenticatedClient();
        var (moveInId, moveIn) = await CreateCompletedMoveIn(client, await CreateProperty(client));
        var id = Guid.CreateVersion7();
        var body = MoveOutOf(moveInId, moveIn);

        var response = await Put(client, id, body);

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var delta = await Body(await client.GetAsync("/api/v1/sync/inspections", Ct));
        var fromDelta = delta.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("id").GetGuid() == id);
        var fromGet = await Body(await client.GetAsync(PathOf(id), Ct));
        foreach (var stored in new[] { await Body(response), fromGet, fromDelta })
        {
            stored.GetProperty("kind").GetString().Should().Be("moveOut");
            stored.GetProperty("referenceInspectionId").GetGuid().Should().Be(moveInId);
            CopiesOf(stored).Should().Equal(("good", null), ("fair", "Risco no vidro"), ("new", null));
            ConditionsOf(stored).Should().Equal(null, null, null);
        }
    }

    public static TheoryData<string> InvalidReferences =>
        ["inProgress", "otherProperty", "otherOwner", "deleted", "missing", "moveOut"];

    [Theory]
    [MemberData(nameof(InvalidReferences))]
    public async Task MoveOut_WithAnInvalidReference_Returns400OnReferenceInspectionId_AndWritesNothing(string kind)
    {
        var client = factory.CreateAuthenticatedClient();
        var propertyId = await CreateProperty(client);
        var (moveInId, moveIn) = await CreateCompletedMoveIn(client, propertyId);
        var referenceId = kind switch
        {
            "inProgress" => await CreateMoveIn(client, propertyId),
            "otherProperty" => (await CreateCompletedMoveIn(client, await CreateProperty(client))).Id,
            "otherOwner" => await OtherOwnersCompletedMoveIn(),
            "deleted" => await CreateDeletedMoveIn(client, propertyId),
            "missing" => Guid.CreateVersion7(),
            "moveOut" => await CreateMoveOut(client, moveInId, moveIn),
            _ => throw new ArgumentOutOfRangeException(nameof(kind)),
        };
        var id = Guid.CreateVersion7();

        var response = await Put(client, id, MoveOutOf(referenceId, moveIn));

        await AssertValidation(response, "referenceInspectionId");
        (await client.GetAsync(PathOf(id), Ct)).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task MoveOut_WithoutReference_Returns400OnReferenceInspectionId()
    {
        var client = factory.CreateAuthenticatedClient();
        var (_, moveIn) = await CreateCompletedMoveIn(client, await CreateProperty(client));

        var response = await Put(client, Guid.CreateVersion7(), MoveOutOf(null, moveIn));

        await AssertValidation(response, "referenceInspectionId");
    }

    [Fact]
    public async Task MoveIn_WithReference_Returns400OnReferenceInspectionId()
    {
        var client = factory.CreateAuthenticatedClient();
        var propertyId = await CreateProperty(client);
        var (moveInId, _) = await CreateCompletedMoveIn(client, propertyId);

        var response = await Put(
            client, Guid.CreateVersion7(), MoveInBody(propertyId) with { ReferenceInspectionId = moveInId });

        await AssertValidation(response, "referenceInspectionId");
    }

    [Fact]
    public async Task MoveIn_WithCopies_Returns400OnEachItemPath()
    {
        var client = factory.CreateAuthenticatedClient();
        var body = MoveInBody(await CreateProperty(client));
        var withCopies = body with
        {
            Rooms =
            [
                body.Rooms[0] with
                {
                    Items = [body.Rooms[0].Items[0], body.Rooms[0].Items[1] with { ReferenceCondition = "good" }],
                },
                body.Rooms[1] with { Items = [body.Rooms[1].Items[0] with { ReferenceNotes = "Da entrada" }] },
            ],
        };

        var response = await Put(client, Guid.CreateVersion7(), withCopies);

        await AssertValidation(response, "rooms[0].items[1].referenceCondition", "rooms[1].items[0].referenceNotes");
    }

    // O front manda o registro local inteiro em todo PUT: o que é da criação fica como foi gravado, sem 400.
    [Fact]
    public async Task Rewrite_KeepsKindReferenceAndCopies_AndSavesTheRest()
    {
        var client = factory.CreateAuthenticatedClient();
        var propertyId = await CreateProperty(client);
        var (moveInId, moveIn) = await CreateCompletedMoveIn(client, propertyId);
        var (otherMoveInId, _) = await CreateCompletedMoveIn(client, propertyId);
        var id = Guid.CreateVersion7();
        var body = MoveOutOf(moveInId, moveIn);
        var created = await Put(client, id, body);
        var rewritten = body with
        {
            Kind = "moveIn",
            ReferenceInspectionId = otherMoveInId,
            Rooms =
            [
                .. body.Rooms.Select(room => room with
                {
                    Items =
                    [
                        .. room.Items.Select(item => item with
                        {
                            Condition = "poor", ReferenceCondition = "absent", ReferenceNotes = "Trocado",
                        }),
                    ],
                }),
            ],
        };

        var response = await Put(client, id, rewritten, ETagOf(created));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        foreach (var stored in new[] { await Body(response), await Body(await client.GetAsync(PathOf(id), Ct)) })
        {
            stored.GetProperty("kind").GetString().Should().Be("moveOut");
            stored.GetProperty("referenceInspectionId").GetGuid().Should().Be(moveInId);
            CopiesOf(stored).Should().Equal(("good", null), ("fair", "Risco no vidro"), ("new", null));
            ConditionsOf(stored).Should().Equal("poor", "poor", "poor");
        }
    }

    // Item que não estava na entrada (posto depois, na tela de campo) não tem cópia, nem se vier no corpo.
    [Fact]
    public async Task Rewrite_WithANewItem_SavesItWithoutCopy()
    {
        var client = factory.CreateAuthenticatedClient();
        var (moveInId, moveIn) = await CreateCompletedMoveIn(client, await CreateProperty(client));
        var id = Guid.CreateVersion7();
        var body = MoveOutOf(moveInId, moveIn);
        var created = await Put(client, id, body);
        var added = new ItemBody(Guid.CreateVersion7(), "Tomadas", 1, null, "good", "Da entrada?");
        var withNewItem = body with
        {
            Rooms = [body.Rooms[0], body.Rooms[1] with { Items = [.. body.Rooms[1].Items, added] }],
        };

        var response = await Put(client, id, withNewItem, ETagOf(created));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        CopiesOf(await Body(response)).Should().Equal(
            ("good", null), ("fair", "Risco no vidro"), ("new", null), (null, null));
    }

    [Fact]
    public async Task Rewrite_MoveOutOnAnotherProperty_Returns400OnPropertyId()
    {
        var client = factory.CreateAuthenticatedClient();
        var (moveInId, moveIn) = await CreateCompletedMoveIn(client, await CreateProperty(client));
        var id = Guid.CreateVersion7();
        var body = MoveOutOf(moveInId, moveIn);
        var created = await Put(client, id, body);

        var response = await Put(client, id, body with { PropertyId = await CreateProperty(client) }, ETagOf(created));

        await AssertValidation(response, "propertyId");
    }

    private sealed record InspectionBody(
        Guid PropertyId, string Kind, string Status, Guid? ReferenceInspectionId, DateTimeOffset StartedAt,
        List<RoomBody> Rooms);

    private sealed record RoomBody(Guid Id, string Name, int Position, List<ItemBody> Items);

    private sealed record ItemBody(
        Guid Id, string Name, int Position, string? Condition, string? ReferenceCondition = null,
        string? ReferenceNotes = null, string? Notes = null);

    private static readonly DateTimeOffset StartedAt = new(2026, 10, 20, 9, 30, 0, TimeSpan.Zero);

    // Dois ambientes e três itens, todos avaliados: só falta o status para concluir.
    private static InspectionBody MoveInBody(Guid propertyId) => new(
        propertyId, "moveIn", "inProgress", null, StartedAt,
        [
            new(Guid.CreateVersion7(), "Sala", 0,
            [
                new(Guid.CreateVersion7(), "Piso", 0, "good"),
                new(Guid.CreateVersion7(), "Janelas", 1, "fair", Notes: "Risco no vidro"),
            ]),
            new(Guid.CreateVersion7(), "Cozinha", 1, [new(Guid.CreateVersion7(), "Pia", 0, "new")]),
        ]);

    // Como o front faz a saída: ambientes e itens com ids novos, a condição e as observações da entrada na cópia, e a
    // condição nula.
    private static InspectionBody MoveOutOf(Guid? referenceId, InspectionBody moveIn) => moveIn with
    {
        Kind = "moveOut",
        Status = "inProgress",
        ReferenceInspectionId = referenceId,
        StartedAt = StartedAt.AddMonths(12),
        Rooms =
        [
            .. moveIn.Rooms.Select(room => room with
            {
                Id = Guid.CreateVersion7(),
                Items =
                [
                    .. room.Items.Select(item => new ItemBody(
                        Guid.CreateVersion7(), item.Name, item.Position, null, item.Condition, item.Notes)),
                ],
            }),
        ],
    };

    private static async Task<Guid> CreateMoveIn(HttpClient client, Guid propertyId)
    {
        var id = Guid.CreateVersion7();
        (await Put(client, id, MoveInBody(propertyId))).StatusCode.Should().Be(HttpStatusCode.Created);
        return id;
    }

    private static async Task<(Guid Id, InspectionBody Body)> CreateCompletedMoveIn(HttpClient client, Guid propertyId)
    {
        var id = Guid.CreateVersion7();
        var body = MoveInBody(propertyId) with { Status = "completed" };
        (await Put(client, id, body)).StatusCode.Should().Be(HttpStatusCode.Created);
        return (id, body);
    }

    // Só uma entrada em andamento pode ser excluída: a concluída responde 409 locked.
    private static async Task<Guid> CreateDeletedMoveIn(HttpClient client, Guid propertyId)
    {
        var id = Guid.CreateVersion7();
        var created = await Put(client, id, MoveInBody(propertyId));
        var request = WriteRequests.Delete(PathOf(id));
        request.Headers.TryAddWithoutValidation("If-Match", $"\"{ETagOf(created)}\"");
        (await client.SendAsync(request, Ct)).StatusCode.Should().Be(HttpStatusCode.NoContent);
        return id;
    }

    private static async Task<Guid> CreateMoveOut(HttpClient client, Guid moveInId, InspectionBody moveIn)
    {
        var id = Guid.CreateVersion7();
        (await Put(client, id, MoveOutOf(moveInId, moveIn))).StatusCode.Should().Be(HttpStatusCode.Created);
        return id;
    }

    private async Task<Guid> OtherOwnersCompletedMoveIn()
    {
        var other = factory.CreateAuthenticatedClient();
        return (await CreateCompletedMoveIn(other, await CreateProperty(other))).Id;
    }

    private static async Task<Guid> CreateProperty(HttpClient client)
    {
        var clientId = Guid.CreateVersion7();
        (await client.SendAsync(WriteRequests.Put($"/api/v1/clients/{clientId}", new { name = "Maria Locadora" }), Ct))
            .StatusCode.Should().Be(HttpStatusCode.Created);
        var propertyId = Guid.CreateVersion7();
        (await client.SendAsync(WriteRequests.Put($"/api/v1/properties/{propertyId}", new
        {
            clientId,
            street = "Rua Direita",
            number = "10",
            district = "Centro",
            city = "Salvador",
            state = "BA",
            zipCode = "40020000",
            type = "apartment",
        }), Ct)).StatusCode.Should().Be(HttpStatusCode.Created);
        return propertyId;
    }

    private static string PathOf(Guid id) => $"/api/v1/inspections/{id}";

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

    private static string ETagOf(HttpResponseMessage response) => response.Headers.ETag!.Tag.Trim('"');

    private static IEnumerable<JsonElement> ItemsOf(JsonElement inspection) =>
        inspection.GetProperty("rooms").EnumerateArray().SelectMany(room => room.GetProperty("items").EnumerateArray());

    private static List<(string?, string?)> CopiesOf(JsonElement inspection) =>
    [
        .. ItemsOf(inspection).Select(item => (
            item.GetProperty("referenceCondition").GetString(), item.GetProperty("referenceNotes").GetString())),
    ];

    private static List<string?> ConditionsOf(JsonElement inspection) =>
        [.. ItemsOf(inspection).Select(item => item.GetProperty("condition").GetString())];

    // 400 validation com exatamente essas chaves em errors.
    private static async Task AssertValidation(HttpResponseMessage response, params string[] paths)
    {
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var problem = await Body(response);
        problem.GetProperty("type").GetString().Should().Be(ProblemTypes.Validation);
        problem.GetProperty("errors").EnumerateObject().Select(e => e.Name).Should().BeEquivalentTo(paths);
    }
}
