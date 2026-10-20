namespace Vistoria.Api.Infrastructure.Errors;

/// <summary>
/// Erro do catálogo: o <c>GlobalExceptionHandler</c> o traduz em <c>ProblemDetails</c>.
/// O <c>type</c> vem do catálogo; o status vem da exceção (409 e 412 compartilham <c>version-conflict</c>).
/// </summary>
public abstract class AppException(string type, int status, string? detail = null)
    : Exception(detail ?? ProblemTypes.DetailOf(type))
{
    public string Type { get; } = type;
    public int Status { get; } = status;
    public string Title => ProblemTypes.TitleOf(Type);
    public string Detail => Message;
    public virtual IReadOnlyDictionary<string, object?> Extensions { get; } = new Dictionary<string, object?>();
    public virtual TimeSpan? RetryAfter => null;
}

/// <summary>
/// <c>errors</c> por caminho JSON do campo, relativo ao corpo e com o índice enviado
/// (<c>rooms[2].items[4].condition</c>); <c>""</c> é erro do corpo inteiro.
/// </summary>
public sealed class ValidationException(IDictionary<string, string[]> errors, string? detail = null)
    : AppException(ProblemTypes.Validation, StatusCodes.Status400BadRequest, detail)
{
    /// <summary>Um campo só, o caso comum de uma regra do service.</summary>
    public ValidationException(string path, string message, string? detail = null)
        : this(new Dictionary<string, string[]> { [path] = [message] }, detail)
    {
    }

    public override IReadOnlyDictionary<string, object?> Extensions { get; } =
        new Dictionary<string, object?> { ["errors"] = errors };
}

public sealed class InvalidCursorException(string? detail = null)
    : AppException(ProblemTypes.InvalidCursor, StatusCodes.Status400BadRequest, detail);

public sealed class UnauthorizedException(string? detail = null)
    : AppException(ProblemTypes.Unauthorized, StatusCodes.Status401Unauthorized, detail);

/// <summary>
/// E-mail ou senha errados no <c>signin</c>. A mesma resposta para os dois casos, para não revelar quais e-mails
/// têm conta (ADR 0027).
/// </summary>
public sealed class InvalidCredentialsException(string? detail = null)
    : AppException(ProblemTypes.InvalidCredentials, StatusCodes.Status401Unauthorized, detail);

public sealed class ForbiddenException(string? detail = null)
    : AppException(ProblemTypes.Forbidden, StatusCodes.Status403Forbidden, detail);

public sealed class NotFoundException(string? detail = null)
    : AppException(ProblemTypes.NotFound, StatusCodes.Status404NotFound, detail);

public sealed class UnsupportedRequestException : AppException
{
    public UnsupportedRequestException(int status, string? detail = null)
        : base(ProblemTypes.UnsupportedRequest, status, detail)
    {
        if (ProblemTypes.FromStatus(status) != ProblemTypes.UnsupportedRequest)
        {
            throw new ArgumentOutOfRangeException(nameof(status), status, "Use 405, 406 ou 415.");
        }
    }
}

public sealed class VersionConflictException : AppException
{
    private VersionConflictException(int status, object current, string? detail)
        : base(ProblemTypes.VersionConflict, status, detail)
    {
        Extensions = new Dictionary<string, object?> { ["current"] = current };
    }

    public override IReadOnlyDictionary<string, object?> Extensions { get; }

    /// <summary>Corrida detectada no <c>SaveChanges</c> (409).</summary>
    public static VersionConflictException OnSave(object current, string? detail = null) =>
        new(StatusCodes.Status409Conflict, current, detail);

    /// <summary><c>If-Match</c> diferente da versão atual (412).</summary>
    public static VersionConflictException OnIfMatch(object current, string? detail = null) =>
        new(StatusCodes.Status412PreconditionFailed, current, detail);
}

public sealed class IdempotencyInProgressException(TimeSpan retryAfter, string? detail = null)
    : AppException(ProblemTypes.IdempotencyInProgress, StatusCodes.Status409Conflict, detail)
{
    public override TimeSpan? RetryAfter { get; } = retryAfter;
}

public sealed class LockedException(object current, string? detail = null)
    : AppException(ProblemTypes.Locked, StatusCodes.Status409Conflict, detail)
{
    public override IReadOnlyDictionary<string, object?> Extensions { get; } =
        new Dictionary<string, object?> { ["current"] = current };
}

public sealed class DeletedException(DateTimeOffset deletedAt, string? detail = null)
    : AppException(ProblemTypes.Deleted, StatusCodes.Status410Gone, detail)
{
    public override IReadOnlyDictionary<string, object?> Extensions { get; } =
        new Dictionary<string, object?> { ["deletedAt"] = deletedAt };
}

public sealed class CursorExpiredException(string? detail = null)
    : AppException(ProblemTypes.CursorExpired, StatusCodes.Status410Gone, detail);

public sealed class IdempotencyKeyReusedException(string? detail = null)
    : AppException(ProblemTypes.IdempotencyKeyReused, StatusCodes.Status422UnprocessableEntity, detail);

public sealed class PreconditionRequiredException(string missingHeader, string? detail = null)
    : AppException(ProblemTypes.PreconditionRequired, StatusCodes.Status428PreconditionRequired, detail)
{
    public override IReadOnlyDictionary<string, object?> Extensions { get; } =
        new Dictionary<string, object?> { ["missingHeader"] = missingHeader };
}

public sealed class RateLimitedException(TimeSpan? retryAfter = null, string? detail = null)
    : AppException(ProblemTypes.RateLimited, StatusCodes.Status429TooManyRequests, detail)
{
    public override TimeSpan? RetryAfter { get; } = retryAfter;
}

public sealed class InternalException(string? detail = null)
    : AppException(ProblemTypes.Internal, StatusCodes.Status500InternalServerError, detail);
