using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using Vistoria.Api.Infrastructure.Errors;

namespace Vistoria.Api.Configurations;

/// <summary>Limites por IP de backend.md, "Parâmetros compartilhados". Cada política conta separado.</summary>
public static class RateLimitConfig
{
    public const string SignUpPolicy = "signup";
    public const string SignInPolicy = "signin";
    public const string RefreshPolicy = "refresh";
    public const string ZipCodePolicy = "zip-code";

    public static readonly TimeSpan CredentialWindow = TimeSpan.FromMinutes(1);
    public static readonly TimeSpan RefreshWindow = TimeSpan.FromMinutes(1);
    public static readonly TimeSpan ZipCodeWindow = TimeSpan.FromMinutes(1);

    public static IServiceCollection AddRateLimits(this IServiceCollection services)
    {
        services.AddOptions<RateLimitOptions>().BindConfiguration(RateLimitOptions.Section).ValidateOnStart();
        services.AddSingleton<IValidateOptions<RateLimitOptions>, RateLimitOptionsValidator>();
        services.AddRateLimiter(options =>
        {
            options.AddPolicy(SignUpPolicy, context => PerIp(context, l => l.CredentialPermitLimit, CredentialWindow));
            options.AddPolicy(SignInPolicy, context => PerIp(context, l => l.CredentialPermitLimit, CredentialWindow));
            options.AddPolicy(RefreshPolicy, context => PerIp(context, l => l.RefreshPermitLimit, RefreshWindow));
            // Por IP também: o rate limiter roda antes da autenticação, então ainda não há usuário (#185).
            options.AddPolicy(ZipCodePolicy, context => PerIp(context, l => l.ZipCodePermitLimit, ZipCodeWindow));
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

    // Atrás do Caddy, o RemoteIpAddress já é o do cliente: o ProxyConfig o troca antes, confiando só no proxy.
    // O limite vem das RateLimitOptions; o balde de cada IP é criado uma vez, com o valor de então.
    private static RateLimitPartition<string> PerIp(
        HttpContext context, Func<RateLimitOptions, int> limit, TimeSpan window) =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = limit(context.RequestServices.GetRequiredService<IOptions<RateLimitOptions>>().Value),
                Window = window,
                QueueLimit = 0,
            });
}

/// <summary>
/// Seção <c>RateLimit</c>. O padrão é o de backend.md, "Parâmetros compartilhados", e vale em dev e em produção; só o
/// job <c>e2e</c> do CI sobe os dois (<c>RateLimit__CredentialPermitLimit</c>, <c>RateLimit__RefreshPermitLimit</c>),
/// para os roteiros não esperarem o <c>Retry-After</c> (#197).
/// </summary>
public sealed class RateLimitOptions
{
    public const string Section = "RateLimit";

    /// <summary>Por minuto e IP, em <c>signup</c> e em <c>signin</c>, cada. Padrão: 5.</summary>
    public int CredentialPermitLimit { get; set; } = 5;

    /// <summary>Por minuto e IP, em <c>refresh</c>. Padrão: 30.</summary>
    public int RefreshPermitLimit { get; set; } = 30;

    /// <summary>Por minuto e IP, na consulta do CEP (<c>getAddressByZipCode</c>, #185). Padrão: 30.</summary>
    public int ZipCodePermitLimit { get; set; } = 30;
}

public sealed class RateLimitOptionsValidator : IValidateOptions<RateLimitOptions>
{
    public ValidateOptionsResult Validate(string? name, RateLimitOptions options)
    {
        var failures = new List<string>();
        if (options.CredentialPermitLimit < 1)
        {
            failures.Add($"{RateLimitOptions.Section}:CredentialPermitLimit precisa ser maior que zero.");
        }

        if (options.RefreshPermitLimit < 1)
        {
            failures.Add($"{RateLimitOptions.Section}:RefreshPermitLimit precisa ser maior que zero.");
        }

        if (options.ZipCodePermitLimit < 1)
        {
            failures.Add($"{RateLimitOptions.Section}:ZipCodePermitLimit precisa ser maior que zero.");
        }

        return failures.Count == 0 ? ValidateOptionsResult.Success : ValidateOptionsResult.Fail(failures);
    }
}
