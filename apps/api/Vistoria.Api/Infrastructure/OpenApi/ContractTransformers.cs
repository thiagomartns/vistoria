using System.Text.Json.Nodes;
using Microsoft.AspNetCore.OpenApi;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Net.Http.Headers;
using Microsoft.OpenApi;
using Vistoria.Api.Infrastructure.Errors;

namespace Vistoria.Api.Infrastructure.OpenApi;

/// <summary>Cabeçalhos do contrato que o framework não nomeia (backend.md, "Cabeçalhos").</summary>
public static class ContractHeaders
{
    public const string IdempotencyKey = "Idempotency-Key";
}

/// <summary>Nomes dos schemas que o contrato publica em <c>components.schemas</c>.</summary>
public static class ContractSchemas
{
    public const string ProblemType = "ProblemType";
    public const string ProblemDetails = "ProblemDetails";
}

/// <summary>
/// Publica <c>ProblemType</c> (enum com todos os <c>type</c> de <see cref="ProblemTypes"/>) e o
/// <c>ProblemDetails</c> que o <c>GlobalExceptionHandler</c> escreve, com as extensões opcionais do catálogo.
/// O front gera a union <c>ProblemType</c> daqui.
/// </summary>
public sealed class ProblemSchemasTransformer : IOpenApiDocumentTransformer
{
    public Task TransformAsync(
        OpenApiDocument document,
        OpenApiDocumentTransformerContext context,
        CancellationToken cancellationToken)
    {
        document.AddComponent(ContractSchemas.ProblemType, new OpenApiSchema
        {
            Type = JsonSchemaType.String,
            Description = "type de erro do catálogo (backend.md, \"Catálogo de erros\"). O front reage por ele.",
            Enum = [.. ProblemTypes.All.Select(t => (JsonNode)JsonValue.Create(t))],
        });

        document.AddComponent(ContractSchemas.ProblemDetails, new OpenApiSchema
        {
            Type = JsonSchemaType.Object,
            Description = "Erro da API (RFC 9457). Decida pelo type, nunca só pelo status.",
            Required = new HashSet<string> { "type", "title", "status", "detail", "traceId" },
            Properties = new Dictionary<string, IOpenApiSchema>
            {
                ["type"] = new OpenApiSchemaReference(ContractSchemas.ProblemType, document),
                ["title"] = new OpenApiSchema { Type = JsonSchemaType.String },
                ["status"] = new OpenApiSchema { Type = JsonSchemaType.Integer, Format = "int32" },
                ["detail"] = new OpenApiSchema { Type = JsonSchemaType.String },
                ["traceId"] = new OpenApiSchema { Type = JsonSchemaType.String },
                ["errors"] = new OpenApiSchema
                {
                    Type = JsonSchemaType.Object,
                    Description = "Só em validation: mensagens por caminho JSON do campo (rooms[2].items[4].condition).",
                    AdditionalProperties = new OpenApiSchema
                    {
                        Type = JsonSchemaType.Array,
                        Items = new OpenApiSchema { Type = JsonSchemaType.String },
                    },
                },
                ["current"] = new OpenApiSchema
                {
                    Description = "Só em version-conflict e locked: o registro como está no servidor (DTO da rota).",
                },
                ["deletedAt"] = new OpenApiSchema
                {
                    Type = JsonSchemaType.String,
                    Format = "date-time",
                    Description = "Só em deleted: quando o registro foi excluído.",
                },
                ["missingHeader"] = new OpenApiSchema
                {
                    Type = JsonSchemaType.String,
                    Description = "Só em precondition-required: o cabeçalho que faltou (If-Match ou Idempotency-Key).",
                },
            },
        });

        return Task.CompletedTask;
    }
}

/// <summary>
/// Por operação: <c>If-Match</c> e <c>Idempotency-Key</c> em todo <c>PUT</c> e <c>DELETE</c>, e as respostas
/// de erro declaradas com <see cref="ProblemResponsesAttribute"/>, em <c>application/problem+json</c>.
/// </summary>
public sealed class ContractOperationTransformer : IOpenApiOperationTransformer
{
    private const string ProblemContentType = "application/problem+json";

    private static readonly HashSet<string> WriteMethods =
        new(StringComparer.OrdinalIgnoreCase) { HttpMethods.Put, HttpMethods.Delete };

    public Task TransformAsync(
        OpenApiOperation operation,
        OpenApiOperationTransformerContext context,
        CancellationToken cancellationToken)
    {
        if (context.Description.HttpMethod is { } method && WriteMethods.Contains(method))
        {
            AddWriteHeaders(operation);
        }

        var statuses = context.Description.ActionDescriptor.EndpointMetadata
            .OfType<ProblemResponsesAttribute>()
            .SelectMany(a => a.StatusCodes)
            .Distinct()
            .Order();

        foreach (var status in statuses)
        {
            operation.Responses ??= [];
            operation.Responses[status.ToString(System.Globalization.CultureInfo.InvariantCulture)] =
                ProblemResponse(status, context.Document);
        }

        return Task.CompletedTask;
    }

    // If-Match não é required: na criação (id inexistente) ele é omitido. Marcá-lo obrigatório faria o client
    // gerado exigi-lo também no upsert que cria.
    private static void AddWriteHeaders(OpenApiOperation operation)
    {
        operation.Parameters ??= [];
        operation.Parameters.Add(new OpenApiParameter
        {
            Name = HeaderNames.IfMatch,
            In = ParameterLocation.Header,
            Required = false,
            Description = "ETag da versão-base. Obrigatório quando o registro já existe (ausente → 428 "
                + "precondition-required); omitido na criação.",
            Schema = new OpenApiSchema { Type = JsonSchemaType.String },
        });
        operation.Parameters.Add(new OpenApiParameter
        {
            Name = ContractHeaders.IdempotencyKey,
            In = ParameterLocation.Header,
            Required = true,
            Description = "UUID v7, um por corpo: o mesmo corpo reenviado usa a mesma chave.",
            Schema = new OpenApiSchema { Type = JsonSchemaType.String, Format = "uuid" },
        });
    }

    private static OpenApiResponse ProblemResponse(int status, OpenApiDocument? document)
    {
        var response = new OpenApiResponse
        {
            Description = ReasonPhrases.GetReasonPhrase(status),
            Content = new Dictionary<string, OpenApiMediaType>
            {
                [ProblemContentType] = new()
                {
                    Schema = new OpenApiSchemaReference(ContractSchemas.ProblemDetails, document),
                },
            },
        };

        var retryAfter = status switch
        {
            StatusCodes.Status429TooManyRequests => "Segundos até tentar de novo.",
            StatusCodes.Status409Conflict => "Segundos até tentar de novo, com a mesma chave. Só em idempotency-in-progress.",
            _ => null,
        };
        if (retryAfter is not null)
        {
            response.Headers = new Dictionary<string, IOpenApiHeader>
            {
                [HeaderNames.RetryAfter] = new OpenApiHeader
                {
                    Description = retryAfter,
                    Schema = new OpenApiSchema { Type = JsonSchemaType.Integer, Format = "int32" },
                },
            };
        }

        return response;
    }
}
