using System.Net;
using System.Text;

namespace Vistoria.Api.Tests.Support;

/// <summary>
/// O handler primário de um provedor de CEP nos testes (#185): responde pelo <paramref name="respond"/> e conta as
/// chamadas, inclusive as novas tentativas da resiliência. Nenhum teste chama a rede.
/// </summary>
public sealed class FakeProviderHandler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> respond)
    : HttpMessageHandler
{
    private int _calls;

    public int Calls => _calls;

    /// <summary>As URLs pedidas, na ordem.</summary>
    public List<string> Paths { get; } = [];

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        Interlocked.Increment(ref _calls);
        lock (Paths)
        {
            Paths.Add(request.RequestUri!.PathAndQuery);
        }

        return respond(request, cancellationToken);
    }

    public static FakeProviderHandler Json(HttpStatusCode status, string body) =>
        new((_, _) => Task.FromResult(new HttpResponseMessage(status)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        }));

    public static FakeProviderHandler Status(HttpStatusCode status) =>
        new((_, _) => Task.FromResult(new HttpResponseMessage(status)));

    /// <summary>Nunca responde: só o timeout da resiliência a termina.</summary>
    public static FakeProviderHandler Hang() =>
        new(async (_, cancellationToken) =>
        {
            await Task.Delay(Timeout.Infinite, cancellationToken);
            throw new InvalidOperationException("inalcançável");
        });
}

/// <summary>
/// O provedor padrão da <see cref="ApiFactory"/>: um teste que chega à rede sem configurar o provedor quebra alto, com
/// um 500 <c>internal</c> (a exceção não é uma falha esperada de provedor), em vez de sair para o ViaCEP de verdade.
/// </summary>
public sealed class NoNetworkHandler : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
        throw new InvalidOperationException($"Teste chamou a rede: {request.RequestUri!.Host}");
}
