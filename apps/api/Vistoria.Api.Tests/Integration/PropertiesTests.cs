using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using AwesomeAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Vistoria.Api.Infrastructure.Errors;
using Vistoria.Api.Model;
using Vistoria.Api.Model.Context;
using Vistoria.Api.Tests.Support;

namespace Vistoria.Api.Tests.Integration;

public class PropertiesTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Put_NewId_Returns201WithETag_AndTheSameBodyAgain_Returns200WithAnotherETag()
    {
        var client = factory.CreateAuthenticatedClient();
        var body = ValidBody(await CreateClient(client));
        var id = Guid.CreateVersion7();

        var created = await Put(client, id, body);
        created.StatusCode.Should().Be(HttpStatusCode.Created);
        created.Headers.Location!.AbsolutePath.Should().Be(PathOf(id));
        var firstETag = ETagOf(created);
        Version(await Body(created)).Should().Be(firstETag);

        var updated = await Put(client, id, body);
        updated.StatusCode.Should().Be(HttpStatusCode.OK);
        var secondETag = ETagOf(updated);
        secondETag.Should().NotBe(firstETag);
        Version(await Body(updated)).Should().Be(secondETag);
    }

    [Fact]
    public async Task Get_Returns200WithTheFieldsAndVersionEqualToTheETag()
    {
        var client = factory.CreateAuthenticatedClient();
        var clientId = await CreateClient(client);
        var id = Guid.CreateVersion7();
        var put = await Put(client, id, ValidBody(clientId));

        var response = await client.GetAsync(PathOf(id), Ct);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await Body(response);
        Version(body).Should().Be(ETagOf(response)).And.Be(ETagOf(put));
        body.GetProperty("id").GetGuid().Should().Be(id);
        body.GetProperty("clientId").GetGuid().Should().Be(clientId);
        body.GetProperty("street").GetString().Should().Be("Avenida Paulista");
        body.GetProperty("number").GetString().Should().Be("1578");
        body.GetProperty("complement").GetString().Should().Be("Apto 12");
        body.GetProperty("district").GetString().Should().Be("Bela Vista");
        body.GetProperty("city").GetString().Should().Be("São Paulo");
        body.GetProperty("state").GetString().Should().Be("SP");
        body.GetProperty("zipCode").GetString().Should().Be("01310200");
        body.GetProperty("type").GetString().Should().Be("apartment");
        body.GetProperty("notes").GetString().Should().Be("Chaves na portaria.");
        body.GetProperty("createdAt").GetDateTimeOffset().Should().Be(factory.Time.GetUtcNow());
        body.TryGetProperty("ownerId", out _).Should().BeFalse();
    }

    [Fact]
    public async Task Put_OptionalFieldsOmitted_AreNull()
    {
        var client = factory.CreateAuthenticatedClient();
        var clientId = await CreateClient(client);

        var response = await Put(client, Guid.CreateVersion7(), new
        {
            clientId,
            street = "Rua Sem Complemento",
            number = "s/n",
            district = "Centro",
            city = "Curitiba",
            state = "PR",
            zipCode = "80010000",
            type = "house",
        });

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var body = await Body(response);
        body.GetProperty("complement").ValueKind.Should().Be(JsonValueKind.Null);
        body.GetProperty("notes").ValueKind.Should().Be(JsonValueKind.Null);
        body.GetProperty("type").GetString().Should().Be("house");
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Get_MissingOrFromAnotherOwner_Returns404NotFound(bool otherOwner)
    {
        var id = Guid.CreateVersion7();
        if (otherOwner)
        {
            var owner = factory.CreateAuthenticatedClient();
            (await Put(owner, id, ValidBody(await CreateClient(owner)))).StatusCode
                .Should().Be(HttpStatusCode.Created);
        }

        var response = await factory.CreateAuthenticatedClient().GetAsync(PathOf(id), Ct);

        await AssertProblem(response, HttpStatusCode.NotFound, ProblemTypes.NotFound);
    }

    [Fact]
    public async Task Put_FromAnotherOwner_Returns403Forbidden_AndKeepsTheRecord()
    {
        var id = Guid.CreateVersion7();
        var owner = factory.CreateAuthenticatedClient();
        var original = await Put(owner, id, ValidBody(await CreateClient(owner)));

        var intruder = factory.CreateAuthenticatedClient();
        var response = await Put(intruder, id, ValidBody(await CreateClient(intruder)) with { Street = "Invasão" });

        await AssertProblem(response, HttpStatusCode.Forbidden, ProblemTypes.Forbidden);
        var stored = await Stored(id);
        stored.Street.Should().Be("Avenida Paulista");
        Convert.ToBase64String(stored.Version).Should().Be(ETagOf(original));
    }

    [Fact]
    public async Task Put_TakesOwnerFromTheToken_AndIdFromTheRoute()
    {
        var ownerId = Guid.CreateVersion7();
        var client = factory.CreateAuthenticatedClient(ownerId);
        var body = ValidBody(await CreateClient(client));
        var id = Guid.CreateVersion7();

        var response = await Put(client, id, new
        {
            id = Guid.CreateVersion7(),
            ownerId = Guid.CreateVersion7(),
            body.ClientId,
            body.Street,
            body.Number,
            body.District,
            body.City,
            body.State,
            body.ZipCode,
            body.Type,
        });

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        (await Body(response)).GetProperty("id").GetGuid().Should().Be(id);
        (await Stored(id)).OwnerId.Should().Be(ownerId);
    }

    [Fact]
    public async Task Put_ChangesClient_ToAnotherOfTheSameOwner()
    {
        var client = factory.CreateAuthenticatedClient();
        var id = Guid.CreateVersion7();
        (await Put(client, id, ValidBody(await CreateClient(client)))).StatusCode.Should().Be(HttpStatusCode.Created);
        var otherClientId = await CreateClient(client);

        var response = await Put(client, id, ValidBody(otherClientId));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await Stored(id)).ClientId.Should().Be(otherClientId);
    }

    // Cada linha troca um campo do corpo válido; o erro sai só nele.
    public static TheoryData<string, object?> InvalidFields => new()
    {
        { "state", "XX" },
        { "state", "sp" },
        { "state", "S" },
        { "state", "SPP" },
        { "state", "" },
        { "zipCode", "0131020" },
        { "zipCode", "01310-200" },
        { "zipCode", "013102000" },
        { "zipCode", "abcdefgh" },
        { "zipCode", "" },
        { "type", "castle" },
        { "type", 1 },
        { "type", null },
        { "street", "" },
        { "street", new string('a', 121) },
        { "number", "" },
        { "district", "" },
        { "city", "" },
        { "complement", new string('a', 61) },
        { "notes", new string('a', 1001) },
        { "clientId", null },
    };

    [Theory]
    [MemberData(nameof(InvalidFields))]
    public async Task Put_InvalidField_Returns400OnTheField(string field, object? value)
    {
        var client = factory.CreateAuthenticatedClient();
        var body = BodyWith(ValidBody(await CreateClient(client)), field, value);
        var id = Guid.CreateVersion7();

        var response = await Put(client, id, body);

        await AssertProblem(response, HttpStatusCode.BadRequest, ProblemTypes.Validation);
        (await Body(response)).GetProperty("errors").EnumerateObject().Select(p => p.Name).Should().Equal(field);
        (await StoredOrNull(id)).Should().BeNull();
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Put_ClientMissingOrFromAnotherOwner_Returns400OnClientId(bool otherOwner)
    {
        var clientId = otherOwner ? await CreateClient(factory.CreateAuthenticatedClient()) : Guid.CreateVersion7();
        var id = Guid.CreateVersion7();

        var response = await Put(factory.CreateAuthenticatedClient(), id, ValidBody(clientId));

        await AssertProblem(response, HttpStatusCode.BadRequest, ProblemTypes.Validation);
        (await Body(response)).GetProperty("errors").EnumerateObject().Select(p => p.Name).Should().Equal("clientId");
        (await StoredOrNull(id)).Should().BeNull();
    }

    [Fact]
    public async Task WithoutToken_Returns401()
    {
        var client = factory.CreateClient();
        var id = Guid.CreateVersion7();

        await AssertProblem(await client.GetAsync(PathOf(id), Ct), HttpStatusCode.Unauthorized,
            ProblemTypes.Unauthorized);
        await AssertProblem(await Put(client, id, ValidBody(Guid.CreateVersion7())), HttpStatusCode.Unauthorized,
            ProblemTypes.Unauthorized);
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
        string Type,
        string? Notes);

    private static PropertyBody ValidBody(Guid clientId) => new(
        clientId, "Avenida Paulista", "1578", "Apto 12", "Bela Vista", "São Paulo", "SP", "01310200", "apartment",
        "Chaves na portaria.");

    // O corpo como objeto JSON, para trocar um campo por um valor de outro tipo (número, null).
    private static Dictionary<string, object?> BodyWith(PropertyBody body, string field, object? value)
    {
        var json = JsonSerializer.SerializeToElement(body, JsonSerializerOptions.Web);
        var fields = json.EnumerateObject().ToDictionary(p => p.Name, object? (p) => p.Value);
        fields[field] = value;
        return fields;
    }

    private static async Task<Guid> CreateClient(HttpClient client)
    {
        var id = Guid.CreateVersion7();
        var response = await client.PutAsJsonAsync($"/api/v1/clients/{id}", new { name = "Imobiliária" }, Ct);
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        return id;
    }

    private static string PathOf(Guid id) => $"/api/v1/properties/{id}";

    private static Task<HttpResponseMessage> Put(HttpClient client, Guid id, object body) =>
        client.PutAsJsonAsync(PathOf(id), body, Ct);

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

    private async Task<Property> Stored(Guid id) => (await StoredOrNull(id))!;

    private async Task<Property?> StoredOrNull(Guid id)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.Properties.AsNoTracking().SingleOrDefaultAsync(p => p.Id == id, Ct);
    }
}
