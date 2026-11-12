using System.Net;
using Microsoft.AspNetCore.HttpOverrides;

namespace Vistoria.Api.Configurations;

/// <summary>
/// O IP real atrás do Caddy (backend.md, "Ambientes e hospedagem"). O <c>X-Forwarded-For</c> só vale vindo de um IP de
/// <c>ForwardedHeaders:KnownProxies</c>; sem nenhum configurado (dev, testes), a API não confia em ninguém, nem no
/// loopback que o padrão do ASP.NET Core aceitaria, e o cabeçalho é ignorado. O rate limit particiona por esse IP.
/// </summary>
public static class ProxyConfig
{
    public const string KnownProxiesKey = "ForwardedHeaders:KnownProxies";

    // A configuração é lida quando as opções são montadas, não no registro: assim vale também a dos testes.
    public static IServiceCollection AddProxyHeaders(this IServiceCollection services)
    {
        services.AddOptions<ForwardedHeadersOptions>().Configure<IConfiguration>((options, configuration) =>
        {
            var proxies = (configuration.GetSection(KnownProxiesKey).Get<string[]>() ?? [])
                .Select(value => IPAddress.TryParse(value, out var ip)
                    ? ip
                    : throw new InvalidOperationException($"{KnownProxiesKey}: \"{value}\" não é um IP."))
                .ToList();
            options.KnownProxies.Clear();
            options.KnownIPNetworks.Clear();
            // Com as duas listas vazias, o middleware confiaria em qualquer origem: sem proxy, não lê cabeçalho nenhum.
            if (proxies.Count == 0)
            {
                options.ForwardedHeaders = ForwardedHeaders.None;
                return;
            }

            proxies.ForEach(options.KnownProxies.Add);
            options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
            // O Caddy acrescenta um IP só, o do cliente que falou com ele; mais à esquerda é o que o cliente mandou.
            options.ForwardLimit = 1;
        });
        return services;
    }

    // Antes de tudo: o tratamento de erros e o rate limit já leem o IP e o esquema reais.
    public static WebApplication UseProxyHeaders(this WebApplication app)
    {
        app.UseForwardedHeaders();
        return app;
    }
}
