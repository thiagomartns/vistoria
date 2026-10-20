namespace Vistoria.Api.Infrastructure.Errors;

/// <summary>
/// Catálogo fechado dos <c>type</c> de erro (backend.md, "Catálogo de erros"). Fonte única: o OpenAPI
/// publica estes valores como o enum <c>ProblemType</c>, e o front reage a cada um.
/// Cada <c>type</c> é a URN <c>urn:vistoria:problem:&lt;slug&gt;</c> (ADR 0024).
/// </summary>
public static class ProblemTypes
{
    public const string Prefix = "urn:vistoria:problem:";

    public const string Validation = Prefix + "validation";
    public const string InvalidCursor = Prefix + "invalid-cursor";
    public const string Unauthorized = Prefix + "unauthorized";
    public const string Forbidden = Prefix + "forbidden";
    public const string NotFound = Prefix + "not-found";
    public const string UnsupportedRequest = Prefix + "unsupported-request";
    public const string VersionConflict = Prefix + "version-conflict";
    public const string IdempotencyInProgress = Prefix + "idempotency-in-progress";
    public const string Locked = Prefix + "locked";
    public const string Deleted = Prefix + "deleted";
    public const string CursorExpired = Prefix + "cursor-expired";
    public const string IdempotencyKeyReused = Prefix + "idempotency-key-reused";
    public const string PreconditionRequired = Prefix + "precondition-required";
    public const string RateLimited = Prefix + "rate-limited";
    public const string Internal = Prefix + "internal";

    private static readonly Dictionary<string, (string Title, string Detail)> Catalog = new()
    {
        [Validation] = ("Dados inválidos", "Um ou mais campos não passaram na validação."),
        [InvalidCursor] = ("Cursor inválido", "O cursor de sincronização não pôde ser lido."),
        [Unauthorized] = ("Não autenticado", "O token de acesso está ausente ou expirado."),
        [Forbidden] = ("Acesso negado", "O registro pertence a outro usuário."),
        [NotFound] = ("Não encontrado", "O recurso pedido não existe."),
        [UnsupportedRequest] = ("Requisição não suportada", "O método, o Accept ou o Content-Type não é suportado nesta rota."),
        [VersionConflict] = ("Conflito de versão", "O registro mudou desde a versão enviada."),
        [IdempotencyInProgress] = ("Requisição em andamento", "Uma requisição com a mesma Idempotency-Key ainda está em processamento."),
        [Locked] = ("Vistoria concluída", "A vistoria já foi concluída e não aceita mais alterações."),
        [Deleted] = ("Registro excluído", "O registro foi excluído."),
        [CursorExpired] = ("Cursor expirado", "O cursor é mais antigo que a retenção de exclusões; refaça a sincronização completa."),
        [IdempotencyKeyReused] = ("Idempotency-Key reutilizada", "A Idempotency-Key já foi usada com outro corpo."),
        [PreconditionRequired] = ("Cabeçalho obrigatório ausente", "Falta um cabeçalho obrigatório para esta operação."),
        [RateLimited] = ("Muitas requisições", "O limite de requisições foi atingido; tente de novo mais tarde."),
        [Internal] = ("Erro interno", "Ocorreu uma falha inesperada no servidor."),
    };

    public static IReadOnlyCollection<string> All => Catalog.Keys;

    public static bool Contains(string? type) => type is not null && Catalog.ContainsKey(type);

    public static string TitleOf(string type) => Catalog[type].Title;

    public static string DetailOf(string type) => Catalog[type].Detail;

    /// <summary>
    /// <c>type</c> de uma resposta que o pipeline gerou sem passar por exceção do catálogo
    /// (rota inexistente, 405, 400 automático do <c>[ApiController]</c>, 401/403 do auth).
    /// </summary>
    public static string FromStatus(int status) => status switch
    {
        StatusCodes.Status400BadRequest => Validation,
        StatusCodes.Status401Unauthorized => Unauthorized,
        StatusCodes.Status403Forbidden => Forbidden,
        StatusCodes.Status404NotFound => NotFound,
        StatusCodes.Status405MethodNotAllowed
            or StatusCodes.Status406NotAcceptable
            or StatusCodes.Status415UnsupportedMediaType => UnsupportedRequest,
        StatusCodes.Status429TooManyRequests => RateLimited,
        _ => Internal,
    };
}
