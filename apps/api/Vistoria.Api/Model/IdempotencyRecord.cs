namespace Vistoria.Api.Model;

/// <summary>
/// Uma <c>Idempotency-Key</c> recebida num <c>PUT</c> ou <c>DELETE</c> (backend.md, "Idempotência"). Infraestrutura,
/// não domínio: não herda de <c>SyncEntity</c> e nunca sincroniza (ADR 0026). A chave primária (<see cref="UserId"/>,
/// <see cref="Key"/>) é o que decide, no banco, qual de duas requisições com a mesma chave processa: nenhum lock em
/// memória, então vale também entre instâncias da API.
/// </summary>
public class IdempotencyRecord
{
    public Guid UserId { get; set; }
    public Guid Key { get; set; }                  // UUID v7 gerado no cliente

    /// <summary>SHA-256 de método, rota e corpo: a mesma chave com outro pedido é 422.</summary>
    public byte[] RequestHash { get; set; } = [];

    public IdempotencyState State { get; set; }

    /// <summary>Resposta gravada quando <see cref="State"/> é <see cref="IdempotencyState.Done"/>.</summary>
    public int? StatusCode { get; set; }

    /// <summary>Cabeçalhos da resposta que o reenvio repete (<c>Content-Type</c>, <c>ETag</c>, <c>Location</c>), em JSON.</summary>
    public string? ResponseHeaders { get; set; }

    public byte[]? ResponseBody { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public enum IdempotencyState
{
    Processing,
    Done,
}
