using Microsoft.AspNetCore.Mvc;
using Vistoria.Api.Infrastructure.Background;
using Vistoria.Api.Infrastructure.Idempotency;
using Vistoria.Api.Repositories;
using Vistoria.Api.Repositories.Impl;

namespace Vistoria.Api.Configurations;

/// <summary>Prazos da idempotência de backend.md, "Parâmetros compartilhados".</summary>
public static class IdempotencyConfig
{
    /// <summary>Validade da <c>Idempotency-Key</c>: o mesmo prazo do refresh token.</summary>
    public static readonly TimeSpan KeyValidity = TimeSpan.FromDays(7);

    /// <summary><c>Retry-After</c> do 409 <c>idempotency-in-progress</c>.</summary>
    public static readonly TimeSpan InProgressRetryAfter = TimeSpan.FromSeconds(1);

    /// <summary>Intervalo do <see cref="CleanupService"/>.</summary>
    public static readonly TimeSpan CleanupInterval = TimeSpan.FromHours(1);

    // Filtro global: nenhum PUT ou DELETE novo fica sem a chave. Ele mesmo ignora os outros métodos.
    public static IServiceCollection AddIdempotency(this IServiceCollection services)
    {
        services.AddScoped<IIdempotencyRepository, IdempotencyRepository>();
        services.Configure<MvcOptions>(options => options.Filters.Add<IdempotencyFilter>());
        services.AddSingleton<CleanupService>();
        services.AddHostedService(sp => sp.GetRequiredService<CleanupService>());
        return services;
    }
}
