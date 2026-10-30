using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using Vistoria.Api.Infrastructure.Errors;

namespace Vistoria.Api.Configurations;

/// <summary>Limites por IP de backend.md, "Parâmetros compartilhados". Cada política conta separado.</summary>
public static class RateLimitConfig
{
    public const string SignUpPolicy = "signup";
    public const string SignInPolicy = "signin";
    public const string RefreshPolicy = "refresh";

    /// <summary>5 por minuto por IP, em <c>signup</c> e em <c>signin</c>, cada.</summary>
    public const int CredentialPermitLimit = 5;
    public static readonly TimeSpan CredentialWindow = TimeSpan.FromMinutes(1);

    /// <summary>30 por minuto por IP, em <c>refresh</c>.</summary>
    public const int RefreshPermitLimit = 30;
    public static readonly TimeSpan RefreshWindow = TimeSpan.FromMinutes(1);

    public static IServiceCollection AddRateLimits(this IServiceCollection services)
    {
        services.AddRateLimiter(options =>
        {
            options.AddPolicy(SignUpPolicy, context => PerIp(context, CredentialPermitLimit, CredentialWindow));
            options.AddPolicy(SignInPolicy, context => PerIp(context, CredentialPermitLimit, CredentialWindow));
            options.AddPolicy(RefreshPolicy, context => PerIp(context, RefreshPermitLimit, RefreshWindow));
            // Como o model state inválido: vira exceção do catálogo, e o GlobalExceptionHandler escreve o 429
            // com Retry-After no mesmo formato de qualquer outro erro.
            options.OnRejected = (context, _) => throw new RateLimitedException(
                context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter) ? retryAfter : CredentialWindow);
        });
        return services;
    }

    public static WebApplication UseRateLimits(this WebApplication app)
    {
        app.UseRateLimiter();
        return app;
    }

    // Atrás do proxy de produção, o IP real depende do ForwardedHeaders (M5, hospedagem).
    private static RateLimitPartition<string> PerIp(HttpContext context, int permitLimit, TimeSpan window) =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = permitLimit,
                Window = window,
                QueueLimit = 0,
            });
}
