using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Vistoria.Api.Model.Context;

namespace Vistoria.Api.Configurations;

/// <summary>
/// Health checks nativos, fora de <c>/api/v1</c> e do contrato (backend.md, "Ambientes e hospedagem").
/// <c>/health/live</c> só diz que o processo responde; <c>/health/ready</c> inclui o banco e responde 503 sem ele,
/// para o proxy tirar a instância da rotação. A resposta é a do próprio health check (texto, sem ProblemDetails).
/// </summary>
public static class HealthConfig
{
    public const string LivePath = "/health/live";
    public const string ReadyPath = "/health/ready";

    private const string ReadyTag = "ready";

    public static IServiceCollection AddHealth(this IServiceCollection services)
    {
        services.AddHealthChecks().AddDbContextCheck<AppDbContext>("database", tags: [ReadyTag]);
        return services;
    }

    // Públicos: a fallback policy exige token em toda rota, e quem checa (proxy, compose, CI) não tem um.
    public static WebApplication MapHealth(this WebApplication app)
    {
        app.MapHealthChecks(LivePath, new HealthCheckOptions { Predicate = _ => false }).AllowAnonymous();
        app.MapHealthChecks(ReadyPath, new HealthCheckOptions { Predicate = check => check.Tags.Contains(ReadyTag) })
            .AllowAnonymous();
        return app;
    }
}
