using System.Net.Http.Json;
using Vistoria.Api.Infrastructure.OpenApi;

namespace Vistoria.Api.Tests.Support;

/// <summary>Escritas como a outbox as manda: todo <c>PUT</c> leva uma <c>Idempotency-Key</c> (backend.md, "Cabeçalhos").</summary>
public static class WriteRequests
{
    /// <summary>
    /// <c>PUT</c> com o corpo em JSON. Sem <paramref name="idempotencyKey"/>, uma chave v7 nova: cada chamada é um
    /// pedido novo, não um reenvio.
    /// </summary>
    public static HttpRequestMessage Put(string path, object body, Guid? idempotencyKey = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Put, path) { Content = JsonContent.Create(body) };
        request.Headers.Add(ContractHeaders.IdempotencyKey, (idempotencyKey ?? Guid.CreateVersion7()).ToString());
        return request;
    }
}
