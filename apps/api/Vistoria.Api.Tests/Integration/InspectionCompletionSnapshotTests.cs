using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using AwesomeAssertions;
using Vistoria.Api.Infrastructure.Errors;
using Vistoria.Api.Tests.Support;

namespace Vistoria.Api.Tests.Integration;

// A cópia do imóvel e do cliente na conclusão (ADR 0068): o servidor a grava a partir dos registros dele, nunca do
// corpo do PUT, e ela não muda quando o imóvel ou o cliente mudam depois, nem no GET nem no delta.
public class InspectionCompletionSnapshotTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static readonly PropertyBody OriginalProperty = new(
        Guid.Empty, "Rua das Flores", "120", "ap 32", "Jardim Paulista", "São Paulo", "SP", "01400000", "apartment");

    [Fact]
    public async Task Completing_CopiesThePropertyAndTheClientFromTheServer_IgnoringTheBody()
    {
        var http = factory.CreateAuthenticatedClient();
        var (_, property) = await CreatePropertyWithClient(http, "Imobiliária Horizonte", "11222333000181");
        var id = Guid.CreateVersion7();
        var body = NewInspection(property.Id);
        var created = await Put(http, id, body);
        (await Body(created)).GetProperty("completedSnapshot").ValueKind.Should().Be(JsonValueKind.Null);

        var response = await Put(http, id, WithForgedSnapshot(body, "completed"), ETagOf(created));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        foreach (var stored in new[] { await Body(response), await Body(await http.GetAsync(PathOf(id), Ct)) })
        {
            AssertSnapshot(stored, OriginalProperty, "Imobiliária Horizonte", "11222333000181");
        }
    }

    // Vistoria feita toda offline, enviada já concluída: nasce com a cópia.
    [Fact]
    public async Task CreatingAlreadyCompleted_HasTheSnapshot()
    {
        var http = factory.CreateAuthenticatedClient();
        var (_, property) = await CreatePropertyWithClient(http, "Maria Locadora", null);

        var response = await Put(http, Guid.CreateVersion7(), WithForgedSnapshot(NewInspection(property.Id), "completed"));

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        AssertSnapshot(await Body(response), OriginalProperty, "Maria Locadora", null);
    }

    // Em andamento não tem cópia, nem quando o cliente manda uma.
    [Fact]
    public async Task InProgress_HasNoSnapshot_EvenIfTheClientSendsOne()
    {
        var http = factory.CreateAuthenticatedClient();
        var (_, property) = await CreatePropertyWithClient(http, "Maria Locadora", null);

        var response = await Put(http, Guid.CreateVersion7(), WithForgedSnapshot(NewInspection(property.Id), "inProgress"));

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        (await Body(response)).GetProperty("completedSnapshot").ValueKind.Should().Be(JsonValueKind.Null);
    }

    // Endereço, tipo e cliente do imóvel mudam, e o cliente muda de nome e de documento: a concluída fica com os dados da
    // conclusão no GET e no delta. A vistoria em andamento do mesmo imóvel continua sem cópia (usa o imóvel atual).
    [Fact]
    public async Task Snapshot_StaysTheSame_WhenThePropertyAndTheClientChangeLater()
    {
        var http = factory.CreateAuthenticatedClient();
        var (clientEtag, property) = await CreatePropertyWithClient(http, "Imobiliária Horizonte", "11222333000181");
        var completedId = Guid.CreateVersion7();
        (await Put(http, completedId, NewInspection(property.Id) with { Status = "completed" }))
            .StatusCode.Should().Be(HttpStatusCode.Created);
        var inProgressId = Guid.CreateVersion7();
        (await Put(http, inProgressId, NewInspection(property.Id))).StatusCode.Should().Be(HttpStatusCode.Created);

        // O cliente original muda de nome e de documento.
        var renamed = WriteRequests.Put(
            $"/api/v1/clients/{property.ClientId}", new { name = "Horizonte Imóveis", document = "52998224725" });
        renamed.Headers.TryAddWithoutValidation("If-Match", $"\"{clientEtag}\"");
        (await http.SendAsync(renamed, Ct)).StatusCode.Should().Be(HttpStatusCode.OK);

        // O imóvel muda de endereço e de tipo e passa para outro cliente.
        var (_, other) = await CreatePropertyWithClient(http, "Outra Imobiliária", null);
        var moved = WriteRequests.Put($"/api/v1/properties/{property.Id}", (property with
        {
            ClientId = other.ClientId,
            Street = "Avenida Paulista",
            Number = "1000",
            Complement = null,
            District = "Bela Vista",
            ZipCode = "01310100",
            Type = "commercial",
        }).Wire());
        moved.Headers.TryAddWithoutValidation("If-Match", $"\"{property.ETag}\"");
        (await http.SendAsync(moved, Ct)).StatusCode.Should().Be(HttpStatusCode.OK);

        var get = await Body(await http.GetAsync(PathOf(completedId), Ct));
        var delta = await DeltaItem(http, completedId);
        foreach (var stored in new[] { get, delta })
        {
            AssertSnapshot(stored, OriginalProperty, "Imobiliária Horizonte", "11222333000181");
        }

        (await DeltaItem(http, inProgressId)).GetProperty("completedSnapshot").ValueKind
            .Should().Be(JsonValueKind.Null);
    }

    // O 409 locked traz o registro atual com a cópia: é dele que o front refaz o registro local.
    [Fact]
    public async Task Locked_CarriesTheSnapshotInCurrent()
    {
        var http = factory.CreateAuthenticatedClient();
        var (_, property) = await CreatePropertyWithClient(http, "Maria Locadora", "52998224725");
        var id = Guid.CreateVersion7();
        var completed = await Put(http, id, NewInspection(property.Id) with { Status = "completed" });

        var response = await Put(http, id, NewInspection(property.Id), ETagOf(completed));

        response.StatusCode.Should().Be(HttpStatusCode.Conflict);
        var problem = await Body(response);
        problem.GetProperty("type").GetString().Should().Be(ProblemTypes.Locked);
        AssertSnapshot(problem.GetProperty("current"), OriginalProperty, "Maria Locadora", "52998224725");
    }

    private sealed record PropertyBody(
        Guid ClientId,
        string Street,
        string Number,
        string? Complement,
        string District,
        string City,
        string State,
        string ZipCode,
        string Type)
    {
        public Guid Id { get; init; }

        public string ETag { get; init; } = "";

        // O corpo do PUT, sem o id e o ETag, que vão na rota e no If-Match.
        public object Wire() => new { ClientId, Street, Number, Complement, District, City, State, ZipCode, Type };
    }

    private sealed record InspectionBody(
        Guid PropertyId, string Kind, string Status, DateTimeOffset StartedAt, List<RoomBody> Rooms);

    private sealed record RoomBody(Guid Id, string Name, int Position, List<ItemBody> Items);

    private sealed record ItemBody(Guid Id, string Name, int Position, string? Condition);

    private static InspectionBody NewInspection(Guid propertyId) => new(
        propertyId, "moveIn", "inProgress", new DateTimeOffset(2026, 10, 20, 9, 30, 0, TimeSpan.Zero),
        [new(Guid.CreateVersion7(), "Sala", 0, [new(Guid.CreateVersion7(), "Piso", 0, "good")])]);

    // O corpo com uma cópia inventada pelo cliente, que o servidor ignora.
    private static JsonObject WithForgedSnapshot(InspectionBody body, string status)
    {
        var root = JsonSerializer.SerializeToNode(body with { Status = status }, JsonSerializerOptions.Web)!.AsObject();
        root["completedSnapshot"] = new JsonObject
        {
            ["property"] = new JsonObject
            {
                ["street"] = "Rua Forjada",
                ["number"] = "1",
                ["district"] = "Nenhum",
                ["city"] = "Lugar",
                ["state"] = "XX",
                ["zipCode"] = "00000000",
                ["type"] = "house",
            },
            ["client"] = new JsonObject { ["name"] = "Outra pessoa", ["document"] = "00000000000" },
        };
        return root;
    }

    // Um cliente e um imóvel dele com o endereço de OriginalProperty: devolve o ETag do cliente e o imóvel com o dele.
    private static async Task<(string ClientETag, PropertyBody Property)> CreatePropertyWithClient(
        HttpClient http, string name, string? document)
    {
        var clientId = Guid.CreateVersion7();
        var client = await http.SendAsync(WriteRequests.Put($"/api/v1/clients/{clientId}", new { name, document }), Ct);
        client.StatusCode.Should().Be(HttpStatusCode.Created);
        var id = Guid.CreateVersion7();
        var body = OriginalProperty with { ClientId = clientId };
        var property = await http.SendAsync(WriteRequests.Put($"/api/v1/properties/{id}", body.Wire()), Ct);
        property.StatusCode.Should().Be(HttpStatusCode.Created);
        return (ETagOf(client), body with { Id = id, ETag = ETagOf(property) });
    }

    private static void AssertSnapshot(JsonElement stored, PropertyBody property, string name, string? document)
    {
        var snapshot = stored.GetProperty("completedSnapshot");
        var copied = snapshot.GetProperty("property");
        copied.GetProperty("street").GetString().Should().Be(property.Street);
        copied.GetProperty("number").GetString().Should().Be(property.Number);
        copied.GetProperty("complement").GetString().Should().Be(property.Complement);
        copied.GetProperty("district").GetString().Should().Be(property.District);
        copied.GetProperty("city").GetString().Should().Be(property.City);
        copied.GetProperty("state").GetString().Should().Be(property.State);
        copied.GetProperty("zipCode").GetString().Should().Be(property.ZipCode);
        copied.GetProperty("type").GetString().Should().Be(property.Type);
        var client = snapshot.GetProperty("client");
        client.GetProperty("name").GetString().Should().Be(name);
        client.GetProperty("document").GetString().Should().Be(document);
    }

    // A vistoria no delta desde o começo: o usuário do teste é novo, então a primeira página tem todas.
    private static async Task<JsonElement> DeltaItem(HttpClient http, Guid id)
    {
        var page = await Body(await http.GetAsync("/api/v1/sync/inspections?limit=100", Ct));
        return page.GetProperty("items").EnumerateArray().Single(item => item.GetProperty("id").GetGuid() == id);
    }

    private static string PathOf(Guid id) => $"/api/v1/inspections/{id}";

    private static Task<HttpResponseMessage> Put(HttpClient http, Guid id, object body, string? ifMatch = null)
    {
        var request = WriteRequests.Put(PathOf(id), body);
        if (ifMatch is not null)
        {
            request.Headers.TryAddWithoutValidation("If-Match", $"\"{ifMatch}\"");
        }

        return http.SendAsync(request, Ct);
    }

    private static async Task<JsonElement> Body(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync(Ct)).RootElement;

    private static string ETagOf(HttpResponseMessage response) => response.Headers.ETag!.Tag.Trim('"');
}
