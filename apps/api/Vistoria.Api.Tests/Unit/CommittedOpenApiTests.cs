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

    // Na V1 só a vistoria é excluída (vision.md, "Regras de negócio"): 204 sem corpo e os erros da tabela de Endpoints.
    [Fact]
    public void DeleteInspection_Returns204WithoutBody_AndOnlyTheInspectionHasDelete()
    {
        var paths = Document().GetProperty("paths");
        var operation = paths.GetProperty("/api/v1/inspections/{id}").GetProperty("delete");

        operation.GetProperty("operationId").GetString().Should().Be("deleteInspection");
        operation.GetProperty("responses").EnumerateObject().Select(r => r.Name)
            .Should().BeEquivalentTo("204", "401", "403", "409", "412", "422", "428", "429");
        operation.GetProperty("responses").GetProperty("204").TryGetProperty("content", out _).Should().BeFalse();
        foreach (var resource in new[] { "clients", "properties", "templates" })
        {
            paths.GetProperty($"/api/v1/{resource}/{{id}}").TryGetProperty("delete", out _).Should().BeFalse(resource);
        }
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

    // backend.md, "Leitura por delta": a página com os DTOs da entidade, cursor e limit na query, e os erros do delta.
    [Theory]
    [InlineData("clients", "syncClients", "ClientDto")]
    [InlineData("properties", "syncProperties", "PropertyDto")]
    [InlineData("templates", "syncTemplates", "TemplateDto")]
    [InlineData("inspections", "syncInspections", "InspectionDto")]
    public void SyncOperations_ReturnTheEntityPage_WithCursorAndLimit(string resource, string operationId, string dto)
    {
        var document = Document();
        var operation = document.GetProperty("paths").GetProperty($"/api/v1/sync/{resource}").GetProperty("get");
        var responses = operation.GetProperty("responses");

        operation.GetProperty("operationId").GetString().Should().Be(operationId);
        responses.EnumerateObject().Select(r => r.Name).Should().BeEquivalentTo("200", "400", "401", "410");
        foreach (var status in new[] { "400", "401", "410" })
        {
            responses.GetProperty(status).GetProperty("content").GetProperty("application/problem+json")
                .GetProperty("schema").GetProperty("$ref").GetString()
                .Should().Be("#/components/schemas/ProblemDetails");
        }

        var parameters = operation.GetProperty("parameters").EnumerateArray().ToList();
        parameters.Select(p => (p.GetProperty("name").GetString(), p.GetProperty("in").GetString()))
            .Should().BeEquivalentTo([("cursor", "query"), ("limit", "query")]);
        var limit = parameters.Single(p => p.GetProperty("name").GetString() == "limit").GetProperty("schema");
        limit.GetProperty("minimum").GetInt32().Should().Be(1);
        limit.GetProperty("maximum").GetInt32().Should().Be(1000);
        limit.GetProperty("default").GetInt32().Should().Be(500);

        var pageRef = responses.GetProperty("200").GetProperty("content").GetProperty("application/json")
            .GetProperty("schema").GetProperty("$ref").GetString()!;
        var page = document.GetProperty("components").GetProperty("schemas").GetProperty(pageRef.Split('/')[^1]);
        page.GetProperty("required").EnumerateArray().Select(e => e.GetString())
            .Should().BeEquivalentTo("items", "deletedIds", "nextCursor", "hasMore");
        page.GetProperty("properties").GetProperty("items").GetProperty("items").GetProperty("$ref").GetString()
            .Should().Be($"#/components/schemas/{dto}");
        page.GetProperty("properties").GetProperty("deletedIds").GetProperty("items").GetProperty("format")
            .GetString().Should().Be("uuid");
    }

    // Status da tabela de Endpoints do backend.md.
    [Theory]
    [InlineData("/api/v1/auth/signup", "signUp", "201", "AuthDto", new[] { "400", "429" })]
    [InlineData("/api/v1/auth/signin", "signIn", "200", "AuthDto", new[] { "400", "401", "429" })]
    [InlineData("/api/v1/auth/refresh", "refreshToken", "200", "AccessTokenDto", new[] { "401", "429" })]
    public void AuthOperations_ReturnTheirDto_AndTheirProblems(string path, string operationId, string success,
        string schema, string[] problems)
    {
        var operation = Document().GetProperty("paths").GetProperty(path).GetProperty("post");
        var responses = operation.GetProperty("responses");

        operation.GetProperty("operationId").GetString().Should().Be(operationId);
        responses.EnumerateObject().Select(r => r.Name).Should().BeEquivalentTo([success, .. problems]);
        responses.GetProperty(success).GetProperty("content").GetProperty("application/json").GetProperty("schema")
            .GetProperty("$ref").GetString().Should().Be($"#/components/schemas/{schema}");
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
