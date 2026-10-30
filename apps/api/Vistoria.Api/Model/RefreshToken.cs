namespace Vistoria.Api.Model;

/// <summary>
/// Um refresh token emitido (backend.md, "Autenticação"). Entidade de autenticação, não do domínio: não herda de
/// <c>SyncEntity</c> e nunca sincroniza (ADR 0026). O valor só existe no cookie; aqui fica o hash.
/// </summary>
public class RefreshToken
{
    public Guid Id { get; set; }                   // UUID v7, gerado no servidor
    public byte[] TokenHash { get; set; } = [];    // SHA-256 dos 32 bytes do cookie
    public Guid UserId { get; set; }

    /// <summary>Todos os tokens de um mesmo login: a rotação mantém, o reuso revoga a família inteira.</summary>
    public Guid FamilyId { get; set; }

    /// <summary>Instante do login que abriu a família; o teto de 30 dias conta daqui.</summary>
    public DateTimeOffset FamilyCreatedAt { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>7 dias depois da emissão, sem passar do teto da família.</summary>
    public DateTimeOffset ExpiresAt { get; set; }

    public DateTimeOffset? RevokedAt { get; set; }

    /// <summary>Quando um <c>refresh</c> o trocou pelo sucessor; dentro da tolerância ainda vale.</summary>
    public DateTimeOffset? ReplacedAt { get; set; }
}
