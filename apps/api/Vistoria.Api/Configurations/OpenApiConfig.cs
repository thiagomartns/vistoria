using System.Reflection;
using Vistoria.Api.Infrastructure.OpenApi;

namespace Vistoria.Api.Configurations;

public static class OpenApiConfig
{
    private const string DocumentName = "v1";

    /// <summary>
    /// O <c>dotnet build</c> gera o <c>openapi.json</c> subindo o host pela ferramenta <c>GetDocument.Insider</c>,
    /// sem segredo nenhum configurado. Só a validação de segredos no start olha isto.
    /// </summary>
    public static bool IsBuildTimeGeneration { get; } =
        Assembly.GetEntryAssembly()?.GetName().Name == "GetDocument.Insider";

    public static IServiceCollection AddOpenApiDocs(this IServiceCollection services)
    {
        services.AddOpenApi(DocumentName, options =>
        {
            options.AddDocumentTransformer<ProblemSchemasTransformer>();
            options.AddOperationTransformer<ContractOperationTransformer>();
        });
        return services;
    }

    public static WebApplication UseOpenApiDocs(this WebApplication app)
    {
        if (!app.Environment.IsDevelopment())
        {
            return app;
        }

        // Documento nativo em /openapi/v1.json, público como o Swagger UI (em /swagger), que só lê esse documento.
        app.MapOpenApi().AllowAnonymous();
        app.UseSwaggerUI(options => options.SwaggerEndpoint($"/openapi/{DocumentName}.json", DocumentName));
        return app;
    }
}
