using System.Net;
using System.Text.Json;
using AwesomeAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Vistoria.Api.Infrastructure.Errors;
using Vistoria.Api.Model.Context;
using Vistoria.Api.Tests.Support;

namespace Vistoria.Api.Tests.Integration;

// Fase 3 (backend.md, "Escrita" e "Testes de integração"): DELETE idempotente (204 também para inexistente ou já
// excluída) e 410 deleted no PUT. If-Match e Idempotency-Key do DELETE ficam em OptimisticConcurrencyTests e
// IdempotencyTests; a trava da concluída, em InspectionCompletionTests.
public class InspectionDeletionTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Delete_InProgress_Returns204_ThenGetIs404_AndPutIs410WithDeletedAt()
    {
        var client = factory.CreateAuthenticatedClient();
        var (id, body, etag) = await Create(client);
        factory.Time.Advance(TimeSpan.FromMinutes(10));
        var deletedAt = factory.Time.GetUtcNow();

        var deleted = await Delete(client, id, etag);

        deleted.StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await client.GetAsync(PathOf(id), Ct)).StatusCode.Should().Be(HttpStatusCode.NotFound);
        foreach (var ifMatch in new[] { etag, null })
        {
            var put = await Put(client, id, body, ifMatch);
            await AssertProblem(put, HttpStatusCode.Gone, ProblemTypes.Deleted);
            (await Body(put)).GetProperty("deletedAt").GetDateTimeOffset().Should().Be(deletedAt);
        }
    }

    // O tombstone é da raiz: ambientes e itens ficam como estavam, e os ids deles seguem usados.
    [Fact]
    public async Task Delete_MarksOnlyTheInspection_NotItsRoomsAndItems()
    {
        var client = factory.CreateAuthenticatedClient();
        var (id, body, etag) = await Create(client);

        (await Delete(client, id, etag)).StatusCode.Should().Be(HttpStatusCode.NoContent);

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        (await db.Inspections.IgnoreQueryFilters().SingleAsync(i => i.Id == id, Ct)).DeletedAt.Should().NotBeNull();
        (await db.Rooms.IgnoreQueryFilters().Where(r => r.InspectionId == id).Select(r => r.DeletedAt).ToListAsync(Ct))
            .Should().HaveCount(body.Rooms.Count).And.AllSatisfy(d => d.Should().BeNull());
        var itemIds = body.Rooms.SelectMany(r => r.Items).Select(it => it.Id).ToList();
        (await db.InspectionItems.IgnoreQueryFilters().Where(it => itemIds.Contains(it.Id))
                .Select(it => it.DeletedAt).ToListAsync(Ct))
            .Should().HaveCount(body.Rooms.Sum(r => r.Items.Count)).And.AllSatisfy(d => d.Should().BeNull());
    }

    // Sem If-Match: um id que não existe (ou não existe mais) não tem versão para provar.
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Delete_MissingOrAlreadyDeleted_Returns204(bool alreadyDeleted)
    {
        var client = factory.CreateAuthenticatedClient();
        var id = Guid.CreateVersion7();
        if (alreadyDeleted)
        {
            var (created, _, etag) = await Create(client);
            (await Delete(client, created, etag)).StatusCode.Should().Be(HttpStatusCode.NoContent);
            id = created;
        }

        var response = await Delete(client, id, ifMatch: null);

        response.StatusCode.Should().Be(HttpStatusCode.NoContent);
    }

    // O DELETE só olha registros vivos: a excluída de outro dono responde como a inexistente, sem revelar nada. O PUT
    // confere o dono antes da exclusão, como num registro vivo.
    [Fact]
    public async Task DeletedFromAnotherOwner_DeleteIs204_AndPutIs403()
    {
        var owner = factory.CreateAuthenticatedClient();
        var (id, _, etag) = await Create(owner);
        (await Delete(owner, id, etag)).StatusCode.Should().Be(HttpStatusCode.NoContent);
        var intruder = factory.CreateAuthenticatedClient();

        var delete = await Delete(intruder, id, ifMatch: null);
        var put = await Put(intruder, id, await NewBody(intruder), ifMatch: null);

        delete.StatusCode.Should().Be(HttpStatusCode.NoContent);
        await AssertProblem(put, HttpStatusCode.Forbidden, ProblemTypes.Forbidden);
    }

    [Fact]
    public async Task Delete_FromAnotherOwner_Returns403_AndKeepsTheInspection()
    {
        var owner = factory.CreateAuthenticatedClient();
        var (id, _, etag) = await Create(owner);

        var response = await Delete(factory.CreateAuthenticatedClient(), id, etag);

        await AssertProblem(response, HttpStatusCode.Forbidden, ProblemTypes.Forbidden);
        ETagOf(await owner.GetAsync(PathOf(id), Ct)).Should().Be(etag);
    }

    [Fact]
    public async Task Delete_WithoutToken_Returns401()
    {
        var response = await Delete(factory.CreateClient(), Guid.CreateVersion7(), ifMatch: null);

        await AssertProblem(response, HttpStatusCode.Unauthorized, ProblemTypes.Unauthorized);
    }

    private sealed record InspectionBody(
        Guid PropertyId, string Kind, string Status, DateTimeOffset StartedAt, List<RoomBody> Rooms);

    private sealed record RoomBody(Guid Id, string Name, int Position, List<ItemBody> Items);

    private sealed record ItemBody(Guid Id, string Name, int Position, string? Condition);

    private static async Task<InspectionBody> NewBody(HttpClient client) => new(
        await CreateProperty(client), "moveIn", "inProgress", new DateTimeOffset(2026, 10, 20, 9, 30, 0, TimeSpan.Zero),
        [
            new(Guid.CreateVersion7(), "Sala", 0,
            [
                new(Guid.CreateVersion7(), "Piso", 0, "good"),
                new(Guid.CreateVersion7(), "Janelas", 1, null),
            ]),
            new(Guid.CreateVersion7(), "Cozinha", 1, [new(Guid.CreateVersion7(), "Pia", 0, null)]),
        ]);

    private static async Task<(Guid Id, InspectionBody Body, string ETag)> Create(HttpClient client)
    {
        var id = Guid.CreateVersion7();
        var body = await NewBody(client);
        var response = await Put(client, id, body, ifMatch: null);
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        return (id, body, ETagOf(response));
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
    private static Task<HttpResponseMessage> Put(HttpClient client, Guid id, object body, string? ifMatch)
    {
        var request = WriteRequests.Put(PathOf(id), body);
        if (ifMatch is not null)
        {
            request.Headers.TryAddWithoutValidation("If-Match", $"\"{ifMatch}\"");
        }

        return client.SendAsync(request, Ct);
    }

    private static Task<HttpResponseMessage> Delete(HttpClient client, Guid id, string? ifMatch)
    {
        var request = WriteRequests.Delete(PathOf(id));
        if (ifMatch is not null)
        {
            request.Headers.TryAddWithoutValidation("If-Match", $"\"{ifMatch}\"");
        }

        return client.SendAsync(request, Ct);
    }

    private static async Task<JsonElement> Body(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync(Ct)).RootElement;

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
}
