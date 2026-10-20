using Microsoft.Net.Http.Headers;

namespace Vistoria.Api.Configurations;

/// <summary>
/// CORS só em Development, onde front (<c>next dev</c>) e API ficam em portas diferentes. Em produção os dois
/// estão na mesma origem atrás do Caddy, e o CORS nem é registrado (backend.md, "Ambientes e hospedagem").
/// </summary>
public static class CorsConfig
{
    public const string DevOrigin = "http://localhost:3000";

    private const string DevPolicy = "dev";

    public static IServiceCollection AddDevCors(this IServiceCollection services, IHostEnvironment environment)
    {
        if (!environment.IsDevelopment())
        {
            return services;
        }

        // ETag e Retry-After não são cabeçalhos simples: sem expô-los, o front não os lê de outra origem.
        services.AddCors(options => options.AddPolicy(DevPolicy, policy => policy
            .WithOrigins(DevOrigin)
            .AllowCredentials()
            .AllowAnyHeader()
            .AllowAnyMethod()
            .WithExposedHeaders(HeaderNames.ETag, HeaderNames.RetryAfter)));
        return services;
    }

    public static WebApplication UseDevCors(this WebApplication app)
    {
        if (app.Environment.IsDevelopment())
        {
            app.UseCors(DevPolicy);
        }

        return app;
    }
}
