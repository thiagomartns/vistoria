using Microsoft.Extensions.Http.Resilience;
using Microsoft.Extensions.Options;
using Vistoria.Api.Infrastructure.ZipCodes;
using Vistoria.Api.Services;
using Vistoria.Api.Services.Impl;

namespace Vistoria.Api.Configurations;

/// <summary>
/// A consulta do CEP (#185): o ViaCEP e a BrasilAPI de reserva, cada um com o próprio <c>HttpClient</c> e a própria
/// resiliência, e o cache em memória. Prazos de backend.md, "Parâmetros compartilhados".
/// </summary>
public static class ZipCodeConfig
{
    public static readonly TimeSpan FoundCacheDuration = TimeSpan.FromDays(30);
    public static readonly TimeSpan NotFoundCacheDuration = TimeSpan.FromDays(1);

    /// <summary>Por tentativa, em cada provedor.</summary>
    public static readonly TimeSpan AttemptTimeout = TimeSpan.FromSeconds(2);

    /// <summary>Por provedor, com a nova tentativa: o pior caso da consulta são os dois, 8 s.</summary>
    public static readonly TimeSpan ProviderTimeout = TimeSpan.FromSeconds(4);

    public static IServiceCollection AddZipCodes(this IServiceCollection services)
    {
        services.AddOptions<ZipCodeOptions>().BindConfiguration(ZipCodeOptions.Section);
        services.AddHybridCache();

        services.AddHttpClient<ViaCepLookup>((sp, client) =>
                client.BaseAddress = sp.GetRequiredService<IOptions<ZipCodeOptions>>().Value.ViaCepBaseUrl)
            .AddStandardResilienceHandler(Resilience);
        services.AddHttpClient<BrasilApiLookup>((sp, client) =>
                client.BaseAddress = sp.GetRequiredService<IOptions<ZipCodeOptions>>().Value.BrasilApiBaseUrl)
            .AddStandardResilienceHandler(Resilience);

        services.AddTransient<IZipCodeLookup, FallbackZipCodeLookup>();
        services.AddScoped<IZipCodeService, ZipCodeService>();
        return services;
    }

    // Uma nova tentativa, rápida: quem espera é a pessoa digitando o CEP. O circuito abre com poucas chamadas (o
    // padrão pede 100 em 30 s, que o app nunca teria), e aberto ele falha na hora e passa para o outro provedor.
    private static void Resilience(HttpStandardResilienceOptions options)
    {
        options.AttemptTimeout.Timeout = AttemptTimeout;
        options.TotalRequestTimeout.Timeout = ProviderTimeout;
        options.Retry.MaxRetryAttempts = 1;
        options.Retry.Delay = TimeSpan.FromMilliseconds(200);
        options.CircuitBreaker.MinimumThroughput = 5;
        options.CircuitBreaker.SamplingDuration = TimeSpan.FromSeconds(30);
        options.CircuitBreaker.BreakDuration = TimeSpan.FromSeconds(30);
    }
}

/// <summary>Seção <c>ZipCode</c>: os endereços dos provedores, com o padrão dos sites públicos.</summary>
public sealed class ZipCodeOptions
{
    public const string Section = "ZipCode";

    public Uri ViaCepBaseUrl { get; set; } = new("https://viacep.com.br/");

    public Uri BrasilApiBaseUrl { get; set; } = new("https://brasilapi.com.br/");
}
