using System.Net;
using System.Text.Json;
using AwesomeAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Vistoria.Api.Infrastructure.Errors;
using Vistoria.Api.Model;
using Vistoria.Api.Model.Context;
using Vistoria.Api.Tests.Support;

namespace Vistoria.Api.Tests.Integration;

public class ClientsTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static readonly object ValidBody = new
    {
        name = "Maria Locadora",
        document = "52998224725",
        email = "maria@teste.local",
        phone = "+55 11 91234-5678",
    };

    [Fact]
    public async Task Put_NewId_Returns201WithETag_AndTheSameBodyAgain_Returns200WithAnotherETag()
    {
        var client = factory.CreateAuthenticatedClient();
        var id = Guid.CreateVersion7();

        var created = await Put(client, id, ValidBody);
        created.StatusCode.Should().Be(HttpStatusCode.Created);
        created.Headers.Location!.AbsolutePath.Should().Be(PathOf(id));
        var firstETag = ETagOf(created);
        Version(await Body(created)).Should().Be(firstETag);

        var updated = await Put(client, id, ValidBody, firstETag);
        updated.StatusCode.Should().Be(HttpStatusCode.OK);
        var secondETag = ETagOf(updated);
        secondETag.Should().NotBe(firstETag);
        Version(await Body(updated)).Should().Be(secondETag);
    }

    [Fact]
    public async Task Get_Returns200WithTheFieldsAndVersionEqualToTheETag()
    {
        var client = factory.CreateAuthenticatedClient();
        var id = Guid.CreateVersion7();
        var put = await Put(client, id, ValidBody);

        var response = await client.GetAsync(PathOf(id), Ct);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await Body(response);
        Version(body).Should().Be(ETagOf(response)).And.Be(ETagOf(put));
        body.GetProperty("id").GetGuid().Should().Be(id);
        body.GetProperty("name").GetString().Should().Be("Maria Locadora");
        body.GetProperty("document").GetString().Should().Be("52998224725");
        body.GetProperty("email").GetString().Should().Be("maria@teste.local");
        body.GetProperty("phone").GetString().Should().Be("+55 11 91234-5678");
        body.GetProperty("createdAt").GetDateTimeOffset().Should().Be(factory.Time.GetUtcNow());
        body.TryGetProperty("ownerId", out _).Should().BeFalse();
    }

    [Fact]
    public async Task Put_OptionalFieldsOmitted_AreNull()
    {
        var client = factory.CreateAuthenticatedClient();

        var body = await Body(await Put(client, Guid.CreateVersion7(), new { name = "Só nome" }));

        body.GetProperty("document").ValueKind.Should().Be(JsonValueKind.Null);
        body.GetProperty("email").ValueKind.Should().Be(JsonValueKind.Null);
        body.GetProperty("phone").ValueKind.Should().Be(JsonValueKind.Null);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Get_MissingOrFromAnotherOwner_Returns404NotFound(bool otherOwner)
    {
        var id = Guid.CreateVersion7();
        if (otherOwner)
        {
            (await Put(factory.CreateAuthenticatedClient(), id, ValidBody)).StatusCode
                .Should().Be(HttpStatusCode.Created);
        }

        var response = await factory.CreateAuthenticatedClient().GetAsync(PathOf(id), Ct);

        await AssertProblem(response, HttpStatusCode.NotFound, ProblemTypes.NotFound);
    }

    [Fact]
    public async Task Put_FromAnotherOwner_Returns403Forbidden_AndKeepsTheRecord()
    {
        var id = Guid.CreateVersion7();
        var original = await Put(factory.CreateAuthenticatedClient(), id, ValidBody);

        var response = await Put(factory.CreateAuthenticatedClient(), id, new { name = "Invasor" });

        await AssertProblem(response, HttpStatusCode.Forbidden, ProblemTypes.Forbidden);
        var stored = await Stored(id);
        stored.Name.Should().Be("Maria Locadora");
        Convert.ToBase64String(stored.Version).Should().Be(ETagOf(original));
    }

    [Fact]
    public async Task Put_TakesOwnerFromTheToken_AndIdFromTheRoute()
    {
        var ownerId = Guid.CreateVersion7();
        var id = Guid.CreateVersion7();

        var response = await Put(factory.CreateAuthenticatedClient(ownerId), id,
            new { id = Guid.CreateVersion7(), ownerId = Guid.CreateVersion7(), name = "Maria" });

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        (await Body(response)).GetProperty("id").GetGuid().Should().Be(id);
        (await Stored(id)).OwnerId.Should().Be(ownerId);
    }

    public static TheoryData<string, string?, string> InvalidFields => new()
    {
        { "", null, "name" },
        { "A", null, "name" },
        { new string('a', 121), null, "name" },
        { "Maria", "", "document" },
        { "Maria", "52998224724", "document" },
        { "Maria", "529.982.247-25", "document" },
        { "Maria", "11222333000180", "document" },
    };

    [Theory]
    [MemberData(nameof(InvalidFields))]
    public async Task Put_InvalidField_Returns400OnTheField(string name, string? document, string key)
    {
        var id = Guid.CreateVersion7();

        var response = await Put(factory.CreateAuthenticatedClient(), id, new { name, document });

        await AssertProblem(response, HttpStatusCode.BadRequest, ProblemTypes.Validation);
        var body = await Body(response);
        body.GetProperty("errors").EnumerateObject().Select(p => p.Name).Should().Equal(key);
        (await StoredOrNull(id)).Should().BeNull();
    }

    [Fact]
    public async Task Put_AlphanumericCnpj_IsAccepted()
    {
        var response = await Put(factory.CreateAuthenticatedClient(), Guid.CreateVersion7(),
            new { name = "Imobiliária", document = "12ABC34501DE35" });

        response.StatusCode.Should().Be(HttpStatusCode.Created);
    }

    [Fact]
    public async Task WithoutToken_Returns401()
    {
        var client = factory.CreateClient();
        var id = Guid.CreateVersion7();

        await AssertProblem(await client.GetAsync(PathOf(id), Ct), HttpStatusCode.Unauthorized,
            ProblemTypes.Unauthorized);
        await AssertProblem(await Put(client, id, ValidBody), HttpStatusCode.Unauthorized,
            ProblemTypes.Unauthorized);
    }

    private static string PathOf(Guid id) => $"/api/v1/clients/{id}";

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

    private async Task<Client> Stored(Guid id) => (await StoredOrNull(id))!;

    private async Task<Client?> StoredOrNull(Guid id)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.Clients.AsNoTracking().SingleOrDefaultAsync(c => c.Id == id, Ct);
    }
}
