namespace Vistoria.Api.Configurations;

public static class OpenApiConfig
{
    private const string DocumentName = "v1";

    public static IServiceCollection AddOpenApiDocs(this IServiceCollection services)
    {
        services.AddOpenApi(DocumentName);
        return services;
    }

    public static WebApplication UseOpenApiDocs(this WebApplication app)
    {
        if (!app.Environment.IsDevelopment())
        {
            return app;
        }

        // Documento nativo em /openapi/v1.json; o Swagger UI (em /swagger) só lê esse documento.
        app.MapOpenApi();
        app.UseSwaggerUI(options => options.SwaggerEndpoint($"/openapi/{DocumentName}.json", DocumentName));
        return app;
    }
}
