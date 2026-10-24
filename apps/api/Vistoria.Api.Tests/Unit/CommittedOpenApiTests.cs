using System.Text.Json;
using AwesomeAssertions;
using Vistoria.Api.Infrastructure.Errors;
using Vistoria.Api.Tests.Support;

namespace Vistoria.Api.Tests.Unit;

// O openapi.json commitado é o que o front gera; o CI já garante que ele é igual ao do build.
public class CommittedOpenApiTests
{
    [Fact]
    public void ProblemType_EnumIsExactlyTheCatalog()
    {
        var schema = Document()
            .GetProperty("components").GetProperty("schemas").GetProperty("ProblemType");

        schema.GetProperty("enum").EnumerateArray().Select(e => e.GetString())
            .Should().BeEquivalentTo(ProblemTypes.All);
    }

    // backend.md, "Contrato da API": enums como string. O front recebe a union, não números.
    [Fact]
    public void PropertyType_IsAStringEnum_ReferencedByBothDtos()
    {
        var schemas = Document().GetProperty("components").GetProperty("schemas");

        schemas.GetProperty("PropertyType").GetProperty("enum").EnumerateArray().Select(e => e.GetString())
            .Should().Equal("apartment", "house", "commercial", "other");
        schemas.GetProperty("PropertyDto").GetProperty("properties").GetProperty("type").GetProperty("$ref")
            .GetString().Should().Be("#/components/schemas/PropertyType");
        schemas.GetProperty("UpsertPropertyDto").GetProperty("properties").GetProperty("type").GetProperty("oneOf")
            .EnumerateArray().Select(s => s.TryGetProperty("$ref", out var r) ? r.GetString() : null)
            .Should().Contain("#/components/schemas/PropertyType");
    }

    // Ambientes e itens vão inteiros no corpo do roteiro, com id, nome e posição.
    [Theory]
    [InlineData("get", "getTemplate")]
    [InlineData("put", "upsertTemplate")]
    public void TemplateOperations_ReturnTemplateDto_WithRoomsAndItems(string method, string operationId)
    {
        var document = Document();
        var operation = document.GetProperty("paths").GetProperty("/api/v1/templates/{id}").GetProperty(method);
        var schemas = document.GetProperty("components").GetProperty("schemas");

        operation.GetProperty("operationId").GetString().Should().Be(operationId);
        operation.GetProperty("responses").GetProperty("200").GetProperty("content").GetProperty("application/json")
            .GetProperty("schema").GetProperty("$ref").GetString().Should().Be("#/components/schemas/TemplateDto");
        schemas.GetProperty("TemplateDto").GetProperty("properties").GetProperty("rooms").GetProperty("items")
            .GetProperty("$ref").GetString().Should().Be("#/components/schemas/TemplateRoomDto");
        schemas.GetProperty("TemplateRoomDto").GetProperty("properties").EnumerateObject().Select(p => p.Name)
            .Should().Equal("id", "name", "position", "items");
        schemas.GetProperty("TemplateItemDto").GetProperty("properties").EnumerateObject().Select(p => p.Name)
            .Should().Equal("id", "name", "position");
    }

    // O agregado inteiro vai e volta no corpo da vistoria; os campos de referência dos itens são só de saída.
    [Theory]
    [InlineData("get", "getInspection", new[] { "200", "401", "404" })]
    [InlineData("put", "upsertInspection",
        new[] { "200", "201", "400", "401", "403", "409", "410", "412", "422", "428", "429" })]
    public void InspectionOperations_ReturnInspectionDto_WithRoomsAndItems(
        string method, string operationId, string[] statuses)
    {
        var document = Document();
        var operation = document.GetProperty("paths").GetProperty("/api/v1/inspections/{id}").GetProperty(method);
        var schemas = document.GetProperty("components").GetProperty("schemas");

        operation.GetProperty("operationId").GetString().Should().Be(operationId);
        operation.GetProperty("responses").EnumerateObject().Select(r => r.Name).Should().BeEquivalentTo(statuses);
        operation.GetProperty("responses").GetProperty("200").GetProperty("content").GetProperty("application/json")
            .GetProperty("schema").GetProperty("$ref").GetString().Should().Be("#/components/schemas/InspectionDto");
        schemas.GetProperty("InspectionDto").GetProperty("properties").GetProperty("rooms").GetProperty("items")
            .GetProperty("$ref").GetString().Should().Be("#/components/schemas/RoomDto");
        schemas.GetProperty("RoomDto").GetProperty("properties").GetProperty("items").GetProperty("items")
            .GetProperty("$ref").GetString().Should().Be("#/components/schemas/InspectionItemDto");
        schemas.GetProperty("InspectionItemDto").GetProperty("properties").EnumerateObject().Select(p => p.Name)
            .Should().Equal("id", "name", "position", "condition", "notes", "referenceCondition", "referenceNotes");
        schemas.GetProperty("UpsertInspectionItemDto").GetProperty("properties").EnumerateObject().Select(p => p.Name)
            .Should().Equal("id", "name", "position", "condition", "notes");
    }

    // O Swagger UI lista as rotas do documento: as quatro entidades sincronizáveis com GET e PUT.
    [Fact]
    public void Document_HasGetAndPutForTheFourEntities()
    {
        var paths = Document().GetProperty("paths");

        foreach (var resource in new[] { "clients", "properties", "templates", "inspections" })
        {
            paths.GetProperty($"/api/v1/{resource}/{{id}}").EnumerateObject().Select(o => o.Name)
                .Should().Contain(["get", "put"], resource);
        }
    }

    // Status da tabela de Endpoints do backend.md.
    [Theory]
    [InlineData("/api/v1/auth/signup", "signUp", "201", new[] { "400", "429" })]
    [InlineData("/api/v1/auth/signin", "signIn", "200", new[] { "400", "401", "429" })]
    public void AuthOperations_ReturnAuthDto_AndTheirProblems(string path, string operationId, string success,
        string[] problems)
    {
        var operation = Document().GetProperty("paths").GetProperty(path).GetProperty("post");
        var responses = operation.GetProperty("responses");

        operation.GetProperty("operationId").GetString().Should().Be(operationId);
        responses.EnumerateObject().Select(r => r.Name).Should().BeEquivalentTo([success, .. problems]);
        responses.GetProperty(success).GetProperty("content").GetProperty("application/json").GetProperty("schema")
            .GetProperty("$ref").GetString().Should().Be("#/components/schemas/AuthDto");
        foreach (var status in problems)
        {
            responses.GetProperty(status).GetProperty("content").GetProperty("application/problem+json")
                .GetProperty("schema").GetProperty("$ref").GetString()
                .Should().Be("#/components/schemas/ProblemDetails");
        }

        responses.GetProperty("429").GetProperty("headers").TryGetProperty("Retry-After", out _).Should().BeTrue();
    }

    private static JsonElement Document() =>
        JsonDocument.Parse(File.ReadAllText(Path.Combine(RepoRoot.Path, "apps", "api", "openapi.json"))).RootElement;
}
