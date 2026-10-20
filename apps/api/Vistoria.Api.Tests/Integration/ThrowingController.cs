using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Vistoria.Api.Infrastructure.Errors;

namespace Vistoria.Api.Tests.Integration;

/// <summary>
/// Lança cada exceção do catálogo. Fica só no projeto de testes (via <c>ErrorsApiFactory</c>) para não
/// entrar no contrato.
/// </summary>
[ApiController]
[Route("test/errors")]
public class ThrowingController : ControllerBase
{
    public static readonly object Current = new { id = "0199f0a0-0000-7000-8000-000000000000", version = "AAAAAAAAB9E=" };

    [HttpGet("{name}")]
    public IActionResult Throw(string name) => throw name switch
    {
        "validation" => new ValidationException(new Dictionary<string, string[]> { ["name"] = ["Obrigatório."] }),
        "invalid-cursor" => new InvalidCursorException(),
        "unauthorized" => new UnauthorizedException(),
        "forbidden" => new ForbiddenException(),
        "not-found" => new NotFoundException(),
        "unsupported-request" => new UnsupportedRequestException(StatusCodes.Status415UnsupportedMediaType),
        "version-conflict-409" => VersionConflictException.OnSave(Current),
        "version-conflict-412" => VersionConflictException.OnIfMatch(Current),
        "idempotency-in-progress" => new IdempotencyInProgressException(TimeSpan.FromSeconds(1.5)),
        "locked" => new LockedException(Current),
        "deleted" => new DeletedException(new DateTimeOffset(2026, 10, 20, 12, 0, 0, TimeSpan.FromHours(-3))),
        "cursor-expired" => new CursorExpiredException(),
        "idempotency-key-reused" => new IdempotencyKeyReusedException(),
        "precondition-required" => new PreconditionRequiredException("If-Match"),
        "rate-limited" => new RateLimitedException(TimeSpan.FromSeconds(10)),
        "internal" => new InternalException(),
        "unhandled" => new InvalidOperationException("segredo-do-servidor"),
        _ => new ArgumentOutOfRangeException(nameof(name), name, "Caso desconhecido."),
    };
}
